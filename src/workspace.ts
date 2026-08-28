import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { loadTestFile } from "./qa-loader.js";
import { parityReport, runParity } from "./parity.js";
import { terminalReport } from "./reporters.js";
import { runSuite } from "./runner.js";
import type { RunResult } from "./types.js";

export interface WorkspaceOptions { root?: string; host?: string; port?: number }
interface WorkspaceRun { id: string; suite: string; mode: string; status: "running" | "passed" | "failed"; output: string; result?: unknown; error?: string }
const TEXT_EXTENSIONS = new Set([".mcpr", ".yaml", ".yml", ".json", ".csv"]);

export async function startWorkspace(options: WorkspaceOptions = {}): Promise<{ url: string; close(): Promise<void> }> {
  const root = await realpath(resolve(options.root ?? process.cwd())); const host = options.host ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("MCP-WEB-001 QA workspace binds only to loopback addresses");
  const csrf = randomBytes(32).toString("base64url"); const runs = new Map<string, WorkspaceRun>();
  const assets = resolve(dirname(new URL(import.meta.url).pathname), "../workspace-assets");
  const server = createServer(async (req, res) => { securityHeaders(res); try { await route(req, res); } catch (error) { json(res, 500, { error: { code: "MCP-WEB-500", message: error instanceof Error ? error.message : String(error) } }); } });
  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`); const method = req.method ?? "GET";
    if (method !== "GET" && !authorized(req, csrf, `http://${req.headers.host}`)) return json(res, 403, { error: { code: "MCP-WEB-403", message: "Invalid workspace origin or CSRF token" } });
    if (url.pathname === "/" || url.pathname === "/app.js" || url.pathname === "/style.css") return asset(res, join(assets, url.pathname === "/" ? "index.html" : url.pathname.slice(1)));
    if (url.pathname === "/api/v1/bootstrap") return json(res, 200, { version: "1.0.0-rc.1", root: basename(root), csrf, capabilities: ["edit", "validate", "test", "parity", "evidence", "snapshots", "contracts"] });
    if (url.pathname === "/api/v1/suites" && method === "GET") return json(res, 200, { suites: await suites(root) });
    if (url.pathname === "/api/v1/file" && method === "GET") { const path = safePath(root, url.searchParams.get("path") ?? ""); const text = await limitedRead(path); return json(res, 200, { path: relative(root, path), text, etag: etag(text) }); }
    if (url.pathname === "/api/v1/file" && method === "PUT") { const body = await bodyJson(req) as any; const path = safePath(root, body.path); const current = await readFile(path, "utf8").catch(() => ""); if (body.etag && body.etag !== etag(current)) return json(res, 412, { error: { code: "MCP-WEB-412", message: "File changed since it was opened" } }); if (typeof body.text !== "string" || Buffer.byteLength(body.text) > 1024 * 1024) return json(res, 400, { error: { code: "MCP-WEB-400", message: "Text must be under 1 MiB" } }); await atomicWrite(path, body.text); return json(res, 200, { etag: etag(body.text) }); }
    if (url.pathname === "/api/v1/validate" && method === "POST") { const body = await bodyJson(req) as any; const path = safePath(root, body.path); try { const suite = await loadTestFile(path); return json(res, 200, { valid: true, suite: { name: suite.name, tests: suite.tests.length, parityTargets: Object.keys(suite.targets ?? {}) } }); } catch (error) { return json(res, 200, { valid: false, diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : String(error) }] }); } }
    if (url.pathname === "/api/v1/runs" && method === "POST") { const body = await bodyJson(req) as any; if (!body || !["test", "parity"].includes(body.mode) || typeof body.path !== "string" || Object.keys(body).some((key) => !["path", "mode"].includes(key))) return json(res, 400, { error: { code: "MCP-WEB-400", message: "Run accepts only saved path and test/parity mode" } }); const path = safePath(root, body.path); const id = randomBytes(12).toString("hex"); const run: WorkspaceRun = { id, suite: relative(root, path), mode: body.mode, status: "running", output: "Starting…" }; runs.set(id, run); void execute(run, path); return json(res, 202, { runId: id }); }
    const runMatch = url.pathname.match(/^\/api\/v1\/runs\/([a-f0-9]+)$/); if (runMatch && method === "GET") { const run = runs.get(runMatch[1]!); return run ? json(res, 200, run) : json(res, 404, { error: { code: "MCP-WEB-404", message: "Run not found" } }); }
    if (url.pathname === "/api/v1/evidence" && method === "GET") return json(res, 200, { entries: await directoryEntries(join(root, ".mcprigor")) });
    return json(res, 404, { error: { code: "MCP-WEB-404", message: "Not found" } });
  }
  async function execute(run: WorkspaceRun, path: string): Promise<void> { try { const suite = await loadTestFile(path); if (run.mode === "parity") { if (!suite.targets) throw new Error("This suite has no Compare target declarations"); const result = await runParity(suite, suite.targets, { cwd: root }); run.result = result; run.output = parityReport(result); run.status = result.status; } else { const result: RunResult = await runSuite(suite, { cwd: root }); run.result = result; run.output = terminalReport(result); run.status = result.status; } } catch (error) { run.status = "failed"; run.error = error instanceof Error ? error.message : String(error); run.output = run.error; } }
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(options.port ?? 0, host, () => resolveListen()); });
  const address = server.address(); const port = typeof address === "object" && address ? address.port : options.port; return { url: `http://${host}:${port}`, close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())) };
}

