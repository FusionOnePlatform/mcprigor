import type { PerfBudget, RunResult, Suite } from "./types.js";
import type { HistoryEntry } from "./workspace.js";

export interface BudgetOutcome {
  budget: PerfBudget;
  test: string;
  samples: number;
  measuredMs: number;
  withinBudget: boolean;
  /** Not enough recorded runs yet to make the call. */
  insufficient: boolean;
}

export interface RegressionOutcome {
  test: string;
  baselineP50: number;
  currentMs: number;
  ratio: number;
  regressed: boolean;
}

/** Nearest-rank percentile on a sorted copy; deterministic, no interpolation surprises. */
export function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(100, Math.max(0, pct)) / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}

/** Collect recent durations per test for one suite from history plus the current run. */
function durationsFor(entries: HistoryEntry[], suitePath: string | undefined, testName: string, window: number, current?: RunResult): number[] {
  const scoped = suitePath ? entries.filter((entry) => entry.suite === suitePath) : entries;
  const values: number[] = [];
  for (const entry of scoped) for (const test of entry.tests ?? []) {
    if (test.status !== "passed") continue;
    if (testName !== "*" && test.name !== testName) continue;
    if (typeof test.durationMs === "number") values.push(test.durationMs);
  }
  if (current) for (const test of current.tests) {
    if (test.status !== "passed") continue;
    if (testName !== "*" && test.name !== testName) continue;
    values.push(test.durationMs);
  }
  return values.slice(-window);
}

/** Evaluate every suite budget against history + the current run. */
export function checkBudgets(suite: Suite, entries: HistoryEntry[], suitePath: string | undefined, current: RunResult): BudgetOutcome[] {
  const outcomes: BudgetOutcome[] = [];
  for (const budget of suite.budgets ?? []) {
    const window = budget.window ?? 20;
    const names = budget.test === "*" ? [...new Set(current.tests.map((test) => test.name))] : [budget.test];
    for (const test of names) {
      const samples = durationsFor(entries, suitePath, test, window, current);
      const measuredMs = percentile(samples, budget.percentile);
      outcomes.push({ budget, test, samples: samples.length, measuredMs, withinBudget: measuredMs <= budget.maxMs, insufficient: samples.length < Math.min(3, window) });
    }
  }
  return outcomes;
}

/**
 * Latency regression gate: compare each passed test in the current run against
 * the median of its recent history. Regressed when slower than
 * max(baseline * ratio, baseline + minDeltaMs) — the floor keeps micro-tests
 * (3ms -> 6ms) from tripping the gate.
 */
export function checkRegressions(entries: HistoryEntry[], suitePath: string | undefined, current: RunResult, options?: { ratio?: number; minSamples?: number; minDeltaMs?: number; window?: number }): RegressionOutcome[] {
  const ratio = options?.ratio ?? 1.5;
  const minSamples = options?.minSamples ?? 5;
  const minDeltaMs = options?.minDeltaMs ?? 50;
  const window = options?.window ?? 50;
  const outcomes: RegressionOutcome[] = [];
  for (const test of current.tests) {
    if (test.status !== "passed") continue;
    const history = durationsFor(entries, suitePath, test.name, window);
    if (history.length < minSamples) continue;
    const baselineP50 = percentile(history, 50);
    const threshold = Math.max(baselineP50 * ratio, baselineP50 + minDeltaMs);
    outcomes.push({ test: test.name, baselineP50, currentMs: test.durationMs, ratio: baselineP50 ? test.durationMs / baselineP50 : 0, regressed: test.durationMs > threshold });
  }
  return outcomes;
}

export function budgetReport(outcomes: BudgetOutcome[]): string {
  const lines: string[] = ["", "Latency budgets:"];
  for (const outcome of outcomes) {
    const mark = outcome.insufficient ? "○" : outcome.withinBudget ? "✓" : "✗";
    const detail = outcome.insufficient
      ? `only ${outcome.samples} recorded sample${outcome.samples === 1 ? "" : "s"} — need more runs before this budget can be judged`
      : `p${outcome.budget.percentile} ${outcome.measuredMs} ms over ${outcome.samples} samples (budget ${outcome.budget.maxMs} ms)`;
    lines.push(`${mark} ${outcome.test}: ${detail}`);
  }
  return lines.join("\n");
}

export function regressionReport(outcomes: RegressionOutcome[]): string {
  const regressed = outcomes.filter((outcome) => outcome.regressed);
  if (!regressed.length) return `\nLatency regression gate: ✓ no regressions (${outcomes.length} test${outcomes.length === 1 ? "" : "s"} compared against baseline)`;
  const lines = ["", "Latency regression gate:"];
  for (const outcome of regressed) lines.push(`✗ ${outcome.test}: ${outcome.currentMs} ms vs baseline median ${outcome.baselineP50} ms (${outcome.ratio.toFixed(1)}x)`);
  return lines.join("\n");
}
