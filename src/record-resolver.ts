import fs from "node:fs/promises";
import path from "node:path";

import type { ProviderRuntimeConfig } from "./config.js";
import type { ResolvedToolRecord, SelectorStatus, ToolRecord } from "./types.js";

type FetchLike = typeof fetch;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export class ToolRecordResolver {
  private readonly resolvedCache = new Map<string, Promise<ResolvedToolRecord>>();
  private recordsCache: Promise<ToolRecord[]> | null = null;

  constructor(
    readonly config: ProviderRuntimeConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async resolve(toolId: string): Promise<ResolvedToolRecord> {
    const normalizedToolId = toolId.trim();
    if (!normalizedToolId) {
      throw new Error("tool_id is required.");
    }

    const cached = this.resolvedCache.get(normalizedToolId);
    if (cached) {
      return cached;
    }

    const pending = this.resolveUncached(normalizedToolId);
    this.resolvedCache.set(normalizedToolId, pending);
    try {
      return await pending;
    } catch (error) {
      this.resolvedCache.delete(normalizedToolId);
      throw error;
    }
  }

  async selectorStatus(): Promise<SelectorStatus> {
    if (!this.config.selectorToolDetailUrl) {
      return {
        configured: false,
        status: "unconfigured",
      };
    }

    if (!this.config.selectorReadyUrl) {
      return {
        configured: true,
        status: "skipped",
        toolDetailUrl: this.config.selectorToolDetailUrl,
      };
    }

    try {
      const response = await this.fetchImpl(this.config.selectorReadyUrl, {
        headers: this.selectorHeaders(),
      });
      const detail = await readJsonOrText(response);
      if (!response.ok) {
        return {
          configured: true,
          status: "error",
          toolDetailUrl: this.config.selectorToolDetailUrl,
          readyUrl: this.config.selectorReadyUrl,
          detail,
        };
      }
      return {
        configured: true,
        status: "ok",
        toolDetailUrl: this.config.selectorToolDetailUrl,
        readyUrl: this.config.selectorReadyUrl,
        detail,
      };
    } catch (error) {
      return {
        configured: true,
        status: "error",
        toolDetailUrl: this.config.selectorToolDetailUrl,
        readyUrl: this.config.selectorReadyUrl,
        detail: String((error as Error).message || error),
      };
    }
  }

  async localIndexAvailable(): Promise<boolean> {
    return pathExists(this.config.recordsPath);
  }

  private async resolveUncached(toolId: string): Promise<ResolvedToolRecord> {
    const problems: string[] = [];

    try {
      const remoteRecord = await this.resolveFromSelector(toolId);
      if (remoteRecord) {
        return this.decorate(remoteRecord, "selector_http");
      }
    } catch (error) {
      problems.push(`selector lookup failed: ${(error as Error).message}`);
    }

    try {
      const localRecord = await this.resolveFromLocalIndex(toolId);
      if (localRecord) {
        return this.decorate(localRecord, "local_index");
      }
    } catch (error) {
      problems.push(`local index lookup failed: ${(error as Error).message}`);
    }

    const suffix = problems.length > 0 ? ` (${problems.join("; ")})` : "";
    throw new Error(`Tool record not found for id: ${toolId}${suffix}`);
  }

  private async decorate(record: ToolRecord, source: ResolvedToolRecord["source"]): Promise<ResolvedToolRecord> {
    const providerPath = path.resolve(this.config.providerRoot, record.source_path || ".");
    const exists = await pathExists(providerPath);
    let workingDirectory = this.config.providerRoot;

    if (exists) {
      const stat = await fs.stat(providerPath);
      workingDirectory = stat.isDirectory() ? providerPath : path.dirname(providerPath);
    }

    return {
      record,
      source,
      providerRoot: this.config.providerRoot,
      recordsPath: this.config.recordsPath,
      providerPath,
      providerPathExists: exists,
      workingDirectory,
    };
  }

  private async resolveFromSelector(toolId: string): Promise<ToolRecord | null> {
    if (!this.config.selectorToolDetailUrl) {
      return null;
    }

    const requestUrl = new URL(this.config.selectorToolDetailUrl);
    requestUrl.searchParams.set("tool_id", toolId);

    const response = await this.fetchImpl(requestUrl, {
      headers: this.selectorHeaders(),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from selector detail lookup.`);
    }

    const payload = await response.json() as
      | ToolRecord
      | { status?: string; tool?: ToolRecord; error?: { message?: string } };
    if ("tool" in payload && payload.tool) {
      return payload.tool;
    }
    if ("id" in payload && "tool_kind" in payload) {
      return payload as ToolRecord;
    }

    throw new Error("Selector detail payload was not a ToolRecord.");
  }

  private async resolveFromLocalIndex(toolId: string): Promise<ToolRecord | null> {
    const records = await this.readLocalRecords();
    return records.find((record) => record.id === toolId) ?? null;
  }

  private async readLocalRecords(): Promise<ToolRecord[]> {
    if (!this.recordsCache) {
      this.recordsCache = fs
        .readFile(this.config.recordsPath, "utf-8")
        .then((raw) => JSON.parse(raw) as ToolRecord[]);
    }
    return this.recordsCache;
  }

  private selectorHeaders(): HeadersInit | undefined {
    if (!this.config.selectorBearerToken) {
      return undefined;
    }
    return {
      Authorization: `Bearer ${this.config.selectorBearerToken}`,
    };
  }
}
