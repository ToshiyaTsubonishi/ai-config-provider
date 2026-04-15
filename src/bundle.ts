import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import type { ToolRecord } from "./types.js";

export interface MaterializeProviderBundleOptions {
  aiConfigDir: string;
  outputDir: string;
  clean?: boolean;
}

export interface MaterializeProviderBundleResult {
  recordCount: number;
  copiedPaths: string[];
  missingPaths: string[];
  recordsPath: string;
  metadataPath: string;
  bundleVersion: string;
  sourceAiConfigCommitSha?: string;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function detectGitHead(repoDir: string): string | undefined {
  try {
    return execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export async function materializeProviderBundle(
  options: MaterializeProviderBundleOptions,
): Promise<MaterializeProviderBundleResult> {
  const aiConfigDir = path.resolve(options.aiConfigDir);
  const outputDir = path.resolve(options.outputDir);
  const recordsPath = path.join(aiConfigDir, ".index", "records.json");
  const rawRecords = await fs.readFile(recordsPath, "utf-8");
  const records = JSON.parse(rawRecords) as ToolRecord[];

  if (options.clean !== false) {
    await fs.rm(outputDir, { recursive: true, force: true });
  }

  await fs.mkdir(path.join(outputDir, ".index"), { recursive: true });
  await fs.writeFile(path.join(outputDir, ".index", "records.json"), rawRecords, "utf-8");
  const sourceAiConfigCommitSha = detectGitHead(aiConfigDir);
  const recordsSha256 = createHash("sha256").update(rawRecords).digest("hex");
  const bundleVersion = `${(sourceAiConfigCommitSha ?? "unknown").slice(0, 12)}-${recordsSha256.slice(0, 12)}`;
  const metadataPath = path.join(outputDir, ".index", "provider-bundle-metadata.json");
  await fs.writeFile(
    metadataPath,
    JSON.stringify(
      {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        source_ai_config_dir: aiConfigDir,
        source_ai_config_commit_sha: sourceAiConfigCommitSha,
        record_count: records.length,
        records_sha256: recordsSha256,
        bundle_version: bundleVersion,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );

  const copied = new Set<string>();
  const missing = new Set<string>();

  for (const record of records) {
    const relativePath = record.source_path?.trim();
    if (!relativePath || copied.has(relativePath)) {
      continue;
    }

    const sourcePath = path.join(aiConfigDir, relativePath);
    if (!(await pathExists(sourcePath))) {
      missing.add(relativePath);
      continue;
    }

    const targetPath = path.join(outputDir, relativePath);
    const stat = await fs.stat(sourcePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    if (stat.isDirectory()) {
      await fs.cp(sourcePath, targetPath, { recursive: true });
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
    copied.add(relativePath);
  }

  return {
    recordCount: records.length,
    copiedPaths: [...copied].sort(),
    missingPaths: [...missing].sort(),
    recordsPath: path.join(outputDir, ".index", "records.json"),
    metadataPath,
    bundleVersion,
    sourceAiConfigCommitSha,
  };
}
