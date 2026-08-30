import YAML from "yaml";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTestFile } from "./qa-loader.js";
import { starterTemplate } from "./starter.js";
import { parityReport, runParity } from "./parity.js";
import { renderHtmlReport, terminalReport } from "./reporters.js";
import { runSuite } from "./runner.js";
import { TraceRecorder } from "./trace.js";
import { buildTimeline, type TimelineEntry } from "./timeline.js";
import { createRedactor } from "./redact.js";
import type { RunResult } from "./types.js";
import { FRAMEWORK_VERSION } from "./version.js";

export interface WorkspaceOptions { root?: string; host?: string; port?: number }
interface WorkspaceRunItem { suite: string; status: "running" | "passed" | "failed"; output: string; error?: string; startedAt: string; durationMs?: number; tests?: Array<{ name: string; status: string; durationMs: number; error?: string }>; result?: RunResult; timeline?: TimelineEntry[]; publishedUrl?: string }
interface WorkspaceRun { id: string; mode: string; status: "running" | "passed" | "failed"; startedAt: string; items: WorkspaceRunItem[] }
export interface HistoryEntry { at: string; mode: string; suite: string; status: "passed" | "failed"; durationMs: number; tests: Array<{ name: string; status: string; durationMs: number; error?: string }> }
/** Files that share suite extensions but are never test suites. */
const NON_SUITE_FILES = new Set(["package.json", "package-lock.json", "tsconfig.json", "mcprigor.config.yaml", "mcprigor.config.yml"]);
const NON_SUITE_PATTERNS = [/\.lock\.(yaml|yml|json)$/i, /\.snap\.json$/i, /-state\.json$/i, /\.config\.(yaml|yml|json)$/i];
const TEXT_EXTENSIONS = new Set([".mcpr", ".yaml", ".yml", ".json", ".csv"]);

