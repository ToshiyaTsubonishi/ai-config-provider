import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { materializeProviderBundle } from "../src/index.js";
import { FIXTURE_AI_CONFIG_DIR } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("materializeProviderBundle", () => {
  it("copies records.json and selected source paths into the provider bundle", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-config-provider-bundle-"));
    tempDirs.push(outputDir);

    const result = await materializeProviderBundle({
      aiConfigDir: FIXTURE_AI_CONFIG_DIR,
      outputDir,
    });

    expect(result.recordCount).toBe(2);
    expect(result.copiedPaths).toContain("skills/custom/test-skill/SKILL.md");
    expect(result.copiedPaths).toContain("skills/custom/test-mcp");

    const copiedSkill = await fs.readFile(
      path.join(outputDir, "skills/custom/test-skill/SKILL.md"),
      "utf-8",
    );
    expect(copiedSkill).toContain("# Test Skill");

    const copiedRecords = JSON.parse(
      await fs.readFile(path.join(outputDir, ".index", "records.json"), "utf-8"),
    );
    expect(copiedRecords).toHaveLength(2);

    const metadata = JSON.parse(
      await fs.readFile(path.join(outputDir, ".index", "provider-bundle-metadata.json"), "utf-8"),
    );
    expect(metadata.schema_version).toBe(1);
    expect(metadata.record_count).toBe(2);
    expect(metadata.records_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.bundle_version).toMatch(/^[a-z0-9-]+$/);
    expect(result.metadataPath).toBe(path.join(outputDir, ".index", "provider-bundle-metadata.json"));
    expect(result.bundleVersion).toBe(metadata.bundle_version);
  });
});
