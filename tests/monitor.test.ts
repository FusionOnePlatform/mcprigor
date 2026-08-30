import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { monitorSuite, parseDuration } from "../src/monitor.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe("scheduled monitoring", () => {
  it("parses durations with a one-second minimum", () => {
    expect(parseDuration("15m")).toBe(900_000);
    expect(parseDuration("1.5h")).toBe(5_400_000);
    expect(() => parseDuration("500ms")).toThrow(/at least 1s/);
    expect(() => parseDuration("soon")).toThrow(/duration/);
  });

  it("runs an HTTP suite repeatedly, appends history, and posts webhook events", async () => {
    const root = await mkdtemp(join(tmpdir(), "rigor-monitor-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
    const notifications: unknown[] = [];
    const webhook = createServer((req, res) => { let body = ""; req.on("data", (part) => body += part); req.on("end", () => { notifications.push(JSON.parse(body)); res.writeHead(204).end(); }); });
    await listen(webhook); cleanups.push(() => close(webhook));
    const target = await startMcpServer();
    const suite = join(root, "monitor.yaml");
    await writeFile(suite, `version: 1\nname: Monitor\ntarget:\n  transport: streamable-http\n  url: ${target}\ntests:\n  - name: ping\n    steps:\n      - request: { method: ping }\n        assert: { status: success }\n`);
    const webhookPort = (webhook.address() as { port: number }).port;
    const events = await monitorSuite(suite, { cwd: root, everyMs: 1, maxRuns: 2, notify: `http://127.0.0.1:${webhookPort}/notify`, notifyOn: "always" });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.result.status === "passed")).toBe(true);
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({ source: "mcprigor", event: "monitor.always", status: "passed" });
    expect(await readFile(join(root, ".mcprigor", "workspace-history.jsonl"), "utf8")).toContain('"suite":"monitor.yaml"');
  }, 60_000);
});

async function startMcpServer(): Promise<string> {
  const server: HttpServer = createServer(async (req, res) => {
    const mcp = new McpServer({ name: "monitor-fixture", version: "1" });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport); await transport.handleRequest(req, res);
  });
  await listen(server); cleanups.push(() => close(server));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
}
function listen(server: HttpServer): Promise<void> { return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); }
function close(server: HttpServer): Promise<void> { return new Promise((resolve) => server.close(() => resolve())); }
