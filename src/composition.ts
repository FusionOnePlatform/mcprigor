import { readFile, writeFile } from "node:fs/promises";
import YAML from "yaml";
import { canonicalize, fingerprint } from "./canonical.js";
import { compareContracts, type ContractChange, type ContractDiff } from "./contract.js";
import { discoverTarget } from "./discovery.js";
import type { DiscoveryDocument, Target } from "./types.js";

export interface CompositionIssue {
  code: "MCP-COMP-001" | "MCP-COMP-002" | "MCP-COMP-003" | "MCP-COMP-004";
  severity: "breaking" | "potentially-breaking" | "notice";
  kind: "tool-collision" | "tool-schema-conflict" | "resource-collision" | "prompt-collision";
  name: string;
  servers: string[];
  message: string;
}

export interface CompositionLock {
  schemaVersion: 1;
  kind: "mcprigor-composition";
  discoveredAt: string;
  fingerprint: string;
  servers: Record<string, DiscoveryDocument>;
  issues: CompositionIssue[];
}

export interface CompositionDrift {
  status: "unchanged" | "changed";
  breaking: number;
  potentiallyBreaking: number;
  nonBreaking: number;
  servers: Record<string, ContractDiff>;
  changes: ContractChange[];
  compositionChanges: Array<{ severity: "breaking" | "potentially-breaking" | "non-breaking"; code: string; message: string }>;
}

/** Discover every named server and detect namespace/schema conflicts deterministically. */
export async function discoverComposition(servers: Record<string, Target>): Promise<CompositionLock> {
  const names = Object.keys(servers).sort();
  if (names.length < 2) throw new Error("MCP-COMP-000 A composition needs at least two named servers");
  const documents = await Promise.all(names.map(async (name) => [name, await discoverTarget(servers[name]!)] as const));
  const discovered = Object.fromEntries(documents);
  const issues = compositionIssues(discovered);
  const stableServers = Object.fromEntries(Object.entries(discovered).map(([name, document]) => [name, { server: document.server, protocolVersion: document.protocolVersion, tools: document.tools, resources: document.resources, resourceTemplates: document.resourceTemplates, prompts: document.prompts }]));
  const contract = canonicalize({ servers: stableServers, issues });
  return { schemaVersion: 1, kind: "mcprigor-composition", discoveredAt: new Date().toISOString(), fingerprint: fingerprint(contract), servers: discovered, issues };
}

export function compositionIssues(servers: Record<string, DiscoveryDocument>): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  const toolIndex = namedIndex(servers, "tools", "name");
  for (const [name, occurrences] of toolIndex) {
    if (occurrences.length < 2) continue;
    const serverNames = occurrences.map((item) => item.server).sort();
    issues.push({ code: "MCP-COMP-001", severity: "potentially-breaking", kind: "tool-collision", name, servers: serverNames, message: `Tool “${name}” is advertised by ${serverNames.join(", ")}` });
    const schemas = new Set(occurrences.map((item) => JSON.stringify(canonicalize({ inputSchema: item.value.inputSchema, outputSchema: item.value.outputSchema }))));
    if (schemas.size > 1) issues.push({ code: "MCP-COMP-002", severity: "breaking", kind: "tool-schema-conflict", name, servers: serverNames, message: `Tool “${name}” has conflicting schemas across ${serverNames.join(", ")}` });
  }
  for (const [name, occurrences] of namedIndex(servers, "resources", "uri")) if (occurrences.length > 1) {
    const serverNames = occurrences.map((item) => item.server).sort();
    issues.push({ code: "MCP-COMP-003", severity: "breaking", kind: "resource-collision", name, servers: serverNames, message: `Resource URI “${name}” is owned by multiple servers: ${serverNames.join(", ")}` });
  }
  for (const [name, occurrences] of namedIndex(servers, "resourceTemplates", "uriTemplate")) if (occurrences.length > 1) {
    const serverNames = occurrences.map((item) => item.server).sort();
    issues.push({ code: "MCP-COMP-003", severity: "breaking", kind: "resource-collision", name, servers: serverNames, message: `Resource template “${name}” is owned by multiple servers: ${serverNames.join(", ")}` });
  }
  for (const [name, occurrences] of namedIndex(servers, "prompts", "name")) if (occurrences.length > 1) {
    const serverNames = occurrences.map((item) => item.server).sort();
    issues.push({ code: "MCP-COMP-004", severity: "potentially-breaking", kind: "prompt-collision", name, servers: serverNames, message: `Prompt “${name}” is advertised by ${serverNames.join(", ")}` });
  }
  return issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

