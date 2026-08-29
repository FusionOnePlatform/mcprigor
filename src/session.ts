import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CreateMessageRequestSchema, ElicitRequestSchema, ListRootsRequestSchema, LoggingMessageNotificationSchema,
  ProgressNotificationSchema, PromptListChangedNotificationSchema, ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema, ResultSchema, TaskStatusNotificationSchema, ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ClientBehavior, NativeEvent, NativeRequestOptions, NativeRequestResult, Target, TestSession, SessionInfo } from "./types.js";
import { RigorError } from "./errors.js";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join as joinPath, resolve as resolvePath } from "node:path";
import { FRAMEWORK_VERSION } from "./version.js";

function assertCommandExists(command: string, cwd?: string): void {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()).concat("") : [""];
  const runnable = (candidate: string): boolean => extensions.some((extension) => { try { accessSync(candidate + extension, constants.F_OK); return true; } catch { return false; } });
  if (command.includes("/") || command.includes("\\")) { if (runnable(isAbsolute(command) ? command : resolvePath(cwd ?? process.cwd(), command))) return; }
  else if ((process.env.PATH ?? "").split(delimiter).filter(Boolean).some((dir) => runnable(joinPath(dir, command)))) return;
  throw new RigorError("server-spawn", "MCP-SPAWN-001", `Server command not found: ${command}. Check that it is installed and on PATH, or use an absolute path.`);
}

const activeSessions = new Set<TestSession>();
export function createSession(target: Target): TestSession { const session = new SdkSession(target, () => activeSessions.delete(session)); activeSessions.add(session); return session; }
export async function shutdownSessions(): Promise<void> { await Promise.allSettled([...activeSessions].map((session) => session.close())); activeSessions.clear(); }
export function installSignalCleanup(): () => void { const handler = () => { void shutdownSessions().finally(() => { process.exitCode = 130; }); }; process.once("SIGINT", handler); process.once("SIGTERM", handler); return () => { process.off("SIGINT", handler); process.off("SIGTERM", handler); }; }

class SdkSession implements TestSession {
  private readonly client = new Client({ name: "mcprigor", version: FRAMEWORK_VERSION }, { capabilities: { roots: { listChanged: true }, sampling: {}, elicitation: { form: {}, url: {} } } as any });
  private readonly messages: string[] = []; private diagnosticBytes = 0; private readonly nativeEvents: NativeEvent[] = []; private sequence = 0;
  private behavior: ClientBehavior = {}; private transport?: StdioClientTransport | StreamableHTTPClientTransport;
  private waiters: Array<{ method: string; resolve: (event: NativeEvent) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];
  constructor(private readonly target: Target, private readonly disposed: () => void) { this.installHandlers(); }