export async function startWorkspace(options: WorkspaceOptions = {}): Promise<{ url: string; close(): Promise<void> }> {
  const root = await realpath(resolve(options.root ?? process.cwd())); const host = options.host ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("MCP-WEB-001 QA workspace binds only to loopback addresses");
  const csrf = randomBytes(32).toString("base64url"); const runs = new Map<string, WorkspaceRun>();
  const assets = resolve(dirname(fileURLToPath(import.meta.url)), "../workspace-assets");
  const server = createServer(async (req, res) => { securityHeaders(res); try { await route(req, res); } catch (error) { json(res, 500, { error: { code: "MCP-WEB-500", message: error instanceof Error ? error.message : String(error) } }); } });
  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`); const method = req.method ?? "GET";
    if (method !== "GET" && !authorized(req, csrf, `http://${req.headers.host}`)) return json(res, 403, { error: { code: "MCP-WEB-403", message: "Invalid workspace origin or CSRF token" } });
    if (url.pathname === "/" || url.pathname === "/app.js" || url.pathname === "/style.css") return asset(res, join(assets, url.pathname === "/" ? "index.html" : url.pathname.slice(1)));
    if (url.pathname === "/api/v1/bootstrap") return json(res, 200, { version: FRAMEWORK_VERSION, root: basename(root), csrf, capabilities: ["edit", "validate", "test", "parity", "evidence", "snapshots", "contracts", "report", ...(process.env.MCPRIGOR_PUBLISH_SITE && (process.env.NETLIFY_AUTH_TOKEN || process.env.MCPRIGOR_PUBLISH_TOKEN) ? ["publish"] : [])] });
    if (url.pathname === "/api/v1/suites" && method === "GET") return json(res, 200, { suites: await suites(root) });
    if (url.pathname === "/api/v1/file" && method === "GET") { const path = safePath(root, url.searchParams.get("path") ?? ""); const text = await limitedRead(path); return json(res, 200, { path: relative(root, path), text, etag: etag(text) }); }
    if (url.pathname === "/api/v1/file" && method === "POST") { const body = await bodyJson(req) as any; const name = typeof body?.name === "string" ? body.name.trim() : ""; if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}$/.test(name)) return json(res, 400, { error: { code: "MCP-WEB-400", message: "File name may use letters, numbers, spaces, dots, dashes, and underscores" } }); const fileName = name.endsWith(".mcpr") ? name : `${name}.mcpr`; const path = safePath(root, fileName); const exists = await stat(path).then(() => true).catch(() => false); if (exists) return json(res, 409, { error: { code: "MCP-WEB-409", message: `${fileName} already exists. Pick another name.` } }); await atomicWrite(path, starterTemplate); return json(res, 201, { path: relative(root, path) }); }
    if (url.pathname === "/api/v1/rename" && method === "POST") { const body = await bodyJson(req) as any; const from = safePath(root, typeof body?.from === "string" ? body.from : ""); const name = typeof body?.to === "string" ? body.to.trim() : ""; if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}$/.test(name)) return json(res, 400, { error: { code: "MCP-WEB-400", message: "File name may use letters, numbers, spaces, dots, dashes, and underscores" } }); const toName = name.endsWith(extname(from)) ? name : `${name}${extname(from)}`; const to = safePath(root, toName); if (await stat(to).then(() => true).catch(() => false)) return json(res, 409, { error: { code: "MCP-WEB-409", message: `${toName} already exists. Pick another name.` } }); await rename(from, to); await migrateHistory(join(root, ".mcprigor", "workspace-history.jsonl"), relative(root, from), relative(root, to)); return json(res, 200, { path: relative(root, to) }); }
    if (url.pathname === "/api/v1/file" && method === "PUT") { const body = await bodyJson(req) as any; const path = safePath(root, body.path); const current = await readFile(path, "utf8").catch(() => ""); if (body.etag && body.etag !== etag(current)) return json(res, 412, { error: { code: "MCP-WEB-412", message: "File changed since it was opened" } }); if (typeof body.text !== "string" || Buffer.byteLength(body.text) > 1024 * 1024) return json(res, 400, { error: { code: "MCP-WEB-400", message: "Text must be under 1 MiB" } }); await atomicWrite(path, body.text); return json(res, 200, { etag: etag(body.text) }); }
    if (url.pathname === "/api/v1/validate" && method === "POST") { const body = await bodyJson(req) as any; const path = safePath(root, body.path); try { const suite = await loadTestFile(path); return json(res, 200, { valid: true, suite: { name: suite.name, tests: suite.tests.length, parityTargets: Object.keys(suite.targets ?? {}) } }); } catch (error) { const span = (error as { span?: { start?: { line?: number; column?: number } } }).span; return json(res, 200, { valid: false, diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : String(error), ...(span?.start?.line ? { line: span.start.line, column: span.start.column ?? 1 } : {}) }] }); } }
    if (url.pathname === "/api/v1/runs" && method === "POST") { const body = await bodyJson(req) as any; const paths: unknown = Array.isArray(body?.paths) ? body.paths : typeof body?.path === "string" ? [body.path] : undefined; if (!body || !["test", "parity", "validate"].includes(body.mode) || !Array.isArray(paths) || !paths.length || paths.length > 20 || paths.some((item) => typeof item !== "string") || Object.keys(body).some((key) => !["path", "paths", "mode"].includes(key))) return json(res, 400, { error: { code: "MCP-WEB-400", message: "Run accepts 1-20 saved paths and test/parity/validate mode" } }); const resolved = (paths as string[]).map((item) => safePath(root, item)); const id = randomBytes(12).toString("hex"); const run: WorkspaceRun = { id, mode: body.mode, status: "running", startedAt: new Date().toISOString(), items: resolved.map((item) => ({ suite: relative(root, item), status: "running" as const, output: "Queued…", startedAt: new Date().toISOString() })) }; runs.set(id, run); void executeBatch(run, resolved); return json(res, 202, { runId: id }); }
    const runMatch = url.pathname.match(/^\/api\/v1\/runs\/([a-f0-9]+)$/); if (runMatch && method === "GET") { const run = runs.get(runMatch[1]!); return run ? json(res, 200, run) : json(res, 404, { error: { code: "MCP-WEB-404", message: "Run not found" } }); }
    if (url.pathname === "/api/v1/export/run" && method === "GET") {
      const run = runs.get(url.searchParams.get("id") ?? "");
      const index = Number(url.searchParams.get("item") ?? 0);
      const format = url.searchParams.get("format") ?? "pdf";
      const item = run?.items[index];
      if (!item?.result) return json(res, 404, { error: { code: "MCP-WEB-404", message: "No completed test result for that run item" } });
      const { runPdf, runCsv } = await import("./export.js");
      const { junitXml } = await import("./reporters.js");
      const stem = basename(item.suite).replace(/\.[^.]+$/, "");
      if (format === "csv") return download(res, `${stem}-report.csv`, "text/csv; charset=utf-8", Buffer.from(runCsv(item.result), "utf8"));
      if (format === "junit") return download(res, `${stem}-junit.xml`, "application/xml; charset=utf-8", Buffer.from(junitXml(item.result), "utf8"));
      return download(res, `${stem}-report.pdf`, "application/pdf", runPdf(item.result));
    }
    if (url.pathname === "/api/v1/export/trends" && method === "GET") {
      const format = url.searchParams.get("format") ?? "pdf";
      const suite = url.searchParams.get("suite") ?? undefined;
      let entries = (await readHistory(join(root, ".mcprigor", "workspace-history.jsonl"))).filter((entry) => entry.mode === "test");
      if (suite) entries = entries.filter((entry) => entry.suite === suite);
      if (!entries.length) return json(res, 404, { error: { code: "MCP-WEB-404", message: "No recorded test runs yet" } });
      const { trendsPdf, trendsCsv, historyCsv } = await import("./export.js");
      if (format === "csv") return download(res, "mcprigor-trends.csv", "text/csv; charset=utf-8", Buffer.from(trendsCsv(entries), "utf8"));
      if (format === "raw-csv") return download(res, "mcprigor-history.csv", "text/csv; charset=utf-8", Buffer.from(historyCsv(entries), "utf8"));
      return download(res, "mcprigor-trends.pdf", "application/pdf", trendsPdf(entries, suite));
    }
    if (url.pathname === "/api/v1/report" && method === "GET") {
      const run = runs.get(url.searchParams.get("id") ?? "");
      const item = run?.items[Number(url.searchParams.get("item") ?? 0)];
      if (!item?.result) return json(res, 404, { error: { code: "MCP-WEB-404", message: "No completed test result for that run item" } });
      // The report is a generated, fully escaped, self-contained document with its own inline style/script.
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderHtmlReport(item.result, item.timeline));
      return;
    }
    if (url.pathname === "/api/v1/publish" && method === "POST") {
      const body = await bodyJson(req) as { id?: unknown; item?: unknown };
      const run = runs.get(typeof body?.id === "string" ? body.id : "");
      const index = Number(body?.item ?? 0);
      const item = run?.items[index];
      if (!item?.result) return json(res, 404, { error: { code: "MCP-WEB-404", message: "No completed test result for that run item" } });
      const site = process.env.MCPRIGOR_PUBLISH_SITE;
      const token = process.env.NETLIFY_AUTH_TOKEN || process.env.MCPRIGOR_PUBLISH_TOKEN;
      if (!site || !token) return json(res, 409, { error: { code: "MCP-WEB-409", message: "Publishing needs MCPRIGOR_PUBLISH_SITE and NETLIFY_AUTH_TOKEN set before starting the workspace" } });
      const { publishToNetlify } = await import("./publish.js");
      const deployed = await publishToNetlify({ "/index.html": renderHtmlReport(item.result, item.timeline) }, { site, token, ...(process.env.MCPRIGOR_PUBLISH_API ? { apiBase: process.env.MCPRIGOR_PUBLISH_API } : {}) });
      item.publishedUrl = deployed.url;
      return json(res, 200, { url: deployed.url, deployId: deployed.deployId });
    }
    if (url.pathname === "/api/v1/evidence" && method === "GET") return json(res, 200, { entries: await directoryEntries(join(root, ".mcprigor")) });
    if (url.pathname === "/api/v1/history" && method === "GET") { const suite = url.searchParams.get("suite") ?? undefined; const test = url.searchParams.get("test") ?? undefined; const entries = await readHistory(join(root, ".mcprigor", "workspace-history.jsonl")); const filtered = entries.filter((entry) => (!suite || entry.suite === suite) && (!test || entry.tests.some((item) => item.name === test))).slice(-200); return json(res, 200, { entries: filtered }); }
    return json(res, 404, { error: { code: "MCP-WEB-404", message: "Not found" } });
  }
  async function executeBatch(run: WorkspaceRun, paths: string[]): Promise<void> {
    for (let index = 0; index < paths.length; index++) {
      const item = run.items[index]!; const startedAt = Date.now(); item.output = "Running…";
      try {
        const suite = await loadTestFile(paths[index]!);
        if (run.mode === "validate") { item.status = "passed"; item.output = `✓ Valid — ${suite.tests.length} test${suite.tests.length === 1 ? "" : "s"} ready`; }
        else if (run.mode === "parity") { if (!suite.targets) throw new Error("This suite has no targets section for parity"); const result = await runParity(suite, suite.targets, { cwd: root }); item.output = parityReport(result); item.status = result.status; }
        else { const trace = new TraceRecorder(createRedactor(suite.redact ?? [])); const result: RunResult = await runSuite(suite, { cwd: root, trace }); item.result = result; item.timeline = buildTimeline(trace.events); item.output = terminalReport(result); item.status = result.status; item.tests = result.tests.map((test) => ({ name: test.name, status: test.status, durationMs: test.durationMs, ...(test.error ? { error: test.error } : {}) })); await appendHistory(join(root, ".mcprigor", "workspace-history.jsonl"), { at: new Date().toISOString(), mode: run.mode, suite: item.suite, status: result.status, durationMs: Date.now() - startedAt, tests: item.tests }); }
      } catch (error) { item.status = "failed"; item.error = error instanceof Error ? error.message : String(error); item.output = item.error; }
      item.durationMs = Date.now() - startedAt;
    }
    run.status = run.items.some((item) => item.status === "failed") ? "failed" : "passed";
  }
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(options.port ?? 0, host, () => resolveListen()); });
  const address = server.address(); const port = typeof address === "object" && address ? address.port : options.port; return { url: `http://${host}:${port}`, close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())) };
}

