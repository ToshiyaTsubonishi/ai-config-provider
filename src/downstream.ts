import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import type { ResolvedToolRecord } from "./types.js";

const execAsync = promisify(exec);

function dumpModel(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => dumpModel(item));
  }
  if (value && typeof value === "object") {
    const modelDump = (value as { model_dump?: () => unknown }).model_dump;
    if (typeof modelDump === "function") {
      return dumpModel(modelDump.call(value));
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, dumpModel(item)]),
    );
  }
  return value;
}

function commandSpec(resolved: ResolvedToolRecord): { command: string; args: string[] } {
  const command = String(resolved.record.invoke?.command ?? resolved.record.metadata?.command ?? "").trim();
  const args = (resolved.record.invoke?.args ?? resolved.record.metadata?.args ?? []).map((arg) => String(arg));
  if (!command) {
    throw new Error(`Downstream MCP server configuration for ${resolved.record.id} is missing a command.`);
  }
  return { command, args };
}

function ensureMcpRecord(resolved: ResolvedToolRecord): void {
  if (resolved.record.tool_kind !== "mcp_server") {
    throw new Error(`Tool ${resolved.record.id} is not an MCP server.`);
  }
}

export async function listLoadedMcpTools(resolved: ResolvedToolRecord): Promise<Record<string, unknown>> {
  ensureMcpRecord(resolved);
  const { command, args } = commandSpec(resolved);
  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...process.env } as Record<string, string>,
    cwd: resolved.workingDirectory,
  });
  const client = new Client(
    { name: "ai-config-provider-proxy", version: "1.1.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    return {
      tool_id: resolved.record.id,
      working_directory: resolved.workingDirectory,
      count: tools.tools.length,
      tools: dumpModel(tools.tools),
    };
  } finally {
    await transport.close().catch(() => undefined);
  }
}

export async function callLoadedMcpTool(
  resolved: ResolvedToolRecord,
  toolName: string,
  argumentsPayload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  ensureMcpRecord(resolved);
  const { command, args } = commandSpec(resolved);
  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...process.env } as Record<string, string>,
    cwd: resolved.workingDirectory,
  });
  const client = new Client(
    { name: "ai-config-provider-proxy", version: "1.1.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: toolName,
      arguments: argumentsPayload,
    });
    return dumpModel(result) as Record<string, unknown>;
  } finally {
    await transport.close().catch(() => undefined);
  }
}

export async function readSkillContent(resolved: ResolvedToolRecord): Promise<string> {
  if (!resolved.providerPathExists) {
    throw new Error(`Provider bundle path does not exist: ${resolved.providerPath}`);
  }

  const stat = await fs.stat(resolved.providerPath);
  if (!stat.isFile()) {
    throw new Error(`Expected a skill file but found a directory: ${resolved.providerPath}`);
  }

  return fs.readFile(resolved.providerPath, "utf-8");
}

export async function runNpmAction(
  resolved: ResolvedToolRecord,
  action: "install" | "build",
): Promise<string> {
  const packageJsonPath = path.join(resolved.workingDirectory, "package.json");
  const packageJsonExists = await fs
    .stat(packageJsonPath)
    .then(() => true)
    .catch(() => false);
  if (!packageJsonExists) {
    throw new Error(`No package.json found in ${resolved.workingDirectory}`);
  }

  const command = action === "install" ? "npm install" : "npm run build";
  const { stdout, stderr } = await execAsync(command, {
    cwd: resolved.workingDirectory,
    maxBuffer: 10 * 1024 * 1024,
  });
  return `Command '${command}' succeeded.\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
}
