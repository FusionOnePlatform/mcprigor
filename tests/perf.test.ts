import { describe, expect, it } from "vitest";
import { checkBudgets, checkRegressions, percentile } from "../src/perf.js";
import type { RunResult, Suite } from "../src/types.js";
import type { HistoryEntry } from "../src/workspace.js";

const entry = (durations: number[], suite = "s.mcpr", test = "t"): HistoryEntry[] =>
  durations.map((durationMs, index) => ({ at: `2026-01-0${(index % 9) + 1}T00:00:00Z`, mode: "test", suite, status: "passed", durationMs, tests: [{ name: test, status: "passed", durationMs }] }));

const run = (durationMs: number, test = "t"): RunResult => ({
  schemaVersion: 1, suiteName: "s", status: "passed", startedAt: "", durationMs, protocolVersions: [], evidenceHash: "", outputs: {},
  summary: { passed: 1, failed: 0, skipped: 0, blocked: 0 }, tests: [{ name: test, status: "passed", durationMs, steps: [] }],
});

describe("performance budgets", () => {
  it("percentile uses nearest-rank", () => {
    expect(percentile([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 95)).toBe(1000);
    expect(percentile([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 50)).toBe(500);
    expect(percentile([], 95)).toBe(0);
  });

  it("budgets pass and fail on the measured percentile", () => {
    const suite = { budgets: [{ test: "t", percentile: 95, maxMs: 500 }] } as unknown as Suite;
    const ok = checkBudgets(suite, entry([100, 120, 110, 130, 140]), "s.mcpr", run(115));
    expect(ok[0]).toMatchObject({ withinBudget: true, insufficient: false });
    const bad = checkBudgets(suite, entry([600, 700, 650, 800, 620]), "s.mcpr", run(900));
    expect(bad[0]!.withinBudget).toBe(false);
    expect(bad[0]!.measuredMs).toBeGreaterThan(500);
  });

  it("wildcard budgets cover every test and small samples report insufficient", () => {
    const suite = { budgets: [{ test: "*", percentile: 95, maxMs: 500 }] } as unknown as Suite;
    const outcomes = checkBudgets(suite, [], "s.mcpr", run(100));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.insufficient).toBe(true);
  });

  it("regression gate trips on big slowdowns but has an absolute floor for micro-tests", () => {
    const slow = checkRegressions(entry([100, 100, 100, 100, 100]), "s.mcpr", run(400));
    expect(slow[0]!.regressed).toBe(true);
    const microJitter = checkRegressions(entry([3, 4, 3, 4, 3]), "s.mcpr", run(8));
    expect(microJitter[0]!.regressed).toBe(false);
    const fewSamples = checkRegressions(entry([100, 100]), "s.mcpr", run(900));
    expect(fewSamples).toHaveLength(0);
  });
});
