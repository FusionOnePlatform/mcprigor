import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startWorkspace, resolveFolder } from "../src/workspace.js";

const starter = `MCP Test 1\nSuite: "Demo"\nServer: node server.js\n\nTest: "one"\n  Call tool "x"\n  Expect tool succeeded\n`;

async function boot(url: string): Promise<{ csrf: string; root: string; rootPath: string; capabilities: string[] }> {
  const response = await fetch(`${url}/api/v1/bootstrap`);
  return response.json() as never;
}

describe("workspace folder switching", () => {
  it("browses folders and switches the workspace root", async () => {
    const a = await mkdtemp(join(tmpdir(), "rigor-ws-a-"));
    const b = await mkdtemp(join(tmpdir(), "rigor-ws-b-"));
    await mkdir(join(b, "nested"));
    await writeFile(join(a, "alpha.mcpr"), starter);
    await writeFile(join(b, "beta.mcpr"), starter);
    await writeFile(join(b, "nested", "gamma.mcpr"), starter);
    const workspace = await startWorkspace({ root: a });
    try {
      const before = await boot(workspace.url);
      expect(before.capabilities).toContain("workspace-switch");
      expect(before.rootPath).toBeTruthy();

      // Suites come from A.
      let suites = await (await fetch(`${workspace.url}/api/v1/suites`)).json() as { suites: Array<{ path: string }> };
      expect(suites.suites.map((s) => s.path)).toEqual(["alpha.mcpr"]);

      // Browse endpoint lists subfolders, counts top-level suites, and reports the current workspace.
      const browsed = await (await fetch(`${workspace.url}/api/v1/folders?path=${encodeURIComponent(b)}`)).json() as { path: string; parent: string | null; home: string; folders: string[]; suiteCount: number; current: { root: string; rootPath: string; suiteCount: number } };
      expect(browsed.folders).toContain("nested");
      expect(browsed.suiteCount).toBe(1); // top-level only: beta.mcpr (nested/gamma is not counted by the fast picker)
      expect(browsed.home).toBe(homedir());
      expect(browsed.current.rootPath).toBe(before.rootPath);
      expect(browsed.current.suiteCount).toBe(1); // alpha.mcpr

      // Default browse goes home.
      const defaultBrowse = await (await fetch(`${workspace.url}/api/v1/folders`)).json() as { path: string };
      expect(defaultBrowse.path).toBe(await resolveFolder(homedir()));

      // Switch to B (CSRF + origin enforced).
      const origin = workspace.url;
      const headers = { "content-type": "application/json", "x-mcp-csrf": before.csrf, origin };
      const switched = await fetch(`${workspace.url}/api/v1/workspace`, { method: "POST", headers, body: JSON.stringify({ path: b }) });
      expect(switched.status).toBe(200);
      const body = await switched.json() as { root: string; rootPath: string };
      expect(body.rootPath).toBe(await resolveFolder(b));

      // Suites now come from B; files from A are unreachable.
      suites = await (await fetch(`${workspace.url}/api/v1/suites`)).json() as { suites: Array<{ path: string }> };
      expect(suites.suites.map((s) => s.path).sort()).toEqual(["beta.mcpr", "nested/gamma.mcpr"]);
      const stale = await fetch(`${workspace.url}/api/v1/file?path=alpha.mcpr`);
      expect(stale.status).toBe(500);
    } finally { await workspace.close(); }
  });

  it("rejects bad switch targets and unauthorized requests", async () => {
    const a = await mkdtemp(join(tmpdir(), "rigor-ws-c-"));
    const workspace = await startWorkspace({ root: a });
    try {
      const { csrf } = await boot(workspace.url);
      const headers = { "content-type": "application/json", "x-mcp-csrf": csrf, origin: workspace.url };
      // Missing CSRF → 403.
      const noCsrf = await fetch(`${workspace.url}/api/v1/workspace`, { method: "POST", headers: { "content-type": "application/json", origin: workspace.url }, body: JSON.stringify({ path: a }) });
      expect(noCsrf.status).toBe(403);
      // Relative path → 400.
      const relativePath = await fetch(`${workspace.url}/api/v1/workspace`, { method: "POST", headers, body: JSON.stringify({ path: "relative/path" }) });
      expect(relativePath.status).toBe(400);
      // Nonexistent → 400 with a clear message.
      const missing = await fetch(`${workspace.url}/api/v1/workspace`, { method: "POST", headers, body: JSON.stringify({ path: join(a, "does-not-exist") }) });
      expect(missing.status).toBe(400);
      expect(((await missing.json()) as { error: { message: string } }).error.message).toMatch(/not found/i);
      // A file, not a folder → 400.
      await writeFile(join(a, "file.mcpr"), starter);
      const notDir = await fetch(`${workspace.url}/api/v1/workspace`, { method: "POST", headers, body: JSON.stringify({ path: join(a, "file.mcpr") }) });
      expect(notDir.status).toBe(400);
    } finally { await workspace.close(); }
  });

  it("resolveFolder expands ~ and normalizes", async () => {
    expect(await resolveFolder("~")).toBe(await resolveFolder(homedir()));
    await expect(resolveFolder("")).rejects.toThrow(/MCP-WEB-002/);
    await expect(resolveFolder("relative")).rejects.toThrow(/absolute/);
  });
});
