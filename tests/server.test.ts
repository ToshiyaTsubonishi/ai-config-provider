import http from "node:http";
import { once } from "node:events";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { handleToolCall } from "../src/index.js";
import { FIXTURE_AI_CONFIG_DIR, createResolver, parseToolJson } from "./helpers.js";

async function withSelectorStub(
  handler: (baseUrl: string) => Promise<void>,
  toolPayload: Record<string, unknown>,
) {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/catalog/tool-detail") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "success", tool: toolPayload }));
      return;
    }
    if (requestUrl.pathname === "/readyz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ready" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "error" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind selector stub.");
  }

  try {
    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

describe("ai-config-provider tools", () => {
  it("resolve_selected_tool resolves bundle metadata from the local index", async () => {
    const result = await handleToolCall(
      "resolve_selected_tool",
      { tool_id: "skill:test-skill" },
      createResolver(),
    );

    expect(result.isError).not.toBe(true);
    const payload = parseToolJson(result);
    expect(payload.tool_id).toBe("skill:test-skill");
    expect(payload.resolved_via).toBe("local_index");
    expect(payload.provider_path_exists).toBe(true);
    expect(payload.provider_path).toBe(path.join(FIXTURE_AI_CONFIG_DIR, "skills/custom/test-skill/SKILL.md"));
  });

  it("read_skill_content reads the selected skill from the provider bundle", async () => {
    const result = await handleToolCall(
      "read_skill_content",
      { tool_id: "skill:test-skill" },
      createResolver(),
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("# Test Skill");
  });

  it("list_loaded_mcp_tools loads the actual downstream MCP implementation", async () => {
    const result = await handleToolCall(
      "list_loaded_mcp_tools",
      { tool_id: "mcp:test-mcp" },
      createResolver(),
    );

    expect(result.isError).not.toBe(true);
    const payload = parseToolJson(result);
    expect(payload.tool_id).toBe("mcp:test-mcp");
    expect(payload.count).toBe(1);
    expect(payload.tools[0].name).toBe("get_cwd");
  });

  it("execute_mcp_tool proxies the selected downstream tool with the provider working directory", async () => {
    const result = await handleToolCall(
      "execute_mcp_tool",
      { tool_id: "mcp:test-mcp", tool_name: "get_cwd", tool_args: {} },
      createResolver(),
    );

    expect(result.isError).not.toBe(true);
    const expectedCwd = path.join(FIXTURE_AI_CONFIG_DIR, "skills/custom/test-mcp");
    expect(result.content[0].text).toBe(expectedCwd);
  });

  it("resolve_selected_tool prefers selector detail lookup when configured", async () => {
    await withSelectorStub(
      async (baseUrl) => {
        const resolver = createResolver({ AI_CONFIG_SELECTOR_BASE_URL: baseUrl });
        const result = await handleToolCall(
          "resolve_selected_tool",
          { tool_id: "skill:test-skill" },
          resolver,
        );

        expect(result.isError).not.toBe(true);
        const payload = parseToolJson(result);
        expect(payload.resolved_via).toBe("selector_http");
        expect(payload.record.description).toBe("Remote test skill");
      },
      {
        id: "skill:test-skill",
        name: "test-skill",
        description: "Remote test skill",
        source_path: "skills/custom/test-skill/SKILL.md",
        tool_kind: "skill",
        metadata: { layer: "remote" },
      },
    );
  });
});