  configureClient(behavior: ClientBehavior): void { this.behavior = behavior; }
  async connect(): Promise<SessionInfo> {
    if (this.target.transport === "stdio") {
      assertCommandExists(this.target.command, this.target.cwd);
      const env = this.target.env ? { ...process.env, ...this.target.env } as Record<string, string> : undefined;
      this.transport = new StdioClientTransport({ command: this.target.command, args: this.target.args, cwd: this.target.cwd, env, stderr: "pipe" });
      this.transport.stderr?.on("data", (chunk) => { if (this.diagnosticBytes >= 64 * 1024) return; const text = String(chunk).slice(0, 16 * 1024).trimEnd(); this.diagnosticBytes += Buffer.byteLength(text); this.messages.push(text); });
    } else this.transport = new StreamableHTTPClientTransport(new URL(this.target.url), { requestInit: { headers: this.target.headers } });
    try { await this.client.connect(this.transport, { timeout: 10_000 }); }
    catch (error) { await this.client.close().catch(() => {}); this.disposed(); const message = error instanceof Error ? error.message : String(error); if (/ENOENT|spawn/i.test(message)) throw new RigorError("server-spawn", "MCP-SPAWN-001", message, undefined, error); throw new RigorError(/timeout/i.test(message) ? "timeout" : "initialization", /timeout/i.test(message) ? "MCP-TIMEOUT-001" : "MCP-INIT-001", message, undefined, error); }
    const server = this.client.getServerVersion();
    return { protocolVersion: this.transport instanceof StreamableHTTPClientTransport ? this.transport.protocolVersion : undefined, serverName: server?.name, serverVersion: server?.version, capabilities: this.client.getServerCapabilities() };
  }
  async request(method: string, params?: unknown, timeoutMs = 10_000): Promise<unknown> { return this.client.request({ method, params: params as Record<string, unknown> | undefined }, ResultSchema, { timeout: timeoutMs }); }
  async nativeRequest(method: string, params?: unknown, options: NativeRequestOptions = {}): Promise<NativeRequestResult> {
    const progress: unknown[] = []; const taskEvents: unknown[] = []; const controller = new AbortController();
    const timer = options.cancelAfterMs ? setTimeout(() => controller.abort(new Error("MCP request cancelled by test")), options.cancelAfterMs) : undefined;
    try {
      if (options.task && method === "tools/call") {
        for await (const event of this.client.experimental.tasks.callToolStream(params as any, undefined, { timeout: options.timeoutMs, signal: controller.signal })) {
          taskEvents.push(event); if ((event as any).type === "result") return { result: (event as any).result, progress, taskEvents };
          if ((event as any).type === "error") throw (event as any).error;
        }
        throw new Error("MCP-TASK-001 Task stream ended without a result");
      }
      const result = await this.client.request({ method, params: params as any }, ResultSchema, { timeout: options.timeoutMs, signal: controller.signal, onprogress: options.progress ? (event) => progress.push(event) : undefined });
      return { result, progress, taskEvents };
    } finally { if (timer) clearTimeout(timer); }
  }
  events(): NativeEvent[] { return structuredClone(this.nativeEvents); }
  awaitEvent(method: string, timeoutMs = 5_000): Promise<NativeEvent> {
    const existing = this.nativeEvents.find((event) => event.method === method); if (existing) return Promise.resolve(structuredClone(existing));
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.waiters = this.waiters.filter((item) => item.timer !== timer); reject(new Error(`MCP-EVENT-001 Timed out waiting for ${method}`)); }, timeoutMs); this.waiters.push({ method, resolve, reject, timer }); });
  }
  async subscribe(uri: string): Promise<unknown> { return this.client.subscribeResource({ uri }); }
  async unsubscribe(uri: string): Promise<unknown> { return this.client.unsubscribeResource({ uri }); }
  async setLoggingLevel(level: string): Promise<unknown> { return this.client.setLoggingLevel(level as any); }
  async close(): Promise<void> { for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(new RigorError("cancellation", "MCP-CANCEL-001", "Session closed while waiting for an event")); } this.waiters = []; try { await this.client.close(); } catch (error) { throw new RigorError("cleanup", "MCP-CLEANUP-002", error instanceof Error ? error.message : String(error), undefined, error); } finally { this.disposed(); } }
  diagnostics(): string[] { return [...this.messages]; }

  private installHandlers(): void {
    const notificationSchemas = [ProgressNotificationSchema, LoggingMessageNotificationSchema, ResourceUpdatedNotificationSchema, ResourceListChangedNotificationSchema, ToolListChangedNotificationSchema, PromptListChangedNotificationSchema, TaskStatusNotificationSchema] as const;
    for (const schema of notificationSchemas) this.client.setNotificationHandler(schema as any, (notification: any) => this.pushEvent(notification.method, notification.params));
    this.client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: this.behavior.roots ?? [] }));
    this.client.setRequestHandler(CreateMessageRequestSchema, async () => ({ model: this.behavior.sampling?.model ?? "mcprigor-fixture", role: "assistant", content: { type: "text", text: this.behavior.sampling?.text ?? "deterministic response" }, stopReason: "endTurn" } as any));
    this.client.setRequestHandler(ElicitRequestSchema, async () => ({ action: this.behavior.elicitation?.action ?? "decline", ...(this.behavior.elicitation?.content ? { content: this.behavior.elicitation.content } : {}) } as any));
  }
  private pushEvent(method: string, params: unknown): void { const event = { method, params, sequence: ++this.sequence }; this.nativeEvents.push(event); for (const waiter of this.waiters.filter((item) => item.method === method)) { clearTimeout(waiter.timer); waiter.resolve(structuredClone(event)); } this.waiters = this.waiters.filter((item) => item.method !== method); }
}
