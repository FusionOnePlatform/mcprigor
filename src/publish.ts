import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface PublishFiles { [path: string]: string }
export interface NetlifyOptions { site: string; token: string; apiBase?: string; timeoutMs?: number }
export interface PublishResult { url: string; deployId: string; files: string[] }

/** Deploy a small set of text files to Netlify using the dependency-free file-digest API. */
export async function publishToNetlify(files: PublishFiles, options: NetlifyOptions): Promise<PublishResult> {
  const api = (options.apiBase ?? "https://api.netlify.com/api/v1").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 120_000;
  const headers = { authorization: `Bearer ${options.token}`, "content-type": "application/json", "user-agent": "mcprigor-publish" };
  const digests: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) digests[normalize(path)] = sha1(content);
  const created = await call(`${api}/sites/${encodeURIComponent(options.site)}/deploys`, { method: "POST", headers, body: JSON.stringify({ files: digests }), signal: AbortSignal.timeout(timeoutMs) });
  const deploy = created as { id: string; required?: string[]; ssl_url?: string; deploy_ssl_url?: string; url?: string };
  const required = deploy.required ? new Set(deploy.required) : undefined;
  for (const [path, content] of Object.entries(files)) {
    if (required && !required.has(sha1(content))) continue;
    await call(`${api}/deploys/${deploy.id}/files${normalize(path)}`, { method: "PUT", headers: { authorization: headers.authorization, "content-type": "application/octet-stream", "user-agent": headers["user-agent"] }, body: content, signal: AbortSignal.timeout(timeoutMs) });
  }
  const started = Date.now();
  for (;;) {
    const state = await call(`${api}/deploys/${deploy.id}`, { headers, signal: AbortSignal.timeout(timeoutMs) }) as { state?: string; ssl_url?: string; deploy_ssl_url?: string; url?: string };
    if (state.state === "ready") return { url: state.deploy_ssl_url || state.ssl_url || state.url || deploy.deploy_ssl_url || deploy.ssl_url || deploy.url || "", deployId: deploy.id, files: Object.keys(digests) };
    if (state.state === "error") throw new Error("MCP-PUBLISH-002 Netlify reported a failed deploy");
    if (Date.now() - started > timeoutMs) throw new Error("MCP-PUBLISH-003 Timed out waiting for the deploy to become ready");
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
}

/** Write the bundle to a local directory when no hosting credentials are available. */
export async function writeLocalBundle(files: PublishFiles, directory: string): Promise<string[]> {
  const root = resolve(directory);
  const written: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, normalize(path).replace(/^\//, ""));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
    written.push(target);
  }
  return written;
}

async function call(url: string, init: Parameters<typeof fetch>[1]): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`MCP-PUBLISH-001 Hosting API returned HTTP ${response.status} for ${new URL(url).pathname}`);
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}
function sha1(content: string): string { return createHash("sha1").update(content, "utf8").digest("hex"); }
function normalize(path: string): string { return path.startsWith("/") ? path : `/${path}`; }