async function suites(root: string): Promise<Array<{ path: string; name: string }>> { const files: string[] = []; async function walk(dir: string): Promise<void> { for (const item of await readdir(dir, { withFileTypes: true })) { if (["node_modules", ".git", "dist"].includes(item.name)) continue; const full = join(dir, item.name); if (item.isDirectory()) await walk(full); else if ([".mcpr", ".yaml", ".yml", ".json"].includes(extname(item.name))) files.push(relative(root, full)); if (files.length >= 200) return; } } await walk(root); return files.sort().map((path) => ({ path, name: basename(path) })); }
function safePath(root: string, input: string): string { if (!input || input.includes("\0") || input.includes("\\") || input.startsWith("/") || /^[A-Za-z]:/.test(input)) throw new Error("MCP-WEB-002 Invalid workspace path"); const output = resolve(root, input); if (output !== root && !output.startsWith(root + sep)) throw new Error("MCP-WEB-003 Path leaves workspace"); if (!TEXT_EXTENSIONS.has(extname(output))) throw new Error("MCP-WEB-004 Unsupported file type"); return output; }
async function limitedRead(path: string): Promise<string> { const info = await stat(path); if (info.size > 1024 * 1024) throw new Error("MCP-WEB-005 File exceeds 1 MiB"); return readFile(path, "utf8"); }
async function atomicWrite(path: string, text: string): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`; await writeFile(temp, text, { mode: 0o600 }); await rename(temp, path); }
async function directoryEntries(path: string): Promise<string[]> { try { return (await readdir(path)).slice(0, 200); } catch { return []; } }
function etag(text: string): string { return `sha256:${createHash("sha256").update(text).digest("hex")}`; }
function authorized(req: IncomingMessage, token: string, origin: string): boolean { const supplied = String(req.headers["x-mcp-csrf"] ?? ""); return req.headers.origin === origin && supplied.length === token.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(token)); }
async function bodyJson(req: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error("Request body exceeds 1 MiB"); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
function securityHeaders(res: ServerResponse): void { res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("Cache-Control", "no-store"); }
async function asset(res: ServerResponse, path: string): Promise<void> { const content = await readFile(path); res.statusCode = 200; res.setHeader("Content-Type", extname(path) === ".js" ? "text/javascript; charset=utf-8" : extname(path) === ".css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8"); res.end(content); }
function json(res: ServerResponse, status: number, value: unknown): void { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(value)); }
