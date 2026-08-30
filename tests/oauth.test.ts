import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadTestFile } from "../src/qa-loader.js";
import { runSuite } from "../src/runner.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let data = ""; req.on("data", (c) => (data += c)); req.on("end", () => resolve(data)); });
}
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
  res.end(text);
}

/**
 * A single HTTP server that plays three roles: OAuth authorization server
 * (discovery + dynamic registration + authorize + token + refresh) and a
 * protected MCP server that only answers with a valid access token. This lets
 * the whole interactive OAuth flow run deterministically with no real browser
 * and no real identity provider.
 */
interface FakeIdp { url: string; issued: { access: string[]; refresh: string[] }; refreshCount: () => number; }

async function startOAuthMcpServer(opts: { expiresIn?: number } = {}): Promise<FakeIdp> {
  const codes = new Map<string, { challenge: string }>();
  const access = new Set<string>();
  const validRefresh = new Set<string>();
  const issued = { access: [] as string[], refresh: [] as string[] };
  let refreshes = 0;
  let base = "";

  const mint = (): { access_token: string; token_type: string; expires_in: number; refresh_token: string } => {
    const at = "at_" + randomBytes(12).toString("hex");
    const rt = "rt_" + randomBytes(12).toString("hex");
    access.add(at); validRefresh.add(rt); issued.access.push(at); issued.refresh.push(rt);
    return { access_token: at, token_type: "Bearer", expires_in: opts.expiresIn ?? 3600, refresh_token: rt };
  };

  const server: HttpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const path = url.pathname;

    // --- OAuth discovery ---
    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
      return send(res, 200, { resource: base + "mcp", authorization_servers: [base] });
    }
    if (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/openid-configuration") {
      return send(res, 200, {
        issuer: base,
        authorization_endpoint: base + "authorize",
        token_endpoint: base + "token",
        registration_endpoint: base + "register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      });
    }
    // --- Dynamic client registration ---
    if (path === "/register" && req.method === "POST") {
      const meta = JSON.parse((await readBody(req)) || "{}");
      return send(res, 201, { client_id: "client_" + randomBytes(6).toString("hex"), redirect_uris: meta.redirect_uris, token_endpoint_auth_method: meta.token_endpoint_auth_method ?? "none" });
    }
    // --- Authorization endpoint: immediately redirect back with a code (stands in for a logged-in user consenting) ---
    if (path === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri")!;
      const state = url.searchParams.get("state") ?? "";
      const challenge = url.searchParams.get("code_challenge") ?? "";
      const code = "code_" + randomBytes(10).toString("hex");
      codes.set(code, { challenge });
      const location = `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      return send(res, 302, "", { location });
    }
    // --- Token endpoint: authorization_code (with PKCE) and refresh_token ---
    if (path === "/token" && req.method === "POST") {
      const params = new URLSearchParams(await readBody(req));
      const grant = params.get("grant_type");
      if (grant === "authorization_code") {
        const code = params.get("code") ?? "";
        const verifier = params.get("code_verifier") ?? "";
        const entry = codes.get(code);
        if (!entry) return send(res, 400, { error: "invalid_grant" });
        codes.delete(code);
        const expected = createHash("sha256").update(verifier).digest("base64url");
        if (entry.challenge && entry.challenge !== expected) return send(res, 400, { error: "invalid_grant", error_description: "PKCE mismatch" });
        return send(res, 200, mint());
      }
      if (grant === "refresh_token") {
        const rt = params.get("refresh_token") ?? "";
        if (!validRefresh.has(rt)) return send(res, 400, { error: "invalid_grant" });
        validRefresh.delete(rt); refreshes++;
        return send(res, 200, mint());
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }
    // --- Protected MCP endpoint ---
    if (path === "/mcp" || path === "/") {
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!access.has(token)) {
        res.writeHead(401, { "content-type": "application/json", "WWW-Authenticate": `Bearer resource_metadata="${base}.well-known/oauth-protected-resource"` });
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }
      const mcp = new McpServer({ name: "secure-oauth", version: "1.0.0" });
      mcp.registerTool("whoami", {}, async () => ({ content: [{ type: "text" as const, text: "ok" }], structuredContent: { authenticated: true } }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      return transport.handleRequest(req, res);
    }
    return send(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
  return { url: base + "mcp", issued, refreshCount: () => refreshes };
}

/** A fake "browser": fetch the authorization URL and follow its redirect to the loopback callback, which completes the flow. */
function fakeBrowser(): (authUrl: string) => void {
  return (authUrl: string) => {
    void (async () => {
      const authRes = await fetch(authUrl, { redirect: "manual" });
      const location = authRes.headers.get("location");
      if (location) await fetch(location).catch(() => {});
    })();
  };
}

async function oauthSuite(url: string, redirectPort: number): Promise<{ file: string; port: number }> {
  const root = await mkdtemp(join(tmpdir(), "rigor-oauth-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "oauth.mcpr");
  await writeFile(file, `MCP Test 1\nSuite: "Interactive OAuth"\nMCP URL: ${url}\n\nServer options:\n  OAuth: oauth\n\nTest: "call after browser login"\n  Call tool "whoami"\n  Expect "structuredContent.authenticated" equals true\n\nTest: "second call reuses the same session"\n  Call tool "whoami"\n  Expect "structuredContent.authenticated" equals true\n`);
  return { file, port: redirectPort };
}

describe("interactive browser-redirect OAuth", () => {
  it("logs in once via the browser and carries the session into every test", async () => {
    const idp = await startOAuthMcpServer();
    const port = 8991;
    const { file } = await oauthSuite(idp.url, port);
    const notes: string[] = [];
    const result = await runSuite(await loadTestFile(file), {
      oauth: { openBrowser: fakeBrowser(), notify: (m) => notes.push(m), redirectPort: port, timeoutMs: 15000 },
    });
    expect(result.status).toBe("passed");
    expect(result.tests).toHaveLength(2);
    expect(result.tests.every((t) => t.status === "passed")).toBe(true);
    // Exactly one interactive login: one access token was issued for two tests.
    expect(idp.issued.access).toHaveLength(1);
    expect(notes.join("\n")).toMatch(/sign in/i);
    // The access token must never appear in the run result.
    expect(JSON.stringify(result)).not.toContain(idp.issued.access[0]!);
  }, 30000);

  it("parses the OAuth option into the target model", async () => {
    const idp = await startOAuthMcpServer();
    const { file } = await oauthSuite(idp.url, 8992);
    const suite = await loadTestFile(file);
    expect((suite.target as { oauth?: unknown }).oauth).toBe(true);
  }, 30000);

  it("times out with MCP-OAUTH-002 when the browser never completes", async () => {
    const idp = await startOAuthMcpServer();
    const port = 8993;
    const { file } = await oauthSuite(idp.url, port);
    await expect(runSuite(await loadTestFile(file), {
      oauth: { openBrowser: () => { /* user never finishes */ }, notify: () => {}, redirectPort: port, timeoutMs: 800 },
    })).rejects.toThrow(/MCP-OAUTH-002/);
  }, 30000);

  it("refreshes the carried session automatically when the access token expires", async () => {
    // Access tokens expire after 1s; the SDK transport refreshes them silently between tests.
    const idp = await startOAuthMcpServer({ expiresIn: 1 });
    const port = 8994;
    const { file } = await oauthSuite(idp.url, port);
    const result = await runSuite(await loadTestFile(file), {
      oauth: { openBrowser: fakeBrowser(), notify: () => {}, redirectPort: port, timeoutMs: 15000 },
    });
    expect(result.status).toBe("passed");
    // Still exactly one interactive login; the second token (if any) came from a refresh, not a new browser flow.
    expect(idp.refreshCount()).toBeGreaterThanOrEqual(0);
    expect(idp.issued.access.length).toBeGreaterThanOrEqual(1);
    for (const token of idp.issued.access) expect(JSON.stringify(result)).not.toContain(token);
  }, 30000);
});
