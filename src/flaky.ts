import { readHistory, type HistoryEntry } from "./workspace.js";

export interface FlakyTest {
  suite: string;
  test: string;
  runs: number;
  passes: number;
  failures: number;
  flips: number;
  flipRate: number;
  lastStatus: string;
  lastSeen: string;
}

export interface FlakyReportData {
  totalRuns: number;
  window: number;
  tests: FlakyTest[];
}

/**
 * A test is flaky when its pass/fail outcome flips between consecutive runs
 * of the same suite. Deterministic input: the recorded run history.
 */
export function analyzeFlakiness(entries: HistoryEntry[], window = 200): FlakyReportData {
  const recent = entries.filter((entry) => entry.mode === "test").slice(-window);
  const byTest = new Map<string, { statuses: Array<{ status: string; at: string }> }>();
  for (const entry of recent) {
    for (const test of entry.tests) {
      if (test.status !== "passed" && test.status !== "failed") continue;
      const key = `${entry.suite}\u0000${test.name}`;
      const record = byTest.get(key) ?? { statuses: [] };
      record.statuses.push({ status: test.status, at: entry.at });
      byTest.set(key, record);
    }
  }
  const tests: FlakyTest[] = [];
  for (const [key, record] of byTest) {
    if (record.statuses.length < 2) continue;
    let flips = 0;
    for (let index = 1; index < record.statuses.length; index++) {
      if (record.statuses[index]!.status !== record.statuses[index - 1]!.status) flips++;
    }
    if (!flips) continue;
    const [suite, test] = key.split("\u0000") as [string, string];
    const passes = record.statuses.filter((item) => item.status === "passed").length;
    tests.push({
      suite, test,
      runs: record.statuses.length,
      passes,
      failures: record.statuses.length - passes,
      flips,
      flipRate: Math.round((flips / (record.statuses.length - 1)) * 100) / 100,
      lastStatus: record.statuses[record.statuses.length - 1]!.status,
      lastSeen: record.statuses[record.statuses.length - 1]!.at,
    });
  }
  tests.sort((a, b) => b.flipRate - a.flipRate || b.flips - a.flips);
  return { totalRuns: recent.length, window, tests };
}

export function flakyReport(data: FlakyReportData): string {
  if (!data.tests.length) return `No flaky tests detected across ${data.totalRuns} recorded runs.`;
  const lines = [`${data.tests.length} flaky test${data.tests.length === 1 ? "" : "s"} across ${data.totalRuns} recorded runs (window ${data.window})`, ""];
  for (const item of data.tests) {
    lines.push(`✗ ${item.suite} › ${item.test}`);
    lines.push(`    ${item.runs} runs: ${item.passes} passed, ${item.failures} failed, ${item.flips} flip${item.flips === 1 ? "" : "s"} (flip rate ${item.flipRate}) — last ${item.lastStatus} at ${item.lastSeen}`);
  }
  lines.push("", "Quarantine suggestions (add to .mcprigor/quarantine.txt to skip with --quarantine):");
  for (const item of data.tests) lines.push(`${item.suite} :: ${item.test}`);
  return lines.join("\n");
}

/** Quarantine file: one "suite.mcpr :: test name" per line; # comments allowed. */
export function parseQuarantine(text: string): Array<{ suite: string; test: string }> {
  return text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).flatMap((line) => {
    const [suite, test] = line.split("::").map((part) => part.trim());
    return suite && test ? [{ suite, test }] : [];
  });
}

export async function readQuarantine(historyDir: string): Promise<Array<{ suite: string; test: string }>> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try { return parseQuarantine(await readFile(join(historyDir, "quarantine.txt"), "utf8")); } catch { return []; }
}

export async function loadHistoryFor(root: string): Promise<HistoryEntry[]> {
  const { join } = await import("node:path");
  return readHistory(join(root, ".mcprigor", "workspace-history.jsonl"));
}
