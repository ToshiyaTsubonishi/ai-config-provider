import path from "node:path";

export interface ProviderRuntimeConfig {
  providerRoot: string;
  recordsPath: string;
  selectorToolDetailUrl?: string;
  selectorReadyUrl?: string;
  selectorBearerToken?: string;
  port: number;
}

function trimEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function deriveSelectorBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const explicitBase = trimEnv(env.AI_CONFIG_SELECTOR_BASE_URL);
  if (explicitBase) {
    return stripTrailingSlash(explicitBase);
  }

  const mcpUrl = trimEnv(env.AI_CONFIG_SELECTOR_MCP_URL);
  if (!mcpUrl) {
    return undefined;
  }

  return stripTrailingSlash(mcpUrl.replace(/\/mcp\/?$/, ""));
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "8080", 10);
  return Number.isFinite(parsed) ? parsed : 8080;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProviderRuntimeConfig {
  const providerRoot = path.resolve(
    trimEnv(env.AI_CONFIG_PROVIDER_DIR)
      ?? trimEnv(env.AI_CONFIG_DIR)
      ?? path.resolve(process.cwd(), "provider-bundle"),
  );
  const recordsPath = path.resolve(
    trimEnv(env.AI_CONFIG_RECORDS_PATH)
      ?? path.join(providerRoot, ".index", "records.json"),
  );
  const selectorBaseUrl = deriveSelectorBaseUrl(env);

  return {
    providerRoot,
    recordsPath,
    selectorToolDetailUrl:
      trimEnv(env.AI_CONFIG_SELECTOR_TOOL_DETAIL_URL)
      ?? (selectorBaseUrl ? `${selectorBaseUrl}/catalog/tool-detail` : undefined),
    selectorReadyUrl:
      trimEnv(env.AI_CONFIG_SELECTOR_READY_URL)
      ?? (selectorBaseUrl ? `${selectorBaseUrl}/readyz` : undefined),
    selectorBearerToken: trimEnv(env.AI_CONFIG_SELECTOR_BEARER_TOKEN),
    port: parsePort(env.PORT),
  };
}
