import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ToolRecordResolver } from "./record-resolver.js";
import { handleToolCall, PROVIDER_TOOLS } from "./tools.js";

export function createProviderMcpServer(resolver: ToolRecordResolver) {
  const server = new Server(
    { name: "ai-config-provider", version: "1.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: PROVIDER_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, request.params.arguments, resolver);
  });

  return server;
}
