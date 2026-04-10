import { describe, expect, it } from "vitest";

import { handleToolCall } from "../src/index.js";
import { createResolver } from "./helpers.js";

describe("npm_manage_dependency", () => {
  it("fails if action is invalid", async () => {
    const result = await handleToolCall(
      "npm_manage_dependency",
      { tool_id: "mcp:test-mcp", action: "hack" },
      createResolver(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unsupported npm action");
  });

  it("runs build and returns stdout", async () => {
    const result = await handleToolCall(
      "npm_manage_dependency",
      { tool_id: "mcp:test-mcp", action: "build" },
      createResolver(),
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("built");
  });

  it("returns error if package.json is missing", async () => {
    const result = await handleToolCall(
      "npm_manage_dependency",
      { tool_id: "skill:test-skill", action: "build" },
      createResolver(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No package.json found");
  });
});
