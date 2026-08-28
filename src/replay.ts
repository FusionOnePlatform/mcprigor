import { readFile } from "node:fs/promises";
import { createSession } from "./session.js";
import { semanticDiff, renderSemanticDiff } from "./snapshots.js";
import type { Target } from "./types.js";
import type { TraceEvent } from "./trace.js";

export interface ReplayOptions { allowTools?: string[]; timeoutMs?: number }
export interface ReplayResult { status: "passed" | "failed"; replayed: number; failures: Array<{ requestId: string; method: string; diff: string }> }
const SAFE_METHODS = new Set(["ping", "tools/list", "resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get", "completion/complete"]);

export async function replayTrace(file: string, target: Target, options: ReplayOptions = {}): Promise<ReplayResult> {
  const source = await readFile(file, "utf8"); if (Buffer.byteLength(source) > 20 * 1024 * 1024) throw new Error("MCP-REPLAY-001 Trace exceeds 20 MiB");
  const events = source.split(/\r?\n/).filter(Boolean).map((line, index) => { try { return JSON.parse(line) as TraceEvent; } catch { throw new Error(`MCP-REPLAY-002 Invalid JSON on trace line ${index + 1}`); } });
  const responses = new Map(events.filter((event) => event.type === "response" && event.requestId).map((event) => [event.requestId!, event.data]));
  const requests = events.filter((event) => event.type === "request" && event.requestId && event.method);
  const session = createSession(target); const failures: ReplayResult["failures"] = []; let replayed = 0;
  try {
    await session.connect();
    for (const event of requests) {
      const params = (event.data as any)?.params; const method = event.method!;
      if (method === "tools/call") { const tool = String((params as any)?.name); if (!options.allowTools?.includes(tool)) throw new Error(`MCP-REPLAY-003 Tool “${tool}” is side-effectful and requires --allow-tool ${tool}`); }
      else if (!SAFE_METHODS.has(method)) throw new Error(`MCP-REPLAY-004 Method “${method}” is not allowed for replay`);
      const actual = await session.request(method, params, options.timeoutMs ?? 10_000); replayed++;
      const expected = responses.get(event.requestId!); if (expected === undefined) continue;
      const changes = semanticDiff(expected, actual); if (changes.length) failures.push({ requestId: event.requestId!, method, diff: renderSemanticDiff(changes) });
    }
  } finally { await session.close(); }
  return { status: failures.length ? "failed" : "passed", replayed, failures };
}
export function replayReport(result: ReplayResult): string { return result.status === "passed" ? `Replay passed: ${result.replayed} requests matched.` : [`Replay failed: ${result.failures.length} of ${result.replayed} requests changed.`, ...result.failures.map((failure) => `\n${failure.requestId} ${failure.method}\n${failure.diff}`)].join("\n"); }
