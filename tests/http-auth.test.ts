import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadTestFile } from "../src/qa-loader.js";
import { runSuite } from "../src/runner.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function startProtectedServer(token: string): Promise<string> {
  const server: HttpServer = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return; }
    const mcp = new McpServer({ name: "secure", version: "1.0.0" });
    mcp.registerTool("whoami", {}, async () => ({ content: [{ type: "text" as const, text: "ok" }], structuredContent: { authenticated: true } }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
}

async function suiteFile(url: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rigor-auth-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "auth.mcpr");
  await writeFile(file, `MCP Test 1\nSuite: "Bearer auth"\nMCP URL: ${url}\n\nServer options:\n  headers:\n    Authorization: "Bearer \${env.RIGOR_TEST_TOKEN}"\n\nTest: "authenticated call succeeds"\n  Call tool "whoami"\n  Expect "structuredContent.authenticated" equals true\n`);
  return file;
}

describe("bearer-token HTTP targets", () => {
  it("authenticates with the token from the environment and redacts it", async () => {
    const url = await startProtectedServer("sekrit-123");
    const file = await suiteFile(url);
    process.env.RIGOR_TEST_TOKEN = "sekrit-123";
    try {
      const result = await runSuite(await loadTestFile(file));
      expect(result.status).toBe("passed");
      expect(JSON.stringify(result)).not.toContain("sekrit-123");
    } finally { delete process.env.RIGOR_TEST_TOKEN; }
  }, 30000);

  it("surfaces the server's rejection for a wrong token", async () => {
    const url = await startProtectedServer("sekrit-123");
    const file = await suiteFile(url);
    process.env.RIGOR_TEST_TOKEN = "wrong-token";
    try {
      const result = await runSuite(await loadTestFile(file));
      expect(result.status).toBe("failed");
      expect(result.tests[0]!.error).toContain("unauthorized");
      expect(JSON.stringify(result)).not.toContain("wrong-token");
    } finally { delete process.env.RIGOR_TEST_TOKEN; }
  }, 30000);

  it("fails fast when the token variable is missing", async () => {
    const url = await startProtectedServer("sekrit-123");
    const file = await suiteFile(url);
    delete process.env.RIGOR_TEST_TOKEN;
    await expect(async () => runSuite(await loadTestFile(file))).rejects.toThrow(/Environment variable not found: RIGOR_TEST_TOKEN/);
  }, 30000);
});

describe("Token from: client-credentials helper", () => {
  it("runs the token command before connect and redacts the fetched token", async () => {
    const token = "cc-secret-token-98765";
    const url = await startProtectedServer(token);
    const dir = await mkdtemp(join(tmpdir(), "rigor-tokenfrom-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const script = join(dir, "get-token.mjs");
    await writeFile(script, `process.stdout.write(${JSON.stringify(token)});`);
    const file = join(dir, "suite.mcpr");
    await writeFile(file, `MCP Test 1\nSuite: "Token helper"\nMCP URL: ${url}\nServer options:\n  Token from: node ${script}\n\nTest: "authenticated call"\n  Call tool "whoami"\n  Expect "structuredContent.authenticated" equals true\n`);
    const suite = await loadTestFile(file);
    expect((suite.target as { tokenFrom?: string }).tokenFrom).toContain("get-token.mjs");
    const result = await runSuite(suite, {});
    expect(result.status).toBe("passed");
    expect(JSON.stringify(result)).not.toContain(token);
  }, 30000);

  it("fails with MCP-AUTH-002 when the token command prints nothing", async () => {
    const url = await startProtectedServer("whatever");
    const dir = await mkdtemp(join(tmpdir(), "rigor-tokenfrom-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const script = join(dir, "empty.mjs");
    await writeFile(script, "");
    const file = join(dir, "suite.mcpr");
    await writeFile(file, `MCP Test 1\nSuite: "Token helper"\nMCP URL: ${url}\nServer options:\n  Token from: node ${script}\n\nTest: "call"\n  Call tool "whoami"\n  Expect "structuredContent.authenticated" equals true\n`);
    const suite = await loadTestFile(file);
    await expect(runSuite(suite, {})).rejects.toThrow(/MCP-AUTH-002/);
  }, 30000);
});
