import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/config.js";
import { ToolRecordResolver } from "../src/record-resolver.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FIXTURE_AI_CONFIG_DIR = path.join(__dirname, "fixtures", "ai-config");
export const FIXTURE_RECORDS_PATH = path.join(FIXTURE_AI_CONFIG_DIR, ".index", "records.json");

export function createResolver(envOverrides: NodeJS.ProcessEnv = {}) {
  const config = loadConfig({
    ...process.env,
    AI_CONFIG_PROVIDER_DIR: FIXTURE_AI_CONFIG_DIR,
    AI_CONFIG_RECORDS_PATH: FIXTURE_RECORDS_PATH,
    ...envOverrides,
  });
  return new ToolRecordResolver(config);
}

export function parseToolJson(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}
