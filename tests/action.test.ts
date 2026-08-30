import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("GitHub Action", () => {
  it("has a valid composite action manifest", async () => {
    const manifest = YAML.parse(await readFile("action.yml", "utf8"));
    expect(manifest.name).toBe("MCP Rigor");
    expect(manifest.runs.using).toBe("composite");
    expect(manifest.inputs.suites.default).toBe("tests/**/*.mcpr");
    expect(manifest.outputs.status.value).toContain("steps.rigor.outputs.status");
  });

  it("runs matched suites and writes a rich marker-based report", async () => {
    const root = await mkdtemp(join(tmpdir(), "rigor-action-")); roots.push(root);
    await mkdir(join(root, "tests")); await mkdir(join(root, "node_modules"));
    await symlink(process.cwd(), join(root, "node_modules", "mcprigor"), "junction");
    await writeFile(join(root, "server.mjs"), `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nimport { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";\nconst s=new McpServer({name:"x",version:"1"}); s.registerTool("ping",{},async()=>({content:[{type:"text",text:"pong"}],structuredContent:{ok:true}})); await s.connect(new StdioServerTransport());\n`);
    await symlink(join(process.cwd(), "node_modules", "@modelcontextprotocol"), join(root, "node_modules", "@modelcontextprotocol"), "junction");
    await writeFile(join(root, "tests", "smoke.mcpr"), `MCP Test 1\nServer: node server.mjs\nTest: "ping"\n  Call tool "ping"\n  Expect "structuredContent.ok" equals true\n`);
    const output = join(root, "outputs.txt");
    await exec(process.execPath, [join(process.cwd(), "action", "run.mjs")], { cwd: root, env: { ...process.env, GITHUB_WORKSPACE: root, GITHUB_OUTPUT: output, INPUT_SUITES: "tests/**/*.mcpr", INPUT_FLAKY: "false", GITHUB_SHA: "abcdef123456" } });
    const report = await readFile(join(root, ".mcprigor", "action", "report.md"), "utf8");
    expect(report).toContain("<!-- mcprigor-action-report -->");
    expect(report).toContain("1 passed · 0 failed");
    expect(report).toContain("tests/smoke.mcpr");
    expect(await readFile(output, "utf8")).toContain("status=passed");
  }, 60_000);
});
