import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mcprigor-conflict", version: "1.0.0" });
server.registerTool("add", {
  description: "Concatenate two strings",
  inputSchema: { a: z.string(), b: z.string() },
}, async ({ a, b }) => ({ content: [{ type: "text", text: a + b }], structuredContent: { sum: a + b } }));
server.registerTool("echo", { inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: "text", text }], structuredContent: { text } }));
await server.connect(new StdioServerTransport());
