import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const CLI = join(process.cwd(), "dist", "cli.js");
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

const stub = `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const server = new McpServer({ name: "stub", version: "1.0.0" });
server.registerTool("ping", {}, async () => ({ content: [{ type: "text", text: "pong" }], structuredContent: { ok: true } }));
await server.connect(new StdioServerTransport());
`;

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rigor-cli-"));
  roots.push(root);
  await writeFile(join(root, "good-server.mjs"), stub);
  await writeFile(join(root, "suite.mcpr"), `MCP Test 1\nSuite: "S"\nServer: node missing-server.js\n\nTest: "ping works"\n  Call tool "ping"\n  Expect "structuredContent.ok" equals true\n`);
  await symlink(join(process.cwd(), "node_modules"), join(root, "node_modules"), "junction").catch(() => {});
  return root;
}

async function run(root: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  try { const { stdout, stderr } = await exec(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, ...env } }); return { code: 0, out: stdout + stderr }; }
  catch (error) { const failure = error as { code?: number; stdout?: string; stderr?: string }; return { code: failure.code ?? 1, out: (failure.stdout ?? "") + (failure.stderr ?? "") }; }
}

describe("cli target overrides and flags", () => {
  it("--command overrides the suite's declared Server line", async () => {
    const root = await fixture();
    const result = await run(root, ["test", "suite.mcpr", "--command", "node good-server.mjs"]);
    expect(result.out).toContain("Target override");
    expect(result.out).toContain("1 passed, 0 failed");
    expect(result.code).toBe(0);
  }, 60000);

  it("without the override the declared broken target fails", async () => {
    const root = await fixture();
    const result = await run(root, ["test", "suite.mcpr"]);
    expect(result.code).toBe(1);
  }, 60000);

  it("rejects --command together with --url and rejects unknown flags", async () => {
    const root = await fixture();
    const both = await run(root, ["test", "suite.mcpr", "--command", "node good-server.mjs", "--url", "http://x/"]);
    expect(both.out).toContain("not both");
    const typo = await run(root, ["test", "suite.mcpr", "--comand", "node good-server.mjs"]);
    expect(typo.out).toContain("Unknown option");
    expect(typo.code).not.toBe(0);
  }, 60000);

  it("emits GitHub annotations for failures when GITHUB_ACTIONS is set", async () => {
    const root = await fixture();
    const result = await run(root, ["test", "suite.mcpr"], { GITHUB_ACTIONS: "true" });
    expect(result.out).toMatch(/::error file=suite\.mcpr,title=MCP Rigor: ping works::/);
    expect(result.out).toMatch(/::notice title=MCP Rigor::0 passed, 1 failed/);
  }, 60000);

  it("refuses --watch with --update-snapshots", async () => {
    const root = await fixture();
    const result = await run(root, ["test", "suite.mcpr", "--watch", "--update-snapshots", "--snapshot", "s.snap.json"]);
    expect(result.out).toContain("--watch cannot be combined");
  }, 60000);
});

describe("mcprigor drift gate", () => {
  const lock = `version: 1\nserver:\n  name: stub\n  version: 1.0.0\n  capabilities: {}\nprotocolVersion: 2025-06-18\ncontractSha256: none\ntools:\n  - name: vanished\n    description: old\nresources: []\nresourceTemplates: []\nprompts: []\n`;

  it("fails on breaking drift by default and annotates in CI", async () => {
    const root = await fixture();
    await writeFile(join(root, "suite2.mcpr"), `MCP Test 1\nSuite: "S2"\nServer: node good-server.mjs\n\nTest: "ping"\n  Call tool "ping"\n  Expect "structuredContent.ok" equals true\n`);
    await writeFile(join(root, "mcp.lock.yaml"), lock);
    const result = await run(root, ["drift", "suite2.mcpr", "--against", "mcp.lock.yaml"], { GITHUB_ACTIONS: "true" });
    expect(result.code).toBe(1);
    expect(result.out).toContain("Drift gate failed");
    expect(result.out).toMatch(/::error title=MCP drift MCP-DRIFT-100::.*vanished/);
  }, 60000);

  it("--fail-on none reports drift without failing; bad value rejected", async () => {
    const root = await fixture();
    await writeFile(join(root, "suite2.mcpr"), `MCP Test 1\nSuite: "S2"\nServer: node good-server.mjs\n\nTest: "ping"\n  Call tool "ping"\n  Expect "structuredContent.ok" equals true\n`);
    await writeFile(join(root, "mcp.lock.yaml"), lock);
    const ok = await run(root, ["drift", "suite2.mcpr", "--against", "mcp.lock.yaml", "--fail-on", "none"]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("within the allowed gate");
    const bad = await run(root, ["drift", "suite2.mcpr", "--against", "mcp.lock.yaml", "--fail-on", "sometimes"]);
    expect(bad.out).toContain("--fail-on must be one of");
  }, 60000);
});

describe("mcprigor record", () => {
  it("proxies a session and generates a runnable draft", async () => {
    const root = await fixture();
    const draft = await new Promise<string>((resolvePromise, reject) => {
      const { spawn } = require("node:child_process") as typeof import("node:child_process");
      const proc = spawn(process.execPath, [CLI, "record", "--out", "draft.mcpr", "--", "node", "good-server.mjs"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
      let buffer = "";
      const send = (message: object) => proc.stdin.write(JSON.stringify(message) + "\n");
      let called = false;
      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.includes('"id":1') && !called) { called = true; send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ping", arguments: {} } }); }
        if (buffer.includes('"id":2')) proc.stdin.end();
      });
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
      proc.on("exit", async () => {
        try { resolvePromise(await readFile(join(root, "draft.mcpr"), "utf8")); } catch (error) { reject(error); }
      });
      setTimeout(() => { proc.kill(); reject(new Error("record timed out")); }, 20000);
    });
    expect(draft).toContain('Call tool "ping"');
    expect(draft).toContain('Expect "structuredContent.ok" equals true');
    const rerun = await run(root, ["test", "draft.mcpr"]);
    expect(rerun.code).toBe(0);
  }, 60000);
});

describe("mcprigor.config.yaml environments", () => {
  it("--env selects a config target and overrides the suite", async () => {
    const root = await fixture();
    await writeFile(join(root, "mcprigor.config.yaml"), `environments:\n  good: node good-server.mjs\n`);
    const result = await run(root, ["test", "suite.mcpr", "--env", "good"]);
    expect(result.out).toContain("Environment: good");
    expect(result.code).toBe(0);
    const missing = await run(root, ["test", "suite.mcpr", "--env", "ghost"]);
    expect(missing.out).toContain("MCP-PROJ-006");
  }, 60000);
});
