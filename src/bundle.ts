import fs from "node:fs/promises";
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
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
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
  };
}