function namedIndex(servers: Record<string, DiscoveryDocument>, surface: "tools" | "resources" | "resourceTemplates" | "prompts", key: string): Map<string, Array<{ server: string; value: Record<string, unknown> }>> {
  const index = new Map<string, Array<{ server: string; value: Record<string, unknown> }>>();
  for (const [server, document] of Object.entries(servers)) for (const item of document[surface]) {
    if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>)[key] !== "string") continue;
    const name = String((item as Record<string, unknown>)[key]);
    const values = index.get(name) ?? []; values.push({ server, value: item as Record<string, unknown> }); index.set(name, values);
  }
  return index;
}

export async function writeCompositionLock(lock: CompositionLock, file: string): Promise<void> { await writeFile(file, YAML.stringify(lock, { sortMapEntries: true }), "utf8"); }
export async function readCompositionLock(file: string): Promise<CompositionLock> { const source = await readFile(file, "utf8"); return (file.endsWith(".json") ? JSON.parse(source) : YAML.parse(source)) as CompositionLock; }

/** Compare the entire fleet: added/removed servers, each contract, and collision-set changes. */
export function compareCompositions(before: CompositionLock, after: CompositionLock): CompositionDrift {
  const changes: ContractChange[] = [];
  const serverDiffs: Record<string, ContractDiff> = {};
  const oldNames = new Set(Object.keys(before.servers)); const newNames = new Set(Object.keys(after.servers));
  for (const name of [...oldNames].sort()) {
    if (!newNames.has(name)) changes.push({ severity: "breaking", code: "MCP-COMP-DRIFT-001", path: `servers.${name}`, message: `Server “${name}” was removed from the composition` });
    else {
      const diff = compareContracts(before.servers[name]!, after.servers[name]!); serverDiffs[name] = diff;
      for (const change of diff.changes) changes.push({ ...change, path: `servers.${name}.${change.path}`, message: `${name}: ${change.message}` });
    }
  }
  for (const name of [...newNames].sort()) if (!oldNames.has(name)) changes.push({ severity: "non-breaking", code: "MCP-COMP-DRIFT-002", path: `servers.${name}`, message: `Server “${name}” was added to the composition` });
  const issueKey = (issue: CompositionIssue) => `${issue.code}\0${issue.name}\0${issue.servers.join(",")}`;
  const oldIssues = new Map(before.issues.map((issue) => [issueKey(issue), issue])); const newIssues = new Map(after.issues.map((issue) => [issueKey(issue), issue]));
  const compositionChanges: CompositionDrift["compositionChanges"] = [];
  for (const [key, issue] of newIssues) if (!oldIssues.has(key)) compositionChanges.push({ severity: issue.severity === "notice" ? "non-breaking" : issue.severity, code: "MCP-COMP-DRIFT-010", message: `New composition conflict: ${issue.message}` });
  for (const [key, issue] of oldIssues) if (!newIssues.has(key)) compositionChanges.push({ severity: "non-breaking", code: "MCP-COMP-DRIFT-011", message: `Composition conflict resolved: ${issue.message}` });
  const all = [...changes, ...compositionChanges.map((item) => ({ ...item, path: "composition.issues" }))];
  return { status: all.length ? "changed" : "unchanged", breaking: all.filter((item) => item.severity === "breaking").length, potentiallyBreaking: all.filter((item) => item.severity === "potentially-breaking").length, nonBreaking: all.filter((item) => item.severity === "non-breaking").length, servers: serverDiffs, changes, compositionChanges };
}

export function compositionReport(lock: CompositionLock): string {
  const lines = [`MCP Rigor composition — ${Object.keys(lock.servers).length} servers`, `Combined fingerprint: ${lock.fingerprint}`, `${lock.issues.length} namespace/schema issue${lock.issues.length === 1 ? "" : "s"}`];
  for (const issue of lock.issues) lines.push(`${issue.severity === "breaking" ? "✗" : "!"} ${issue.message} [${issue.code}]`);
  if (!lock.issues.length) lines.push("✓ No tool, schema, resource URI, or prompt-name collisions detected.");
  return lines.join("\n");
}

export function compositionDriftReport(diff: CompositionDrift): string {
  if (diff.status === "unchanged") return "No MCP composition drift detected.";
  const lines = [`${diff.breaking} breaking, ${diff.potentiallyBreaking} potentially breaking, ${diff.nonBreaking} non-breaking composition changes`];
  for (const change of diff.changes) lines.push(`${change.severity === "breaking" ? "✗" : change.severity === "potentially-breaking" ? "!" : "✓"} ${change.message} [${change.code}]`);
  for (const change of diff.compositionChanges) lines.push(`${change.severity === "breaking" ? "✗" : change.severity === "potentially-breaking" ? "!" : "✓"} ${change.message} [${change.code}]`);
  return lines.join("\n");
}

function severityRank(value: CompositionIssue["severity"]): number { return value === "breaking" ? 0 : value === "potentially-breaking" ? 1 : 2; }
