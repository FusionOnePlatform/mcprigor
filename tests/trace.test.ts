import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRedactor } from "../src/redact.js";
import { runSuite } from "../src/runner.js";
import { compareEvidence, showEvidence, TraceRecorder, traceSession, writeEvidenceBundle } from "../src/trace.js";
import type { Suite, TestSession } from "../src/types.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
const target = { transport: "stdio" as const, command: "fixture" };
function session(): TestSession { return { connect: async () => ({ serverName: "fixture", capabilities: { tools: {} } }), request: async (_method, params) => ({ value: (params as any)?.value ?? 1, token: "top-secret" }), close: async () => {}, diagnostics: () => ["safe diagnostic"] }; }

describe("protocol evidence", () => {
  it("correlates and redacts request/response events", async () => {
    const recorder = new TraceRecorder(createRedactor(["top-secret"]));
    const traced = traceSession(session(), recorder, () => ({ testId: "one", step: "call" }));
    await traced.connect(); await traced.request("echo", { value: 2, authorization: "Bearer abc" }); await traced.close();
    expect(recorder.events.map((event) => event.type)).toEqual(["session.connect.start", "session.connect.success", "request", "response", "session.close", "diagnostic"]);
    const serialized = JSON.stringify(recorder.events);
    expect(serialized).not.toContain("top-secret"); expect(serialized).not.toContain("Bearer abc");
    expect(recorder.events[2]?.requestId).toBe(recorder.events[3]?.requestId);
  });

  it("writes showable and comparable evidence for failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-evidence-")); dirs.push(directory);
    const first = join(directory, "a"); const second = join(directory, "b");
    const suite: Suite = { version: 1, target, tests: [{ id: "failure", name: "failure", steps: [{ request: { method: "echo", params: { value: 1 } }, assert: { json: { path: "$.value", equals: 2 } } }] }] };
    const recorder = new TraceRecorder(); const result = await runSuite(suite, { sessionFactory: session, trace: recorder });
    expect(result.status).toBe("failed");
    await writeEvidenceBundle(first, result, target, recorder); await writeEvidenceBundle(second, result, target, recorder);
    expect(await showEvidence(first)).toContain("Status: failed");
    expect(await compareEvidence(first, second)).toContain("semantically identical");
    const normalized = await readFile(join(first, "trace.normalized.jsonl"), "utf8");
    expect(normalized).toContain('"requestId":"request-1"');
    expect(normalized).not.toContain("elapsedMs");
  });
});
