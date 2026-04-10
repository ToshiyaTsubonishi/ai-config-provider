import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

import { FIXTURE_AI_CONFIG_DIR } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForJson(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json() as Promise<Record<string, unknown>>;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

describe("ai-config-provider integration", () => {
  it("starts the built server, reports readiness, and serves MCP over streamable HTTP", async () => {
    const port = await getFreePort();
    const child = spawn("node", ["dist/index.js"], {
      env: {
        ...process.env,
        PORT: String(port),
        AI_CONFIG_PROVIDER_DIR: FIXTURE_AI_CONFIG_DIR,
        AI_CONFIG_RECORDS_PATH: path.join(FIXTURE_AI_CONFIG_DIR, ".index", "records.json"),
      },
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      const health = await waitForJson(`http://127.0.0.1:${port}/healthz`, 10000);
      const ready = await waitForJson(`http://127.0.0.1:${port}/readyz`, 10000);

      expect(health).toEqual({ status: "ok" });
      expect(ready.status).toBe("ready");
      expect(ready.surface).toBe("ai-config-provider");

      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
      );
      const client = new Client(
        { name: "ai-config-provider-test", version: "1.0.0" },
        { capabilities: {} },
      );
      await client.connect(transport);
      const result = await client.callTool({
        name: "resolve_selected_tool",
        arguments: { tool_id: "skill:test-skill" },
      });
      const payload = JSON.parse(result.content[0].text);

      expect(payload.record.id).toBe("skill:test-skill");
      expect(payload.provider_path_exists).toBe(true);

      await transport.close();
    } finally {
      child.kill();
    }
  });
});
