import { describe, expect, it } from "vitest";
import { analyzeFlakiness, flakyReport, parseQuarantine } from "../src/flaky.js";
import type { HistoryEntry } from "../src/workspace.js";

function entry(suite: string, status: "passed" | "failed", tests: Array<[string, string]>): HistoryEntry {
  return { at: new Date().toISOString(), mode: "test", suite, status, durationMs: 5, tests: tests.map(([name, s]) => ({ name, status: s, durationMs: 1 })) };
}

describe("flakiness analysis", () => {
  it("detects pass/fail flips and ranks by flip rate", () => {
    const entries = [
      entry("a.mcpr", "passed", [["stable", "passed"], ["flippy", "passed"]]),
      entry("a.mcpr", "failed", [["stable", "passed"], ["flippy", "failed"]]),
      entry("a.mcpr", "passed", [["stable", "passed"], ["flippy", "passed"]]),
      entry("b.mcpr", "failed", [["always-broken", "failed"]]),
      entry("b.mcpr", "failed", [["always-broken", "failed"]]),
    ];
    const data = analyzeFlakiness(entries);
    expect(data.tests).toHaveLength(1);
    expect(data.tests[0]!.test).toBe("flippy");
    expect(data.tests[0]!.flips).toBe(2);
    expect(flakyReport(data)).toContain("a.mcpr :: flippy");
  });

  it("ignores non-test modes, skipped statuses, and single runs", () => {
    const entries = [
      { ...entry("a.mcpr", "passed", [["once", "passed"]]), mode: "validate" },
      entry("a.mcpr", "passed", [["skippy", "skipped"]]),
      entry("a.mcpr", "passed", [["once", "passed"]]),
    ];
    expect(analyzeFlakiness(entries).tests).toHaveLength(0);
  });

  it("parses quarantine files with comments", () => {
    const list = parseQuarantine("# flaky list\na.mcpr :: coin lands heads\n\nb.mcpr::other test\n");
    expect(list).toEqual([{ suite: "a.mcpr", test: "coin lands heads" }, { suite: "b.mcpr", test: "other test" }]);
  });
});
