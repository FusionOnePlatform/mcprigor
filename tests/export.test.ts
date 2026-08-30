import { describe, expect, it } from "vitest";
import { historyCsv, runCsv, runPdf, trendsCsv, trendsPdf } from "../src/export.js";
import { junitXml } from "../src/reporters.js";
import type { RunResult } from "../src/types.js";
import type { HistoryEntry } from "../src/workspace.js";

const result: RunResult = {
  schemaVersion: 1, suiteName: "Demo, suite \"quoted\"", status: "failed", startedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 1234, protocolVersions: ["2025-06-18"], evidenceHash: "abc123", outputs: {},
  summary: { passed: 1, failed: 1, skipped: 0, blocked: 0 },
  tests: [
    { name: "adds numbers", status: "passed", durationMs: 100, steps: [], retried: true },
    { name: "fails with detail", status: "failed", durationMs: 50, error: "expected 1, got 2 — (parens) and \\backslash", steps: [{ name: "Call tool add", method: "tools/call", status: "failed", durationMs: 50, error: "boom" }] },
  ],
};

const history: HistoryEntry[] = [
  { at: "2026-01-01T00:00:00Z", mode: "test", suite: "a.mcpr", status: "passed", durationMs: 10, tests: [{ name: "t1", status: "passed", durationMs: 5 }] },
  { at: "2026-01-02T00:00:00Z", mode: "test", suite: "a.mcpr", status: "failed", durationMs: 12, tests: [{ name: "t1", status: "failed", durationMs: 6, error: "nope" }] },
];

describe("report exports", () => {
  it("runCsv escapes quotes/commas and includes every test", () => {
    const csv = runCsv(result);
    expect(csv.split("\r\n")[0]).toBe("suite,test,status,durationMs,retried,error,startedAt");
    expect(csv).toContain('"Demo, suite ""quoted"""');
    expect(csv).toContain("adds numbers,passed,100,yes");
    expect(csv).toContain("fails with detail,failed,50");
  });

  it("trendsCsv aggregates pass rates and historyCsv keeps raw rows", () => {
    const trends = trendsCsv(history);
    expect(trends).toContain("a.mcpr,t1,2,1,1,0,0.500");
    const raw = historyCsv(history);
    expect(raw.trim().split("\r\n")).toHaveLength(3);
    expect(raw).toContain("nope");
  });

  it("runPdf and trendsPdf produce valid multi-object PDFs with escaped text", () => {
    for (const pdf of [runPdf(result), trendsPdf(history)]) {
      const text = pdf.toString("latin1");
      expect(text.startsWith("%PDF-1.4")).toBe(true);
      expect(text).toContain("/Filter /FlateDecode");
      expect(text.trim().endsWith("%%EOF")).toBe(true);
      expect(text).toContain("xref");
      expect(text).toContain("/Helvetica-Bold");
    }
  });

  it("junitXml returns the XML string used by --junit", () => {
    const xmlText = junitXml(result);
    expect(xmlText).toContain('<testsuite name="Demo, suite &quot;quoted&quot;" tests="2" failures="1"');
    expect(xmlText).toContain("<failure");
  });
});
