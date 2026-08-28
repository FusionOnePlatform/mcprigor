import { canonicalize, fingerprint } from "./canonical.js";
import { runSuite, type RunOptions } from "./runner.js";
import { renderSemanticDiff, semanticDiff } from "./snapshots.js";
import type { RunResult, Suite, Target, TestResult } from "./types.js";

export interface ParityTargets { [name: string]: Target }
export interface ParityTestRow { id: string; name: string; statuses: Record<string, TestResult["status"]>; equivalent: boolean; detail?: string }
export interface ParityResult {
  status: "passed" | "failed";
  targets: string[];
  runs: Record<string, RunResult>;
  rows: ParityTestRow[];
  fingerprints: Record<string, string>;
}

export async function runParity(suite: Suite, targets: ParityTargets, options: RunOptions = {}): Promise<ParityResult> {
  const names = Object.keys(targets);
  if (names.length < 2) throw new Error("MCP-PARITY-001 Parity needs at least two named targets");
  const runs: Record<string, RunResult> = {};
  for (const name of names) runs[name] = await runSuite({ ...suite, target: targets[name]! }, options);
  const baseline = names[0]!;
  const rows: ParityTestRow[] = [];
  const baselineTests = new Map(runs[baseline]!.tests.map((test) => [test.id ?? test.name, test]));
  const allIds = [...new Set(names.flatMap((name) => runs[name]!.tests.map((test) => test.id ?? test.name)))];
  for (const id of allIds) {
    const statuses: Record<string, TestResult["status"]> = {}; const details: string[] = [];
    const reference = baselineTests.get(id);
    for (const name of names) {
      const test = runs[name]!.tests.find((candidate) => (candidate.id ?? candidate.name) === id);
      statuses[name] = test?.status ?? "blocked";
      if (!test) { details.push(`${name}: test missing`); continue; }
      if (name === baseline || !reference) continue;
      if (test.status !== reference.status) { details.push(`${name}: status ${reference.status} → ${test.status}`); continue; }
      const changes = semanticDiff(normalizeTest(reference), normalizeTest(test));
      if (changes.length) details.push(`${name}:\n${renderSemanticDiff(changes.slice(0, 20))}`);
    }
    rows.push({ id, name: reference?.name ?? id, statuses, equivalent: details.length === 0, ...(details.length ? { detail: details.join("\n") } : {}) });
  }
  const fingerprints = Object.fromEntries(names.map((name) => [name, fingerprint(runs[name]!.tests.map(normalizeTest))]));
  return { status: rows.every((row) => row.equivalent) ? "passed" : "failed", targets: names, runs, rows, fingerprints };
}

function normalizeTest(test: TestResult): unknown {
  return canonicalize({
    id: test.id ?? test.name, status: test.status,
    steps: test.steps.map((step) => ({ name: step.name, method: step.method, status: step.status, response: stripVolatile(step.response), error: step.error ? step.error.replace(/\d+ms/g, "<ms>") : undefined })),
    outputs: stripVolatile(test.outputs),
  });
}
function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/durationMs|elapsedMs|timestamp|sessionId|_meta/i.test(key)).map(([key, item]) => [key, stripVolatile(item)]));
}

export function parityReport(result: ParityResult): string {
  const width = Math.max(4, ...result.rows.map((row) => row.id.length));
  const header = `${"Test".padEnd(width)}  ${result.targets.map((name) => name.padEnd(10)).join("")}  Parity`;
  const lines = [`MCP Rigor — transport parity (${result.targets.join(" vs ")})`, "", header, "-".repeat(header.length)];
  for (const row of result.rows) lines.push(`${row.id.padEnd(width)}  ${result.targets.map((name) => (row.statuses[name] ?? "-").padEnd(10)).join("")}  ${row.equivalent ? "✓ same" : "✗ differs"}`);
  lines.push("", `Result fingerprints:`);
  for (const name of result.targets) lines.push(`  ${name}: ${result.fingerprints[name]}`);
  for (const row of result.rows.filter((item) => !item.equivalent)) lines.push("", `✗ ${row.id}`, row.detail ?? "");
  lines.push("", result.status === "passed" ? "All targets behave equivalently." : "Targets are NOT equivalent.");
  return lines.join("\n");
}

export function parityMarkdown(result: ParityResult): string {
  const lines = [`# MCP Transport Parity`, "", `**${result.status === "passed" ? "Equivalent" : "Divergent"}** across ${result.targets.join(", ")}.`, "", `| Test | ${result.targets.join(" | ")} | Parity |`, `|---|${result.targets.map(() => "---").join("|")}|---|`];
  for (const row of result.rows) lines.push(`| \`${row.id}\` | ${result.targets.map((name) => row.statuses[name] ?? "-").join(" | ")} | ${row.equivalent ? "✓" : "✗"} |`);
  for (const row of result.rows.filter((item) => !item.equivalent)) lines.push("", `## ${row.id}`, "", "```text", row.detail ?? "", "```");
  return lines.join("\n") + "\n";
}
