import express from "express";
import fs from "node:fs/promises";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadConfig, type ProviderRuntimeConfig } from "./config.js";
import { createProviderMcpServer } from "./mcp-server.js";
import { ToolRecordResolver } from "./record-resolver.js";
import type { ProviderBundleMetadata } from "./types.js";

function cleanupServer(server: unknown) {
  if (!server || typeof server !== "object" || !("close" in server)) {
    return;
  }
  const close = (server as { close: () => Promise<unknown> | unknown }).close;
  try {
    const result = close.call(server);
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      void (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Ignore cleanup errors on shutdown.
  }
}

function methodNotAllowed(res: express.Response) {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
}

async function readProviderBundleMetadata(
  config: ProviderRuntimeConfig,
): Promise<ProviderBundleMetadata | null> {
  try {
    const raw = await fs.readFile(config.bundleMetadataPath, "utf-8");
    return JSON.parse(raw) as ProviderBundleMetadata;
  } catch {
    return null;
  }
}

function deploymentProvenance(config: ProviderRuntimeConfig, metadata: ProviderBundleMetadata | null) {
  const payload: Record<string, unknown> = {};
  if (config.provenanceCommitSha) {
    payload.commit_sha = config.provenanceCommitSha;
  }
  if (config.provenanceImage) {
    payload.image_ref = config.provenanceImage;
  }
  if (process.env.K_SERVICE) {
    payload.service = process.env.K_SERVICE;
  }
  if (process.env.K_REVISION) {
    payload.revision = process.env.K_REVISION;
  }
  if (process.env.K_CONFIGURATION) {
    payload.configuration = process.env.K_CONFIGURATION;
  }
  const bundleVersion = config.providerBundleVersion ?? metadata?.bundle_version;
  if (bundleVersion) {
    payload.provider_bundle_version = bundleVersion;
  }
  return payload;
}

export async function buildReadinessPayload(resolver: ToolRecordResolver) {
  const selector = await resolver.selectorStatus();
  const localIndexAvailable = await resolver.localIndexAvailable();
  const bundleMetadata = await readProviderBundleMetadata(resolver.config);
  const providerRootExists = await import("node:fs/promises")
    .then((fs) => fs.access(resolver.config.providerRoot).then(() => true).catch(() => false));

  const ready =
    providerRootExists
    && (selector.status === "ok" || selector.status === "skipped" || localIndexAvailable);

  const payload: Record<string, unknown> = {
    status: ready ? "ready" : "not_ready",
    surface: "ai-config-provider",
    provider_root: resolver.config.providerRoot,
    provider_root_exists: providerRootExists,
    records_path: resolver.config.recordsPath,
    bundle_metadata_path: resolver.config.bundleMetadataPath,
    local_index_available: localIndexAvailable,
    selector,
    record_resolution_order: resolver.config.selectorToolDetailUrl
      ? ["selector_http", "local_index"]
      : ["local_index"],
  };
  const provenance = deploymentProvenance(resolver.config, bundleMetadata);
  if (Object.keys(provenance).length > 0) {
    payload.provenance = provenance;
  }
  if (bundleMetadata) {
    payload.provider_bundle = bundleMetadata;
  }
  return payload;
}

export function createProviderApp(options: {
  config?: ProviderRuntimeConfig;
  resolver?: ToolRecordResolver;
} = {}) {
  const config = options.config ?? loadConfig();
  const resolver = options.resolver ?? new ToolRecordResolver(config);

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const mcpServer = createProviderMcpServer(resolver);

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close().catch(() => undefined);
        cleanupServer(mcpServer);
      });
    } catch (error) {
      void transport.close().catch(() => undefined);
      cleanupServer(mcpServer);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: (error as Error).message || "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (_req, res) => {
    methodNotAllowed(res);
  });

  app.delete("/mcp", async (_req, res) => {
    methodNotAllowed(res);
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/readyz", async (_req, res) => {
    const payload = await buildReadinessPayload(resolver);
    res.status(payload.status === "ready" ? 200 : 503).json(payload);
  });

  return { app, config, resolver };
}

export function startProviderServer(options: {
  config?: ProviderRuntimeConfig;
  resolver?: ToolRecordResolver;
} = {}) {
  const { app, config } = createProviderApp(options);
  return app.listen(config.port, () => {
    console.log(`ai-config-provider MCP server running on http://0.0.0.0:${config.port}`);
  });
}
