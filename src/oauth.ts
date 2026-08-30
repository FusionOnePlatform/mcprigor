import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { RigorError } from "./errors.js";
import type { OAuthConfig } from "./types.js";

/**
 * Interactive browser-redirect OAuth for MCP Rigor.
 *
 * The login runs once per target at suite start: the SDK transport drives OIDC
 * discovery + PKCE, MCP Rigor opens the system browser, a loopback HTTP server
 * captures the authorization code, and the resulting session (with the SDK's
 * automatic refresh) is carried into every test in the same process. Nothing is
 * written to disk — tokens live only in this in-memory provider for the run.
 */

type OAuthTokens = { access_token: string; token_type?: string; expires_in?: number; refresh_token?: string; scope?: string; id_token?: string };
type ClientInformation = { client_id: string; client_secret?: string; [k: string]: unknown };

/** In-memory OAuthClientProvider. Holds tokens, PKCE verifier, and (optionally DCR-registered) client info for one target, for one process. */
export class InMemoryOAuthProvider {
  private _tokens?: OAuthTokens;
  private _verifier?: string;
  private _client?: ClientInformation;
  private _authUrl?: URL;
  readonly redirectUrl: string;
  private readonly _redirectPort: number;

  constructor(private readonly config: OAuthConfig, redirectPort: number) {
    this._redirectPort = redirectPort;
    this.redirectUrl = `http://127.0.0.1:${redirectPort}/callback`;
    if (config.clientId) this._client = { client_id: config.clientId, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}) };
  }

  get clientMetadata() {
    return {
      client_name: "MCP Rigor",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
      ...(this.config.scope ? { scope: this.config.scope } : {}),
    };
  }
  state(): string { return randomBytes(16).toString("hex"); }
  clientInformation(): ClientInformation | undefined { return this._client; }
  saveClientInformation(info: ClientInformation): void { this._client = info; }
  tokens(): OAuthTokens | undefined { return this._tokens; }
  saveTokens(tokens: OAuthTokens): void { this._tokens = tokens; }
  redirectToAuthorization(url: URL): void { this._authUrl = url; }
  saveCodeVerifier(verifier: string): void { this._verifier = verifier; }
  codeVerifier(): string { if (!this._verifier) throw new RigorError("initialization", "MCP-OAUTH-003", "No PKCE code verifier was prepared before authorization."); return this._verifier; }

  /** The authorization URL captured during the failed first connect, if any. */
  pendingAuthorizationUrl(): URL | undefined { return this._authUrl; }
  /** Access token currently held (for redaction). */
  currentAccessToken(): string | undefined { return this._tokens?.access_token; }
  get scope(): string | undefined { return this.config.scope; }
  get redirectPort(): number { return this._redirectPort; }
}

/** Spawn the platform browser opener; never throws (headless users paste the URL that is always printed). */
function openBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try { const child = spawn(command, args, { stdio: "ignore", detached: true }); child.on("error", () => {}); child.unref(); } catch { /* headless: URL is printed */ }
}

export interface LoginOptions {
  /** Override the browser opener (tests inject a fake user agent). */
  openBrowser?: (url: string) => void;
  /** Where human-readable prompts are written. Defaults to stderr. */
  notify?: (message: string) => void;
  /** Milliseconds to wait for the user to complete the browser flow. */
  timeoutMs?: number;
}

interface Callback { code?: string; state?: string; error?: string; errorDescription?: string }

/** Start the loopback listener and resolve with the authorization callback query. */
function awaitCallback(port: number, timeoutMs: number): { done: Promise<Callback>; close: () => void } {
  let settle!: (value: Callback) => void; let fail!: (error: Error) => void;
  const done = new Promise<Callback>((resolve, reject) => { settle = resolve; fail = reject; });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname !== "/callback") { res.writeHead(404).end("Not found"); return; }
    const error = url.searchParams.get("error") ?? undefined;
    const page = error
      ? `<h1>Authentication failed</h1><p>${escapeHtml(url.searchParams.get("error_description") ?? error)}</p><p>You can close this tab and return to the terminal.</p>`
      : `<h1>Authentication complete</h1><p>MCP Rigor captured your session. You can close this tab and return to the terminal.</p>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><meta charset="utf-8"><title>MCP Rigor</title><style>body{font:16px system-ui;margin:15% auto;max-width:32rem;text-align:center;color:#0b1a12}h1{color:#0a7d33}</style>${page}`);
    settle({ code: url.searchParams.get("code") ?? undefined, state: url.searchParams.get("state") ?? undefined, error, errorDescription: url.searchParams.get("error_description") ?? undefined });
  });
  server.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
  server.listen(port, "127.0.0.1");
  const timer = setTimeout(() => fail(new RigorError("timeout", "MCP-OAUTH-002", `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser authorization to complete.`)), timeoutMs);
  return { done: done.finally(() => { clearTimeout(timer); server.close(); }), close: () => { clearTimeout(timer); server.close(); } };
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }

/**
 * Run the interactive browser-redirect OAuth flow for one target and return a
 * provider primed with the resulting in-memory session. The provider is then
 * reused by every test session, so refresh happens automatically and the login
 * prompt appears only once.
 */
export async function interactiveLogin(serverUrl: string, provider: InMemoryOAuthProvider, options: LoginOptions = {}): Promise<InMemoryOAuthProvider> {
  const notify = options.notify ?? ((message: string) => process.stderr.write(message + "\n"));
  const timeoutMs = options.timeoutMs ?? 300_000;
  const listener = awaitCallback(provider.redirectPort, timeoutMs);
  // First connect: the SDK sends `initialize`, receives 401, performs discovery + PKCE,
  // then throws Unauthorized after calling redirectToAuthorization().
  const probe = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider as never });
  const probeClient = new Client({ name: "mcprigor-login", version: "0" }, { capabilities: {} });
  try {
    await probeClient.connect(probe);
    // Already authorized (a token was somehow present) — nothing interactive to do.
    listener.close(); await probeClient.close().catch(() => {}); return provider;
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) { listener.close(); await probeClient.close().catch(() => {}); throw wrap(error); }
  }
  const authUrl = provider.pendingAuthorizationUrl();
  if (!authUrl) { listener.close(); throw new RigorError("initialization", "MCP-OAUTH-001", "The server did not provide an OAuth authorization URL. Confirm it advertises OAuth protected-resource metadata."); }
  notify(`\nMCP Rigor needs you to sign in to ${new URL(serverUrl).host}.`);
  notify(`Opening your browser. If it does not open, visit this URL:\n  ${authUrl.toString()}\n`);
  (options.openBrowser ?? openBrowser)(authUrl.toString());
  const callback = await listener.done;
  if (callback.error) throw new RigorError("initialization", "MCP-OAUTH-004", `Authorization was denied: ${callback.errorDescription ?? callback.error}`);
  if (!callback.code) throw new RigorError("initialization", "MCP-OAUTH-001", "The authorization redirect did not include a code.");
  try { await probe.finishAuth(callback.code); }
  catch (error) { await probeClient.close().catch(() => {}); throw wrap(error); }
  await probeClient.close().catch(() => {});
  if (!provider.currentAccessToken()) throw new RigorError("initialization", "MCP-OAUTH-001", "Token exchange completed without returning an access token.");
  notify("Sign-in complete. Running tests with the authorized session.\n");
  return provider;
}

function wrap(error: unknown): RigorError {
  const message = error instanceof Error ? error.message : String(error);
  return new RigorError("initialization", "MCP-OAUTH-005", `Interactive OAuth failed: ${message}`, undefined, error);
}
