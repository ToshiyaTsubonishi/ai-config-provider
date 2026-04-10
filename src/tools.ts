import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import {
  callLoadedMcpTool,
  listLoadedMcpTools,
  readSkillContent,
  runNpmAction,
} from "./downstream.js";
import { ToolRecordResolver } from "./record-resolver.js";

const defaultResolver = new ToolRecordResolver(loadConfig());

function toolTextResult(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

function toolErrorResult(text: string) {
  return {
    isError: true,
    content: [{ type: "text", text }],
  };
}

function jsonTextResult(payload: unknown) {
  return toolTextResult(JSON.stringify(payload, null, 2));
}

function resolveRequestedToolId(args: Record<string, unknown> | undefined): string {
  return String(args?.tool_id ?? args?.target_server_id ?? "").trim();
}

export const RESOLVE_SELECTED_TOOL_TOOL: Tool = {
  name: "resolve_selected_tool",
  description: "Resolves a selected tool ID from ai-config and reports how the provider bundle will load it.",
  inputSchema: {
    type: "object",
    properties: {
      tool_id: { type: "string", description: "The selected tool ID from ai-config." },
    },
    required: ["tool_id"],
  },
};

export const READ_SKILL_TOOL: Tool = {
  name: "read_skill_content",
  description: "Reads the markdown content of a skill selected by ai-config from the local provider bundle.",
  inputSchema: {
    type: "object",
    properties: {
      tool_id: { type: "string", description: "The ID of the skill." },
    },
    required: ["tool_id"],
  },
};

export const LIST_LOADED_MCP_TOOLS_TOOL: Tool = {
  name: "list_loaded_mcp_tools",
  description: "Loads a selected MCP server implementation from the provider bundle and lists its actual tools.",
  inputSchema: {
    type: "object",
    properties: {
      tool_id: { type: "string", description: "The selected MCP server ID." },
    },
    required: ["tool_id"],
  },
};

export const NPM_MANAGE_TOOL: Tool = {
  name: "npm_manage_dependency",
  description: "Runs npm install or npm run build in the directory of a selected provider bundle entry.",
  inputSchema: {
    type: "object",
    properties: {
      tool_id: { type: "string", description: "The selected tool ID." },
      action: {
        type: "string",
        enum: ["install", "build"],
        description: "The npm action to perform.",
      },
    },
    required: ["tool_id", "action"],
  },
};

export const EXECUTE_MCP_TOOL: Tool = {
  name: "execute_mcp_tool",
  description: "Loads a selected downstream MCP server from the provider bundle, forwards a tool call, and returns the result.",
  inputSchema: {
    type: "object",
    properties: {
      tool_id: { type: "string", description: "The selected downstream MCP server ID." },
      target_server_id: {
        type: "string",
        description: "Backward-compatible alias for tool_id.",
      },
      tool_name: { type: "string", description: "The name of the downstream tool to execute." },
      tool_args: {
        type: "object",
        description: "Arguments to pass to the downstream tool.",
        additionalProperties: true,
      },
    },
    required: ["tool_name"],
  },
};

export const PROVIDER_TOOLS: Tool[] = [
  RESOLVE_SELECTED_TOOL_TOOL,
  READ_SKILL_TOOL,
  LIST_LOADED_MCP_TOOLS_TOOL,
  NPM_MANAGE_TOOL,
  EXECUTE_MCP_TOOL,
];

export async function handleToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
  resolver: ToolRecordResolver = defaultResolver,
) {
  try {
    if (name === "resolve_selected_tool") {
      const toolId = resolveRequestedToolId(args);
      const resolved = await resolver.resolve(toolId);
      return jsonTextResult({
        tool_id: toolId,
        resolved_via: resolved.source,
        provider_root: resolved.providerRoot,
        provider_path: resolved.providerPath,
        provider_path_exists: resolved.providerPathExists,
        working_directory: resolved.workingDirectory,
        record: resolved.record,
      });
    }

    if (name === "read_skill_content") {
      const toolId = resolveRequestedToolId(args);
      const resolved = await resolver.resolve(toolId);
      const content = await readSkillContent(resolved);
      return toolTextResult(content);
    }

    if (name === "list_loaded_mcp_tools") {
      const toolId = resolveRequestedToolId(args);
      const resolved = await resolver.resolve(toolId);
      const payload = await listLoadedMcpTools(resolved);
      return jsonTextResult(payload);
    }

    if (name === "npm_manage_dependency") {
      const toolId = resolveRequestedToolId(args);
      const action = String(args?.action ?? "").trim();
      if (action !== "install" && action !== "build") {
        return toolErrorResult(`Unsupported npm action: ${action || "(empty)"}`);
      }

      const resolved = await resolver.resolve(toolId);
      const output = await runNpmAction(resolved, action);
      return toolTextResult(output);
    }

    if (name === "execute_mcp_tool") {
      const toolId = resolveRequestedToolId(args);
      const toolName = String(args?.tool_name ?? "").trim();
      if (!toolName) {
        return toolErrorResult("tool_name is required.");
      }
      const toolArgs = (args?.tool_args as Record<string, unknown> | undefined) ?? {};
      const resolved = await resolver.resolve(toolId);
      return await callLoadedMcpTool(resolved, toolName, toolArgs);
    }

    return toolErrorResult(`Unknown tool: ${name}`);
  } catch (error) {
    return toolErrorResult(`Error handling tool ${name}: ${(error as Error).message}`);
  }
}
