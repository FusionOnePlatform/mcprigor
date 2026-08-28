import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mcprigor-fixture", version: "1.0.0" });
server.registerTool("add", {
  description: "Add two numbers deterministically",
  inputSchema: { a: z.number(), b: z.number() },
}, async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }], structuredContent: { sum: a + b } }));
server.registerResource("status", "fixture://status", { description: "Fixture status", mimeType: "application/json" }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ ready: true }) }],
}));
server.registerPrompt("greet", { description: "Create a greeting", argsSchema: { name: z.string() } }, ({ name }) => ({
  messages: [{ role: "user", content: { type: "text", text: `Hello ${name}` } }],
}));
await server.connect(new StdioServerTransport());
