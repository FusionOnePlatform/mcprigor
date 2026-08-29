import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "orders", version: "1.0.0" });
server.registerTool("find_order", {
  description: "Look up an order by id",
  inputSchema: { orderId: z.string() },
}, async ({ orderId }) => ({
  content: [{ type: "text", text: `Order ${orderId}: shipped` }],
  structuredContent: { orderId, status: "shipped", items: 3 },
}));
await server.connect(new StdioServerTransport());
