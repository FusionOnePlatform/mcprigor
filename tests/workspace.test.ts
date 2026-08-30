import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startWorkspace } from "../src/workspace.js";

const roots: string[] = []; afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
async function fixture() { const root = await mkdtemp(join(tmpdir(), "rigor-web-")); roots.push(root); await writeFile(join(root, "suite.mcpr"), `Suite: "Workspace"\nServer: node missing.js\nTest: "ping"\n  Send "ping"\n`); return root; }
describe("QA workspace", () => {
  it("serves UI, lists suites, reads files, and validates", async () => { const root = await fixture(); const app = await startWorkspace({ root }); try { expect((await fetch(app.url)).status).toBe(200); const boot = await (await fetch(`${app.url}/api/v1/bootstrap`)).json() as any; expect(boot.capabilities).toContain("parity"); const list = await (await fetch(`${app.url}/api/v1/suites`)).json() as any; expect(list.suites[0].path).toBe("suite.mcpr"); const file = await (await fetch(`${app.url}/api/v1/file?path=suite.mcpr`)).json() as any; const validated = await fetch(`${app.url}/api/v1/validate`, { method: "POST", headers: { "content-type": "application/json", origin: app.url, "x-mcp-csrf": boot.csrf }, body: JSON.stringify({ path: "suite.mcpr" }) }); expect((await validated.json() as any).valid).toBe(true); expect(file.etag).toMatch(/^sha256:/); } finally { await app.close(); } });
  it("rejects traversal and unauthorized writes", async () => { const root = await fixture(); const app = await startWorkspace({ root }); try { expect((await fetch(`${app.url}/api/v1/file?path=../outside.mcpr`)).status).toBe(500); expect((await fetch(`${app.url}/api/v1/file`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "suite.mcpr", text: "x" }) })).status).toBe(403); } finally { await app.close(); } });
  it("uses optimistic concurrency for saves", async () => { const root = await fixture(); const app = await startWorkspace({ root }); try { const boot = await (await fetch(`${app.url}/api/v1/bootstrap`)).json() as any; const headers = { "content-type": "application/json", origin: app.url, "x-mcp-csrf": boot.csrf }; const old = await (await fetch(`${app.url}/api/v1/file?path=suite.mcpr`)).json() as any; expect((await fetch(`${app.url}/api/v1/file`, { method: "PUT", headers, body: JSON.stringify({ path: "suite.mcpr", text: old.text + "# saved\n", etag: old.etag }) })).status).toBe(200); expect((await fetch(`${app.url}/api/v1/file`, { method: "PUT", headers, body: JSON.stringify({ path: "suite.mcpr", text: "stale", etag: old.etag }) })).status).toBe(412); } finally { await app.close(); } });
  it("creates new starter test files with validation", async () => { const root = await fixture(); const app = await startWorkspace({ root }); try { const boot = await (await fetch(`${app.url}/api/v1/bootstrap`)).json() as any; const headers = { "content-type": "application/json", origin: app.url, "x-mcp-csrf": boot.csrf }; const created = await fetch(`${app.url}/api/v1/file`, { method: "POST", headers, body: JSON.stringify({ name: "checkout tests" }) }); expect(created.status).toBe(201); expect((await created.json() as any).path).toBe("checkout tests.mcpr"); const read = await (await fetch(`${app.url}/api/v1/file?path=${encodeURIComponent("checkout tests.mcpr")}`)).json() as any; expect(read.text).toContain("Suite:"); expect((await fetch(`${app.url}/api/v1/file`, { method: "POST", headers, body: JSON.stringify({ name: "checkout tests" }) })).status).toBe(409); expect((await fetch(`${app.url}/api/v1/file`, { method: "POST", headers, body: JSON.stringify({ name: "../escape" }) })).status).toBe(400); expect((await fetch(`${app.url}/api/v1/file`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "no-csrf" }) })).status).toBe(403); } finally { await app.close(); } });
  it("runs batches, reports per-file results, and records history", async () => { const root = await fixture(); await writeFile(join(root, "second.mcpr"), `Suite: "Second"\nServer: node also-missing.js\nTest: "ping"\n  Send "ping"\n`); const app = await startWorkspace({ root }); try { const boot = await (await fetch(`${app.url}/api/v1/bootstrap`)).json() as any; const headers = { "content-type": "application/json", origin: app.url, "x-mcp-csrf": boot.csrf }; const started = await fetch(`${app.url}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify({ paths: ["suite.mcpr", "second.mcpr"], mode: "validate" }) }); expect(started.status).toBe(202); const { runId } = await started.json() as any; let run: any; for (let i = 0; i < 100; i++) { run = await (await fetch(`${app.url}/api/v1/runs/${runId}`)).json(); if (run.status !== "running") break; await new Promise((r) => setTimeout(r, 100)); } expect(run.items).toHaveLength(2); expect(run.items.map((x: any) => x.suite).sort()).toEqual(["second.mcpr", "suite.mcpr"]); expect(run.status).toBe("passed"); const bad = await fetch(`${app.url}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify({ paths: [], mode: "test" }) }); expect(bad.status).toBe(400); const history = await (await fetch(`${app.url}/api/v1/history`)).json() as any; expect(Array.isArray(history.entries)).toBe(true); } finally { await app.close(); } });
  it("renames files and migrates run history", async () => { const root = await fixture(); const app = await startWorkspace({ root }); try { const boot = await (await fetch(`${app.url}/api/v1/bootstrap`)).json() as any; const headers = { "content-type": "application/json", origin: app.url, "x-mcp-csrf": boot.csrf }; await writeFile(join(root, ".mcprigor", "workspace-history.jsonl"), JSON.stringify({ at: new Date().toISOString(), mode: "test", suite: "suite.mcpr", status: "passed", durationMs: 5, tests: [{ name: "ping", status: "passed", durationMs: 5 }] }) + "\n").catch(async () => { const { mkdir } = await import("node:fs/promises"); await mkdir(join(root, ".mcprigor"), { recursive: true }); await writeFile(join(root, ".mcprigor", "workspace-history.jsonl"), JSON.stringify({ at: new Date().toISOString(), mode: "test", suite: "suite.mcpr", status: "passed", durationMs: 5, tests: [{ name: "ping", status: "passed", durationMs: 5 }] }) + "\n"); }); const renamed = await fetch(`${app.url}/api/v1/rename`, { method: "POST", headers, body: JSON.stringify({ from: "suite.mcpr", to: "smoke checks" }) }); expect(renamed.status).toBe(200); expect((await renamed.json() as any).path).toBe("smoke checks.mcpr"); const list = await (await fetch(`${app.url}/api/v1/suites`)).json() as any; expect(list.suites.map((x: any) => x.path)).toContain("smoke checks.mcpr"); const history = await (await fetch(`${app.url}/api/v1/history`)).json() as any; expect(history.entries[0].suite).toBe("smoke checks.mcpr"); expect((await fetch(`${app.url}/api/v1/rename`, { method: "POST", headers, body: JSON.stringify({ from: "smoke checks.mcpr", to: "../escape" }) })).status).toBe(400); expect((await fetch(`${app.url}/api/v1/rename`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: "smoke checks.mcpr", to: "x" }) })).status).toBe(403); } finally { await app.close(); } });
  it("tolerates unreadable and hidden directories when listing suites", async () => { const root = await fixture(); const { mkdir, chmod } = await import("node:fs/promises"); await mkdir(join(root, ".Trash")); await writeFile(join(root, ".Trash", "hidden.mcpr"), "x"); await mkdir(join(root, "locked")); await writeFile(join(root, "locked", "inner.mcpr"), `Suite: "L"\nServer: node x.js\nTest: "t"\n  Send "ping"\n`); await chmod(join(root, "locked"), 0o000); const app = await startWorkspace({ root }); try { const response = await fetch(`${app.url}/api/v1/suites`); expect(response.status).toBe(200); const list = await response.json() as any; expect(list.suites.map((x: any) => x.path)).toContain("suite.mcpr"); expect(list.suites.some((x: any) => x.path.includes(".Trash"))).toBe(false); } finally { await chmod(join(root, "locked"), 0o755).catch(() => {}); await app.close(); } });

  it("serves the HTML report with timeline and publishes it to hosting", async () => {
    const root = await runnableFixture();
    const { createServer } = await import("node:http");
    const uploads: string[] = [];
    const netlify = createServer((req, res) => {
      let body = ""; req.on("data", (part) => body += part);
      req.on("end", () => {
        if (req.method === "POST") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "wd1", state: "uploading", required: [] })); return; }
        if (req.method === "PUT") { uploads.push(req.url ?? ""); res.writeHead(200).end("{}"); return; }
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ state: "ready", ssl_url: "https://wd1--reports.netlify.app" }));
      });
    });
    await new Promise<void>((resolveListen) => netlify.listen(0, "127.0.0.1", resolveListen));
    const port = (netlify.address() as { port: number }).port;
    const previous = { site: process.env.MCPRIGOR_PUBLISH_SITE, token: process.env.NETLIFY_AUTH_TOKEN, api: process.env.MCPRIGOR_PUBLISH_API };
    process.env.MCPRIGOR_PUBLISH_SITE = "reports"; process.env.NETLIFY_AUTH_TOKEN = "workspace-token"; process.env.MCPRIGOR_PUBLISH_API = `http://127.0.0.1:${port}`;
    const app = await startWorkspace({ root });
    try {
      const boot = await (await fetch(`${app.url}/api/v1/bootstrap`)).json() as any;
      expect(boot.capabilities).toContain("report");
      expect(boot.capabilities).toContain("publish");
      const headers = { "content-type": "application/json", origin: app.url, "x-mcp-csrf": boot.csrf };
      const started = await fetch(`${app.url}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify({ paths: ["suite.mcpr"], mode: "test" }) });
      const { runId } = await started.json() as any;
      let run: any; for (let i = 0; i < 200; i++) { run = await (await fetch(`${app.url}/api/v1/runs/${runId}`)).json(); if (run.status !== "running") break; await new Promise((r) => setTimeout(r, 100)); }
      expect(run.status).toBe("passed");
      expect(run.items[0].timeline.some((entry: any) => entry.method === "tools/call")).toBe(true);
      const page = await fetch(`${app.url}/api/v1/report?id=${runId}&item=0`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Session timeline");
      expect(html).toContain("tools/call");
      expect((await fetch(`${app.url}/api/v1/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: runId, item: 0 }) })).status).toBe(403);
      const published = await fetch(`${app.url}/api/v1/publish`, { method: "POST", headers, body: JSON.stringify({ id: runId, item: 0 }) });
      expect(published.status).toBe(200);
      expect((await published.json() as any).url).toBe("https://wd1--reports.netlify.app");
      const after = await (await fetch(`${app.url}/api/v1/runs/${runId}`)).json() as any;
      expect(after.items[0].publishedUrl).toBe("https://wd1--reports.netlify.app");
      expect((await fetch(`${app.url}/api/v1/report?id=missing&item=0`)).status).toBe(404);
    } finally {
      await app.close();
      await new Promise<void>((resolveClose) => netlify.close(() => resolveClose()));
      process.env.MCPRIGOR_PUBLISH_SITE = previous.site ?? ""; if (!previous.site) delete process.env.MCPRIGOR_PUBLISH_SITE;
      process.env.NETLIFY_AUTH_TOKEN = previous.token ?? ""; if (!previous.token) delete process.env.NETLIFY_AUTH_TOKEN;
      process.env.MCPRIGOR_PUBLISH_API = previous.api ?? ""; if (!previous.api) delete process.env.MCPRIGOR_PUBLISH_API;
    }
  }, 60_000);

  it("hides publish capability without hosting configuration", async () => {
    const previous = { site: process.env.MCPRIGOR_PUBLISH_SITE, token: process.env.NETLIFY_AUTH_TOKEN };
    delete process.env.MCPRIGOR_PUBLISH_SITE; delete process.env.NETLIFY_AUTH_TOKEN;
    const root = await fixture(); const app = await startWorkspace({ root });
    try {
      const boot = await (await fetch(`${app.url}/api/v1/bootstrap`)).json() as any;
      expect(boot.capabilities).not.toContain("publish");
    } finally {
      await app.close();
      if (previous.site) process.env.MCPRIGOR_PUBLISH_SITE = previous.site;
      if (previous.token) process.env.NETLIFY_AUTH_TOKEN = previous.token;
    }
  });
});

async function runnableFixture() {
  const root = await mkdtemp(join(tmpdir(), "rigor-web-run-")); roots.push(root);
  const { mkdir, symlink } = await import("node:fs/promises");
  await mkdir(join(root, "node_modules"));
  await symlink(join(process.cwd(), "node_modules", "@modelcontextprotocol"), join(root, "node_modules", "@modelcontextprotocol"), "junction");
  await writeFile(join(root, "server.mjs"), `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nimport { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";\nconst s=new McpServer({name:"w",version:"1"}); s.registerTool("ping",{},async()=>({content:[{type:"text",text:"pong"}],structuredContent:{ok:true}})); await s.connect(new StdioServerTransport());\n`);
  await writeFile(join(root, "suite.mcpr"), `MCP Test 1\nServer: node server.mjs\nTest: "ping"\n  Call tool "ping"\n  Expect "structuredContent.ok" equals true\n`);
  return root;
}
