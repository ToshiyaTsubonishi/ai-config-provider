import { fileURLToPath } from "node:url";
import { startProviderServer } from "./server.js";

export { materializeProviderBundle } from "./bundle.js";
export { loadConfig } from "./config.js";
export { ToolRecordResolver } from "./record-resolver.js";
export { createProviderApp, startProviderServer } from "./server.js";
export { handleToolCall } from "./tools.js";

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  startProviderServer();
}