export async function suites(root: string): Promise<Array<{ path: string; name: string }>> { const files: string[] = []; async function walk(dir: string, depth: number): Promise<void> { let items; try { items = await readdir(dir, { withFileTypes: true }); } catch { return; } for (const item of items) { if (item.name.startsWith(".") || ["node_modules", "dist", "Library", "Applications"].includes(item.name)) continue; const full = join(dir, item.name); if (item.isDirectory()) { if (depth < 6) await walk(full, depth + 1); } else if (extname(item.name) === ".mcpr") files.push(relative(root, full)); else if ([".yaml", ".yml", ".json"].includes(extname(item.name)) && !NON_SUITE_FILES.has(item.name) && !NON_SUITE_PATTERNS.some((pattern) => pattern.test(item.name)) && await looksLikeSuite(full)) files.push(relative(root, full)); if (files.length >= 200) return; } } await walk(root, 0); return files.sort().map((path) => ({ path, name: basename(path) })); }
export function safePath(root: string, input: string): string { if (!input || input.includes("\0") || input.includes("\\") || input.startsWith("/") || /^[A-Za-z]:/.test(input)) throw new Error("MCP-WEB-002 Invalid workspace path"); const output = resolve(root, input); if (output !== root && !output.startsWith(root + sep)) throw new Error("MCP-WEB-003 Path leaves workspace"); if (!TEXT_EXTENSIONS.has(extname(output))) throw new Error("MCP-WEB-004 Unsupported file type"); return output; }
/** Cheap structural check: list a YAML/JSON file as a suite only when it has the suite shape (version 1 + target + tests). */
async function looksLikeSuite(file: string): Promise<boolean> {
  try {
    const source = await readFile(file, "utf8");
    if (source.length > 1024 * 1024) return false;
    const value = (file.endsWith(".json") ? JSON.parse(source) : YAML.parse(source)) as Record<string, unknown> | null;
    return !!value && typeof value === "object" && !Array.isArray(value) && value.version === 1 && Array.isArray(value.tests) && typeof value.target === "object";
  } catch { return false; }
}
export async function limitedRead(path: string): Promise<string> { const info = await stat(path); if (info.size > 1024 * 1024) throw new Error("MCP-WEB-005 File exceeds 1 MiB"); return readFile(path, "utf8"); }
export async function atomicWrite(path: string, text: string): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`; await writeFile(temp, text, { mode: 0o600 }); await rename(temp, path); }
const HISTORY_LIMIT = 2000;
async function migrateHistory(path: string, from: string, to: string): Promise<void> { try { const entries = await readHistory(path); if (!entries.length) return; let changed = false; for (const entry of entries) if (entry.suite === from) { entry.suite = to; changed = true; } if (changed) await writeFile(path, entries.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8"); } catch { /* best-effort */ } }
export async function appendHistory(path: string, entry: HistoryEntry): Promise<void> { try { await mkdir(dirname(path), { recursive: true }); const existing = await readHistory(path); existing.push(entry); const trimmed = existing.slice(-HISTORY_LIMIT); await writeFile(path, trimmed.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8"); } catch { /* history is best-effort */ } }
export async function readHistory(path: string): Promise<HistoryEntry[]> { try { const text = await readFile(path, "utf8"); if (text.length > 20 * 1024 * 1024) return []; return text.split("\n").filter(Boolean).flatMap((line) => { try { const value = JSON.parse(line); return value && typeof value === "object" ? [value as HistoryEntry] : []; } catch { return []; } }); } catch { return []; } }
async function directoryEntries(path: string): Promise<string[]> { try { return (await readdir(path)).slice(0, 200); } catch { return []; } }
function etag(text: string): string { return `sha256:${createHash("sha256").update(text).digest("hex")}`; }
function authorized(req: IncomingMessage, token: string, origin: string): boolean { const supplied = String(req.headers["x-mcp-csrf"] ?? ""); return req.headers.origin === origin && supplied.length === token.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(token)); }
async function bodyJson(req: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error("Request body exceeds 1 MiB"); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
function securityHeaders(res: ServerResponse): void { res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("Cache-Control", "no-store"); }
async function asset(res: ServerResponse, path: string): Promise<void> { const content = await readFile(path); res.statusCode = 200; res.setHeader("Content-Type", extname(path) === ".js" ? "text/javascript; charset=utf-8" : extname(path) === ".css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8"); res.end(content); }
function download(res: ServerResponse, filename: string, type: string, body: Buffer): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(body);
}
function json(res: ServerResponse, status: number, value: unknown): void { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(value)); }
