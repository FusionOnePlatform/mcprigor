import { join, relative, resolve } from "node:path";
import { loadTestFile } from "./qa-loader.js";
import { runSuite } from "./runner.js";
import { appendHistory } from "./workspace.js";
import type { RunResult, Suite } from "./types.js";

export interface MonitorOptions {
  cwd?: string;
  everyMs: number;
  notify?: string;
  notifyOn?: "failure" | "recovery" | "change" | "always";
  maxRuns?: number;
  signal?: AbortSignal;
  onRun?: (event: MonitorEvent) => void;
}
export interface MonitorEvent { run: number; suite: string; result: RunResult; previousStatus?: RunResult["status"]; notification?: "failure" | "recovery" | "change" | "always" }

export function parseDuration(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
  if (!match) throw new Error("MCP-MONITOR-001 --every must be a duration such as 30s, 15m, or 1h");
  const amount = Number(match[1]); const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2]!.toLowerCase()]!;
  const result = amount * factor;
  if (!Number.isFinite(result) || result < 1000) throw new Error("MCP-MONITOR-001 --every must be at least 1s");
  return result;
}

/** Run immediately, then on a fixed interval until aborted or maxRuns. */
export async function monitorSuite(file: string, options: MonitorOptions): Promise<MonitorEvent[]> {
  const cwd = options.cwd ?? process.cwd(); const absolute = resolve(cwd, file); const suitePath = relative(cwd, absolute);
  const events: MonitorEvent[] = []; let previous: RunResult["status"] | undefined;
  for (let run = 1; !options.signal?.aborted && (!options.maxRuns || run <= options.maxRuns); run++) {
    const suite = await loadTestFile(absolute); requireRemoteTarget(suite);
    const result = await runSuite(suite, { cwd });
    await appendHistory(join(cwd, ".mcprigor", "workspace-history.jsonl"), { at: new Date().toISOString(), mode: "test", suite: suitePath, status: result.status, durationMs: result.durationMs, tests: result.tests.map((test) => ({ name: test.name, status: test.status, durationMs: test.durationMs, ...(test.error ? { error: test.error } : {}) })) });
    const kind = notificationKind(result.status, previous, options.notifyOn ?? "change");
    const event: MonitorEvent = { run, suite: suitePath, result, previousStatus: previous, ...(kind ? { notification: kind } : {}) };
    events.push(event); options.onRun?.(event);
    if (kind && options.notify) await notifyWebhook(options.notify, event, kind);
    previous = result.status;
    if (options.maxRuns && run >= options.maxRuns) break;
    await wait(options.everyMs, options.signal);
  }
  return events;
}

function requireRemoteTarget(suite: Suite): void {
  if (suite.target.transport !== "streamable-http") throw new Error("MCP-MONITOR-002 monitor requires an HTTP suite target; scheduled monitoring will not repeatedly spawn local commands");
}
function notificationKind(status: RunResult["status"], previous: RunResult["status"] | undefined, policy: NonNullable<MonitorOptions["notifyOn"]>): MonitorEvent["notification"] | undefined {
  if (policy === "always") return "always";
  if (policy === "failure") return status === "failed" ? "failure" : undefined;
  if (policy === "recovery") return previous === "failed" && status === "passed" ? "recovery" : undefined;
  if (previous === undefined) return status === "failed" ? "failure" : undefined;
  if (status !== previous) return status === "passed" ? "recovery" : "failure";
  return undefined;
}
async function notifyWebhook(url: string, event: MonitorEvent, kind: NonNullable<MonitorEvent["notification"]>): Promise<void> {
  const payload = { source: "mcprigor", event: `monitor.${kind}`, suite: event.suite, run: event.run, status: event.result.status, startedAt: event.result.startedAt, durationMs: event.result.durationMs, summary: event.result.summary, failures: event.result.tests.filter((test) => test.status === "failed").map((test) => ({ name: test.name, error: test.error })) };
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "mcprigor-monitor" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`MCP-MONITOR-003 Webhook returned HTTP ${response.status}`);
}
function wait(ms: number, signal?: AbortSignal): Promise<void> { return new Promise((resolveWait) => { if (signal?.aborted) return resolveWait(); const timer = setTimeout(resolveWait, ms); timer.unref?.(); signal?.addEventListener("abort", () => { clearTimeout(timer); resolveWait(); }, { once: true }); }); }

export function monitorLine(event: MonitorEvent): string {
  const summary = event.result.summary; const mark = event.result.status === "passed" ? "✓" : "✗";
  return `${new Date().toISOString()} ${mark} run ${event.run}: ${event.result.status} — ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${event.result.durationMs}ms)${event.notification ? ` — notified ${event.notification}` : ""}`;
}
