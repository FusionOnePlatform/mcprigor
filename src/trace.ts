import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { canonicalize, fingerprint } from "./canonical.js";
import { createRedactor, type Redactor } from "./redact.js";
import type { RunResult, SessionInfo, Target, TestSession } from "./types.js";

export type TraceEventType = "session.connect.start" | "session.connect.success" | "request" | "response" | "error" | "session.close" | "diagnostic";
export interface TraceEvent { schemaVersion: 1; sequence: number; elapsedMs: number; type: TraceEventType; testId?: string; step?: string; requestId?: string; method?: string; data?: unknown }
export interface NormalizedTraceEvent { schemaVersion: 1; sequence: number; type: TraceEventType; testId?: string; step?: string; requestId?: string; method?: string; data?: unknown }
export interface EvidenceManifest { schemaVersion: 1; frameworkVersion: string; createdAt: string; suiteName: string; status: RunResult["status"]; resultHash: string; traceHash: string; normalizedTraceHash: string; files: Record<string, string>; target: { transport: Target["transport"] } }

export class TraceRecorder {
  private readonly started = Date.now(); private sequence = 0; private request = 0;
  readonly events: TraceEvent[] = [];
  constructor(private readonly redactor: Redactor = createRedactor()) {}
  record(type: TraceEventType, fields: Omit<TraceEvent, "schemaVersion" | "sequence" | "elapsedMs" | "type"> = {}): TraceEvent {
    const event: TraceEvent = this.redactor.value({ schemaVersion: 1, sequence: ++this.sequence, elapsedMs: Date.now() - this.started, type, ...fields }); this.events.push(event); return event;
  }
  nextRequestId(): string { return `request-${++this.request}`; }
  normalized(): NormalizedTraceEvent[] { return this.events.map(({ elapsedMs: _elapsed, ...event }) => canonicalize(normalizeVolatile(event)) as NormalizedTraceEvent); }
}

export function traceSession(session: TestSession, recorder: TraceRecorder, context: () => { testId?: string; step?: string }): TestSession {
  return {
    async connect(): Promise<SessionInfo> { recorder.record("session.connect.start", context()); try { const info = await session.connect(); recorder.record("session.connect.success", { ...context(), data: info }); return info; } catch (error) { recorder.record("error", { ...context(), data: safeError(error) }); throw error; } },
    async request(method, params, timeoutMs) { const requestId = recorder.nextRequestId(); recorder.record("request", { ...context(), requestId, method, data: { params, timeoutMs } }); try { const response = await session.request(method, params, timeoutMs); recorder.record("response", { ...context(), requestId, method, data: response }); return response; } catch (error) { recorder.record("error", { ...context(), requestId, method, data: safeError(error) }); throw error; } },
    async close() { try { await session.close(); } finally { recorder.record("session.close", context()); for (const message of session.diagnostics()) recorder.record("diagnostic", { ...context(), data: message }); } },
    nativeRequest: session.nativeRequest ? (method, params, options) => session.nativeRequest!(method, params, options) : undefined,
    events: session.events ? () => session.events!() : undefined,
    awaitEvent: session.awaitEvent ? (method, timeoutMs) => session.awaitEvent!(method, timeoutMs) : undefined,
    subscribe: session.subscribe ? (uri) => session.subscribe!(uri) : undefined,
    unsubscribe: session.unsubscribe ? (uri) => session.unsubscribe!(uri) : undefined,
    setLoggingLevel: session.setLoggingLevel ? (level) => session.setLoggingLevel!(level) : undefined,
    configureClient: session.configureClient ? (behavior) => session.configureClient!(behavior) : undefined,
    diagnostics: () => session.diagnostics(),
  };
}

export async function writeEvidenceBundle(directory: string, result: RunResult, target: Target, recorder: TraceRecorder): Promise<EvidenceManifest> {
  const root = resolve(directory); await mkdir(root, { recursive: true });
  const raw = recorder.events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const normalizedEvents = recorder.normalized(); const normalized = normalizedEvents.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const files = { result: "result.json", trace: "trace.jsonl", normalizedTrace: "trace.normalized.jsonl", manifest: "manifest.json" };
  const manifestCore = { schemaVersion: 1 as const, frameworkVersion: "1.0.0-rc.1", createdAt: new Date().toISOString(), suiteName: result.suiteName, status: result.status, resultHash: result.evidenceHash, traceHash: fingerprint(recorder.events), normalizedTraceHash: fingerprint(normalizedEvents), files, target: { transport: target.transport } };
  const manifest: EvidenceManifest = manifestCore;
  await Promise.all([writeFile(join(root, files.result), JSON.stringify(result, null, 2) + "\n"), writeFile(join(root, files.trace), raw), writeFile(join(root, files.normalizedTrace), normalized), writeFile(join(root, files.manifest), JSON.stringify(manifest, null, 2) + "\n")]);
  return manifest;
}

export async function showEvidence(directory: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(resolve(directory), "manifest.json"), "utf8")) as EvidenceManifest;
  const result = JSON.parse(await readFile(join(resolve(directory), manifest.files.result!), "utf8")) as RunResult;
  return [`Evidence: ${basename(resolve(directory))}`, `Suite: ${manifest.suiteName}`, `Status: ${manifest.status}`, `Tests: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.blocked} blocked`, `Result: ${manifest.resultHash}`, `Normalized trace: ${manifest.normalizedTraceHash}`].join("\n");
}
export async function compareEvidence(first: string, second: string): Promise<string> {
  const a = JSON.parse(await readFile(join(resolve(first), "manifest.json"), "utf8")) as EvidenceManifest; const b = JSON.parse(await readFile(join(resolve(second), "manifest.json"), "utf8")) as EvidenceManifest;
  if (a.normalizedTraceHash === b.normalizedTraceHash && a.resultHash === b.resultHash) return "Evidence bundles are semantically identical.";
  const lines = ["Evidence bundles differ:"]; if (a.resultHash !== b.resultHash) lines.push(`- Result hash: ${a.resultHash} → ${b.resultHash}`); if (a.normalizedTraceHash !== b.normalizedTraceHash) lines.push(`- Trace hash: ${a.normalizedTraceHash} → ${b.normalizedTraceHash}`); return lines.join("\n");
}
function normalizeVolatile(value: unknown): unknown { if (Array.isArray(value)) return value.map(normalizeVolatile); if (!value || typeof value !== "object") return typeof value === "string" ? value.replace(/\/var\/folders\/[^\s"']+/g, "<temp-path>").replace(/\/tmp\/[^\s"']+/g, "<temp-path>") : value; return Object.fromEntries(Object.entries(value).filter(([key]) => !/timestamp|createdAt|sessionId/i.test(key)).map(([key, item]) => [key, normalizeVolatile(item)])); }
function safeError(error: unknown): unknown { if (!(error instanceof Error)) return { message: String(error) }; const candidate = error as Error & { code?: unknown; data?: unknown }; return { name: error.name, message: error.message, code: candidate.code, data: candidate.data }; }
