import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

const stubServer = `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "stub", version: "1.0.0" });
server.registerTool("add", { inputSchema: { a: z.number(), b: z.number() } }, async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }], structuredContent: { sum: a + b } }));
await server.connect(new StdioServerTransport());
`;

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rigor-mcp-"));
  roots.push(root);
  await writeFile(join(root, "server.mjs"), stubServer);
  await writeFile(join(root, "math.mcpr"), `MCP Test 1\nSuite: "Math"\nServer: node server.mjs\n\nTest: "adds"\n  Call tool "add" with:\n    a: 2\n    b: 3\n  Expect "structuredContent.sum" equals 5\n`);
  // stub needs the SDK; link this repo's node_modules
  const { symlink } = await import("node:fs/promises");
  await symlink(join(process.cwd(), "node_modules"), join(root, "node_modules"), "junction").catch(() => {});
  return root;
}

async function connect(root: string, env: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), "dist", "cli.js"), "serve", root], env: { ...process.env as Record<string, string>, ...env }, stderr: "pipe" });
  await client.connect(transport);
  return client;
}

describe("mcprigor serve (MCP server)", () => {
  it("lists tools and drives the full agent loop", async () => {
    const root = await fixture();
    const client = await connect(root);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["get_contract_drift", "get_history", "list_suites", "read_suite", "run_parity", "run_tests", "validate_suite", "write_suite"].sort());

      const listed = await client.callTool({ name: "list_suites", arguments: {} }) as any;
      expect(listed.structuredContent.suites.map((suite: any) => suite.path)).toContain("math.mcpr");

      const written = await client.callTool({ name: "write_suite", arguments: { path: "generated.mcpr", text: `MCP Test 1\nSuite: "Generated"\nServer: node server.mjs\n\nTest: "adds too"\n  Call tool "add" with:\n    a: 1\n    b: 1\n  Expect "structuredContent.sum" equals 2\n` } }) as any;
      expect(written.structuredContent.written).toBe(true);

      const valid = await client.callTool({ name: "validate_suite", arguments: { path: "generated.mcpr" } }) as any;
      expect(valid.structuredContent.valid).toBe(true);
      expect(valid.structuredContent.tests).toEqual(["adds too"]);

      const invalidText = `MCP Test 1\nSuite: "Broken"\nServer: node server.mjs\n\nTest: "no action"\n`;
      await client.callTool({ name: "write_suite", arguments: { path: "broken.mcpr", text: invalidText } });
      const invalid = await client.callTool({ name: "validate_suite", arguments: { path: "broken.mcpr" } }) as any;
      expect(invalid.structuredContent.valid).toBe(false);
      expect(invalid.structuredContent.line).toBeGreaterThan(0);

      const run = await client.callTool({ name: "run_tests", arguments: { paths: ["math.mcpr", "generated.mcpr"] } }) as any;
      expect(run.structuredContent.status).toBe("passed");
      expect(run.structuredContent.items).toHaveLength(2);
      expect(run.structuredContent.items[0].tests[0].status).toBe("passed");

      const history = await client.callTool({ name: "get_history", arguments: { suite: "math.mcpr" } }) as any;
      expect(history.structuredContent.entries.length).toBeGreaterThan(0);
      expect(history.structuredContent.entries[0].suite).toBe("math.mcpr");

      const read = await client.callTool({ name: "read_suite", arguments: { path: "math.mcpr" } }) as any;
      expect(read.structuredContent.text).toContain('Suite: "Math"');
    } finally { await client.close(); }
  }, 60000);

  it("rejects traversal, oversized batches, and non-mcpr writes", async () => {
    const root = await fixture();
    const client = await connect(root);
    try {
      const escape = await client.callTool({ name: "read_suite", arguments: { path: "../outside.mcpr" } }) as any;
      expect(escape.isError).toBe(true);
      const wrongType = await client.callTool({ name: "write_suite", arguments: { path: "notes.txt", text: "x" } }) as any;
      expect(wrongType.isError).toBe(true);
      const tooMany = await client.callTool({ name: "run_tests", arguments: { paths: Array.from({ length: 21 }, () => "math.mcpr") } }) as any;
      expect(tooMany.isError).toBe(true);
    } finally { await client.close(); }
  }, 60000);

  it("refuses to nest beyond the recursion guard", async () => {
    const root = await fixture();
    let failed = false;
    try { const client = await connect(root, { MCPRIGOR_MCP_DEPTH: "2" }); await client.close(); } catch { failed = true; }
    expect(failed).toBe(true);
  }, 30000);

  it("reports failing tests as failed with structured errors", async () => {
    const root = await fixture();
    await writeFile(join(root, "failing.mcpr"), `MCP Test 1\nSuite: "Failing"\nServer: node server.mjs\n\nTest: "wrong sum"\n  Call tool "add" with:\n    a: 2\n    b: 2\n  Expect "structuredContent.sum" equals 5\n`);
    const client = await connect(root);
    try {
      const run = await client.callTool({ name: "run_tests", arguments: { paths: ["failing.mcpr"] } }) as any;
      expect(run.isError).toBe(true);
      expect(run.structuredContent.status).toBe("failed");
      expect(run.structuredContent.items[0].tests[0].error).toBeTruthy();
    } finally { await client.close(); }
  }, 60000);
});

describe("mcprigor serve 1.2 additions", () => {
  it("run_tests honors the filter argument", async () => {
    const root = await fixture();
    await writeFile(join(root, "two.mcpr"), `MCP Test 1\nSuite: "Two"\nServer: node server.mjs\n\nTest: "first adds"\n  Call tool "add" with:\n    a: 1\n    b: 1\n  Expect "structuredContent.sum" equals 2\n\nTest: "second adds"\n  Call tool "add" with:\n    a: 2\n    b: 2\n  Expect "structuredContent.sum" equals 4\n`);
    const client = await connect(root);
    try {
      const run = await client.callTool({ name: "run_tests", arguments: { paths: ["two.mcpr"], filter: "first*" } }) as any;
      const tests = run.structuredContent.items[0].tests;
      expect(tests.map((t: any) => t.name)).toEqual(["first adds"]);
      expect(tests[0].status).toBe("passed");
    } finally { await client.close(); }
  }, 60000);

  it("get_contract_drift reports drift read-only and never rewrites the lock", async () => {
    const root = await fixture();
    const lockBefore = `version: 1\nserver:\n  name: stub\n  version: 1.0.0\n  capabilities: {}\nprotocolVersion: 2025-06-18\ncontractSha256: none\ntools:\n  - name: subtract\n    description: gone\nresources: []\nresourceTemplates: []\nprompts: []\n`;
    await writeFile(join(root, "mcp.lock.yaml"), lockBefore);
    const client = await connect(root);
    try {
      const drift = await client.callTool({ name: "get_contract_drift", arguments: { lock: "mcp.lock.yaml", suite: "math.mcpr" } }) as any;
      const payload = drift.structuredContent ?? JSON.parse(drift.content[0].text);
      expect(payload.breaking).toBe(true);
      expect(payload.report).toContain("subtract");
      expect(drift.isError).toBe(true);
      const after = await readFile(join(root, "mcp.lock.yaml"), "utf8");
      expect(after).toBe(lockBefore);
    } finally { await client.close(); }
  }, 60000);
});
