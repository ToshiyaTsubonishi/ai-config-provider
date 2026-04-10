export interface ToolRecord {
  id: string;
  name: string;
  description: string;
  source_path: string;
  tool_kind: string;
  metadata?: {
    command?: string;
    args?: string[];
    [key: string]: unknown;
  };
  invoke?: {
    command?: string;
    args?: string[];
    [key: string]: unknown;
  };
}

export type RecordSource = "selector_http" | "local_index";

export interface ResolvedToolRecord {
  record: ToolRecord;
  source: RecordSource;
  providerRoot: string;
  recordsPath: string;
  providerPath: string;
  providerPathExists: boolean;
  workingDirectory: string;
}

export interface SelectorStatus {
  configured: boolean;
  status: "ok" | "error" | "skipped" | "unconfigured";
  toolDetailUrl?: string;
  readyUrl?: string;
  detail?: unknown;
}
