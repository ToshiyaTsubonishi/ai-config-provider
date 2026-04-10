import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import express from "express";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const AI_CONFIG_DIR = process.env.AI_CONFIG_DIR 
  ? path.resolve(process.env.AI_CONFIG_DIR) 
  : path.resolve(process.cwd(), "../ai-config");
const RECORDS_PATH = path.join(AI_CONFIG_DIR, ".index", "records.json");

export interface ToolRecord {
  id: string;
  name: string;
  description: string;
  source_path: string;
  tool_kind: string;
  metadata?: {
    command?: string;
    args?: string[];
    [key: string]: any;
  };
  invoke?: {
    command?: string;
    args?: string[];
    [key: string]: any;
  };
}

let recordsCache: ToolRecord[] | null = null;

export async function getRecords(): Promise<ToolRecord[]> {
  if (recordsCache) return recordsCache;
  try {
    const data = await fs.readFile(RECORDS_PATH, "utf-8");
    recordsCache = JSON.parse(data) as ToolRecord[];
    return recordsCache;
  } catch (error) {
    console.error(`Failed to read records.json at ${RECORDS_PATH}:`, error);
    throw new Error(`Could not load ai-config index: ${(error as Error).message}`);
  }
}

export async function getRecordById(toolId: string): Promise<ToolRecord> {
  const records = await getRecords();
  const record = records.find((r) => r.id === toolId);
  if (!record) {
    throw new Error(`Tool record not found for id: ${toolId}`);
  }
  return record;
}

export const READ_SKILL_TOOL: Tool = {
  name: "read_skill_content",
  description: "Reads the markdown content of a SKILL given its ID from the ai-config registry.",
  inputSchema: {
    type: "object",
    properties: {
      tool_id: { type: "string", description: "The ID of the skill" },
    },
    required: ["tool_id"],
  },
};

export const NPM_MANAGE_TOOL: Tool = {
  name: "npm_manage_dependency",
  description: "Runs npm install or npm run build in the directory of a downstream MCP server.",
  inputSchema: {
    type: "object",
    properties: {
      tool_id: { type: "string", description: "The ID of the MCP server or skill" },
      action: { type: "string", enum: ["install", "build"], description: "The npm action to perform" },
    },
    required: ["tool_id", "action"],
  },
};

export const EXECUTE_MCP_TOOL: Tool = {
  name: "execute_mcp_tool",
  description: "Dynamically starts a downstream MCP server, forwards a tool call to it, and returns the result.",
  inputSchema: {
    type: "object",
    properties: {
      target_server_id: { type: "string", description: "The ID of the downstream MCP server." },
      tool_name: { type: "string", description: "The name of the tool to execute on the downstream server." },
      tool_args: { type: "object", description: "The arguments to pass to the tool.", additionalProperties: true },
    },
    required: ["target_server_id", "tool_name"],
  },
};

export async function handleToolCall(name: string, args: Record<string, unknown> | undefined) {
  try {
    if (name === "read_skill_content") {
      const toolId = String(args?.tool_id);
      const record = await getRecordById(toolId);
      const absolutePath = path.resolve(AI_CONFIG_DIR, record.source_path);
      try {
        const content = await fs.readFile(absolutePath, "utf-8");
        return { content: [{ type: "text", text: content }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to read file at ${absolutePath}: ${(err as Error).message}` }],
        };
      }
    }

    if (name === "npm_manage_dependency") {
      const toolId = String(args?.tool_id);
      const action = String(args?.action);
      const record = await getRecordById(toolId);
      
      let targetDir = path.resolve(AI_CONFIG_DIR, record.source_path);
      const stat = await fs.stat(targetDir).catch(() => null);
      if (stat && stat.isFile()) {
        targetDir = path.dirname(targetDir);
      }
      
      const packageJsonPath = path.join(targetDir, "package.json");
      const packageJsonExists = await fs.stat(packageJsonPath).catch(() => false);
      if (!packageJsonExists) {
        return {
          isError: true,
          content: [{ type: "text", text: `No package.json found in ${targetDir}` }],
        };
      }
      
      const cmd = action === "install" ? "npm install" : "npm run build";
      try {
        const { stdout, stderr } = await execAsync(cmd, { cwd: targetDir, maxBuffer: 10 * 1024 * 1024 });
        return { content: [{ type: "text", text: `Command '${cmd}' succeeded.\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}` }] };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Command '${cmd}' failed.\n\nERROR:\n${err.message}\n\nSTDOUT:\n${err.stdout}\n\nSTDERR:\n${err.stderr}` }],
        };
      }
    }

    if (name === "execute_mcp_tool") {
      const targetId = String(args?.target_server_id);
      const toolName = String(args?.tool_name);
      const toolArgs = (args?.tool_args as Record<string, any>) || {};
      
      const record = await getRecordById(targetId);
      const command = record.invoke?.command || record.metadata?.command;
      const cmdArgs = record.invoke?.args || record.metadata?.args || [];
      
      if (!command) {
        return {
          isError: true,
          content: [{ type: "text", text: `Downstream MCP server configuration for ${targetId} is missing an execution command.` }],
        };
      }
      
      const targetDir = record.source_path ? path.resolve(AI_CONFIG_DIR, record.source_path) : process.cwd();
      let workingDir = targetDir;
      const stat = await fs.stat(workingDir).catch(() => null);
      if (stat && stat.isFile()) {
        workingDir = path.dirname(workingDir);
      }
      
      // FIX applied here for StdioClientTransport missing cwd!
      // But wait, the standard client transport doesn't accept `cwd`.
      // Let's verify our earlier check if StdioServerParameters accepts it. Yes, it does in @modelcontextprotocol/sdk.
      const transport = new StdioClientTransport({
        command,
        args: cmdArgs,
        env: { ...process.env } as Record<string, string>,
        cwd: workingDir
      });
      
      const client = new Client(
        { name: "ai-config-provider-proxy", version: "1.0.0" },
        { capabilities: {} }
      );
      
      try {
        await client.connect(transport);
        const result = await client.callTool({
          name: toolName,
          arguments: toolArgs
        });
        await transport.close();
        return result;
      } catch (err: any) {
        await transport.close().catch(() => {});
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to proxy tool call to ${targetId}: ${err.message}` }],
        };
      }
    }

    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error handling tool ${name}: ${(error as Error).message}` }],
    };
  }
}

export const server = new Server({ name: "ai-config-provider", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [READ_SKILL_TOOL, NPM_MANAGE_TOOL, EXECUTE_MCP_TOOL] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return await handleToolCall(request.params.name, request.params.arguments);
});

// We only start the HTTP server if this file is executed directly.
// fileURLToPath is needed in ESM to get the current file.
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const app = express();
  const PORT = process.env.PORT || 8080;
  const transports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    await server.connect(transport);
    transports.set(transport.sessionId, transport);
    res.on("close", () => { transports.delete(transport.sessionId); });
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (!transport) { res.status(404).send("Session not found"); return; }
    await transport.handlePostMessage(req, res);
  });

  app.get("/healthz", (req, res) => res.status(200).send("OK"));
  app.get("/readyz", (req, res) => res.status(200).send("OK"));

  app.listen(PORT, () => {
    console.log(`ai-config-provider MCP server running on http://localhost:${PORT}`);
  });
}
