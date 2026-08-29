import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
