import type { TraceEvent } from "./trace.js";

export interface TimelineEntry {
  sequence: number;
  kind: "call" | "connect" | "close" | "error" | "diagnostic";
  label: string;
  testId?: string;
  step?: string;
  method?: string;
  requestId?: string;
  startMs: number;
  durationMs?: number;
  status: "ok" | "error";
  request?: string;
  response?: string;
}

/** Pair request/response trace events into a HAR-style, ordered timeline. */
export function buildTimeline(events: TraceEvent[]): TimelineEntry[] {
  const pending = new Map<string, TraceEvent>();
  const entries: TimelineEntry[] = [];
  for (const event of events) {
    if (event.type === "request" && event.requestId) { pending.set(event.requestId, event); continue; }
    if (event.type === "response" && event.requestId && pending.has(event.requestId)) {
      const start = pending.get(event.requestId)!; pending.delete(event.requestId);
      entries.push({ sequence: start.sequence, kind: "call", label: start.method ?? "request", method: start.method, requestId: event.requestId, testId: start.testId, step: start.step, startMs: start.elapsedMs, durationMs: Math.max(0, event.elapsedMs - start.elapsedMs), status: "ok", request: pretty((start.data as { params?: unknown } | undefined)?.params), response: pretty(event.data) });
      continue;
    }
    if (event.type === "error") {
      const start = event.requestId ? pending.get(event.requestId) : undefined; if (event.requestId) pending.delete(event.requestId);
      entries.push({ sequence: (start ?? event).sequence, kind: "error", label: `${event.method ?? start?.method ?? "request"} failed`, method: event.method ?? start?.method, requestId: event.requestId, testId: event.testId, step: event.step, startMs: (start ?? event).elapsedMs, durationMs: start ? Math.max(0, event.elapsedMs - start.elapsedMs) : undefined, status: "error", request: pretty((start?.data as { params?: unknown } | undefined)?.params), response: pretty(event.data) });
      continue;
    }
    if (event.type === "session.connect.start") { entries.push({ sequence: event.sequence, kind: "connect", label: "Connect to server", testId: event.testId, step: event.step, startMs: event.elapsedMs, status: "ok" }); continue; }
    if (event.type === "session.connect.success") { const last = entries[entries.length - 1]; if (last?.kind === "connect") { last.durationMs = Math.max(0, event.elapsedMs - last.startMs); last.response = pretty(event.data); } continue; }
    if (event.type === "session.close") { entries.push({ sequence: event.sequence, kind: "close", label: "Close session", testId: event.testId, step: event.step, startMs: event.elapsedMs, status: "ok" }); continue; }
    if (event.type === "diagnostic") { entries.push({ sequence: event.sequence, kind: "diagnostic", label: "Server diagnostic", testId: event.testId, step: event.step, startMs: event.elapsedMs, status: "ok", response: pretty(event.data) }); continue; }
  }
  // Any request without a matching response (e.g. a timeout with no error event) is still shown.
  for (const start of pending.values()) entries.push({ sequence: start.sequence, kind: "error", label: `${start.method ?? "request"} (no response)`, method: start.method, requestId: start.requestId, testId: start.testId, step: start.step, startMs: start.elapsedMs, status: "error", request: pretty((start.data as { params?: unknown } | undefined)?.params) });
  return entries.sort((a, b) => a.sequence - b.sequence);
}

function pretty(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
