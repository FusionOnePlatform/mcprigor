import { discoverTarget } from "./discovery.js";
import type { DiscoveryDocument, Suite, TestStep } from "./types.js";

export interface CoverageItem { kind: "tool" | "resource" | "resource-template" | "prompt" | "schema"; name: string; covered: boolean; detail?: string }
export interface CoverageResult { schemaVersion: 1; score: number; covered: number; total: number; surfaces: { tools: Fraction; resources: Fraction; resourceTemplates: Fraction; prompts: Fraction; schemaBranches: Fraction }; items: CoverageItem[] }
interface Fraction { covered: number; total: number; percent: number }

/** Static deterministic coverage: what the suite references vs the discovered MCP contract. */
export async function measureCoverage(suite: Suite): Promise<CoverageResult> { return coverageAgainst(suite, await discoverTarget(suite.target)); }
export function coverageAgainst(suite: Suite, contract: DiscoveryDocument): CoverageResult {
  const items: CoverageItem[] = [];
  const steps = suite.tests.flatMap((test) => test.steps);
  const tools = contract.tools as Array<{ name?: string; inputSchema?: Record<string, unknown> }>;
  for (const tool of tools.filter((x) => x.name)) {
    const calls = steps.filter((step): step is Extract<TestStep, { tool: unknown }> => "tool" in step && step.tool.name === tool.name);
    items.push({ kind: "tool", name: tool.name!, covered: calls.length > 0, detail: calls.length ? `${calls.length} call${calls.length === 1 ? "" : "s"}` : "never called" });
    const schemas = schemaBranches(tool.name!, tool.inputSchema);
    for (const branch of schemas) items.push({ kind: "schema", name: branch.name, covered: calls.some((call) => branch.matches(call.tool.arguments ?? {})), detail: `tool ${tool.name}` });
  }
  const requestSteps = steps.filter((step): step is Extract<TestStep, { request: unknown }> => "request" in step);
  for (const resource of (contract.resources as Array<{ uri?: string }>).filter((x) => x.uri)) {
    const covered = requestSteps.some((step) => step.request.method === "resources/read" && (step.request.params as Record<string, unknown> | undefined)?.uri === resource.uri);
    items.push({ kind: "resource", name: resource.uri!, covered, detail: covered ? "read by suite" : "never read" });
  }
  for (const template of (contract.resourceTemplates as Array<{ uriTemplate?: string }>).filter((x) => x.uriTemplate)) {
    const prefix = template.uriTemplate!.split("{")[0]!;
    const covered = requestSteps.some((step) => step.request.method === "resources/read" && typeof (step.request.params as Record<string, unknown> | undefined)?.uri === "string" && String((step.request.params as Record<string, unknown>).uri).startsWith(prefix));
    items.push({ kind: "resource-template", name: template.uriTemplate!, covered, detail: covered ? "matching URI read by suite" : "never matched by a resource read" });
  }
  for (const prompt of (contract.prompts as Array<{ name?: string }>).filter((x) => x.name)) {
    const covered = requestSteps.some((step) => step.request.method === "prompts/get" && (step.request.params as Record<string, unknown> | undefined)?.name === prompt.name);
    items.push({ kind: "prompt", name: prompt.name!, covered, detail: covered ? "requested by suite" : "never requested" });
  }
  const fraction = (kind: CoverageItem["kind"]): Fraction => { const list = items.filter((x) => x.kind === kind); const covered = list.filter((x) => x.covered).length; return { covered, total: list.length, percent: list.length ? Math.round(covered / list.length * 100) : 100 }; };
  const covered = items.filter((x) => x.covered).length; const total = items.length;
  return { schemaVersion: 1, score: total ? Math.round(covered / total * 100) : 100, covered, total, surfaces: { tools: fraction("tool"), resources: fraction("resource"), resourceTemplates: fraction("resource-template"), prompts: fraction("prompt"), schemaBranches: fraction("schema") }, items };
}

interface Branch { name: string; matches(value: unknown): boolean }
function schemaBranches(tool: string, schema: Record<string, unknown> | undefined): Branch[] {
  const out: Branch[] = [];
  const walk = (node: unknown, path: string, getter: (value: unknown) => unknown) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object") for (const [key, child] of Object.entries(record.properties as Record<string, unknown>)) {
      const get = (value: unknown) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
      out.push({ name: `${tool}:${path}.properties.${key}`, matches: (value) => get(getter(value)) !== undefined });
      walk(child, `${path}.properties.${key}`, (value) => get(getter(value)));
    }
    if (Array.isArray(record.enum)) for (const option of record.enum) out.push({ name: `${tool}:${path}.enum=${JSON.stringify(option)}`, matches: (value) => Object.is(getter(value), option) });
    for (const keyword of ["oneOf", "anyOf"] as const) if (Array.isArray(record[keyword])) record[keyword].forEach((branch, index) => out.push({ name: `${tool}:${path}.${keyword}[${index}]`, matches: (value) => shallowMatch(getter(value), branch) }));
  };
  walk(schema, "$", (value) => value);
  return out;
}
function shallowMatch(value: unknown, schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false; const s = schema as Record<string, unknown>;
  if ("const" in s) return Object.is(value, s.const); if (Array.isArray(s.enum)) return s.enum.some((x) => Object.is(x, value));
  if (s.required && Array.isArray(s.required)) return !!value && typeof value === "object" && s.required.every((key) => typeof key === "string" && key in (value as Record<string, unknown>));
  if (typeof s.type === "string") return s.type === "array" ? Array.isArray(value) : s.type === "object" ? !!value && typeof value === "object" && !Array.isArray(value) : typeof value === s.type;
  return false;
}
export function coverageReport(result: CoverageResult): string {
  const lines = [`MCP Rigor coverage: ${result.score}% (${result.covered}/${result.total})`, `Tools ${result.surfaces.tools.percent}% · Resources ${result.surfaces.resources.percent}% · Templates ${result.surfaces.resourceTemplates.percent}% · Prompts ${result.surfaces.prompts.percent}% · Schema branches ${result.surfaces.schemaBranches.percent}%`];
  const missing = result.items.filter((x) => !x.covered); if (!missing.length) lines.push("✓ Every discovered surface and schema branch is covered."); else { lines.push("", "Uncovered:"); for (const item of missing) lines.push(`○ ${item.kind}: ${item.name} — ${item.detail ?? "not exercised"}`); }
  return lines.join("\n");
}
export function coverageMarkdown(result: CoverageResult): string { return [`# MCP Rigor coverage — ${result.score}%`, "", `**${result.covered}/${result.total}** discovered coverage units exercised.`, "", "| Surface | Covered | Total | Percent |", "|---|---:|---:|---:|", ...Object.entries(result.surfaces).map(([name, x]) => `| ${name} | ${x.covered} | ${x.total} | ${x.percent}% |`), "", "## Uncovered", "", ...result.items.filter((x) => !x.covered).map((x) => `- **${x.kind}** \`${x.name}\` — ${x.detail ?? "not exercised"}`), ""].join("\n"); }
