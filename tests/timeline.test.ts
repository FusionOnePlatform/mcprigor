import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/timeline.js";
import { writeHtmlReport } from "../src/reporters.js";
import type { TraceEvent } from "../src/trace.js";
import type { RunResult } from "../src/types.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const events: TraceEvent[] = [
  { schemaVersion: 1, sequence: 1, elapsedMs: 0, type: "session.connect.start", testId: "t1" },
  { schemaVersion: 1, sequence: 2, elapsedMs: 12, type: "session.connect.success", testId: "t1", data: { serverInfo: { name: "demo" } } },
  { schemaVersion: 1, sequence: 3, elapsedMs: 20, type: "request", testId: "t1", step: "call add", requestId: "request-1", method: "tools/call", data: { params: { name: "add", arguments: { a: 1, b: 2 } } } },
  { schemaVersion: 1, sequence: 4, elapsedMs: 55, type: "response", testId: "t1", step: "call add", requestId: "request-1", method: "tools/call", data: { structuredContent: { sum: 3 } } },
  { schemaVersion: 1, sequence: 5, elapsedMs: 60, type: "request", testId: "t1", step: "bad", requestId: "request-2", method: "tools/call", data: { params: { name: "nope" } } },
  { schemaVersion: 1, sequence: 6, elapsedMs: 70, type: "error", testId: "t1", step: "bad", requestId: "request-2", method: "tools/call", data: { message: "Unknown tool" } },
  { schemaVersion: 1, sequence: 7, elapsedMs: 80, type: "session.close", testId: "t1" },
];

describe("HAR-style session timeline", () => {
  it("pairs requests with responses and marks errors with durations", () => {
    const timeline = buildTimeline(events);
    const call = timeline.find((e) => e.requestId === "request-1")!;
    expect(call.kind).toBe("call");
    expect(call.durationMs).toBe(35);
    expect(call.status).toBe("ok");
    expect(call.request).toContain("\"add\"");
    expect(call.response).toContain("\"sum\": 3");
    const failed = timeline.find((e) => e.requestId === "request-2")!;
    expect(failed.status).toBe("error");
    expect(failed.durationMs).toBe(10);
    expect(failed.response).toContain("Unknown tool");
    const connect = timeline.find((e) => e.kind === "connect")!;
    expect(connect.durationMs).toBe(12);
    expect(timeline.map((e) => e.sequence)).toEqual([...timeline.map((e) => e.sequence)].sort((a, b) => a - b));
  });

  it("keeps an unanswered request visible as an error entry", () => {
    const timeline = buildTimeline([
      { schemaVersion: 1, sequence: 1, elapsedMs: 0, type: "request", requestId: "request-9", method: "ping", data: { params: {} } },
    ]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.status).toBe("error");
    expect(timeline[0]!.label).toContain("no response");
  });

  it("embeds a clickable timeline into the HTML report", async () => {
    const root = await mkdtemp(join(tmpdir(), "rigor-tl-"));
    try {
      const result: RunResult = { suiteName: "Demo", status: "passed", durationMs: 90, evidenceHash: "abc0000000000000000000000", summary: { passed: 1, failed: 0, skipped: 0, blocked: 0 }, tests: [{ name: "t1", status: "passed", durationMs: 90, steps: [] }], outputs: {} } as unknown as RunResult;
      const file = join(root, "report.html");
      await writeHtmlReport(result, file, buildTimeline(events));
      const html = await readFile(file, "utf8");
      expect(html).toContain("Session timeline");
      expect(html).toContain("tl-row");
      expect(html).toContain("addEventListener");
      expect(html).toContain("tools/call");
      expect(html).not.toContain("<script>alert");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
