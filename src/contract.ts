import { readFile } from "node:fs/promises";
import YAML from "yaml";
import type { DiscoveryDocument, Target } from "./types.js";
import { discoverTarget, writeLock } from "./discovery.js";

export type DriftSeverity = "breaking" | "potentially-breaking" | "non-breaking";
export interface ContractChange { severity: DriftSeverity; code: string; path: string; message: string; before?: unknown; after?: unknown }
export interface ContractDiff { status: "unchanged" | "changed"; breaking: number; potentiallyBreaking: number; nonBreaking: number; changes: ContractChange[] }

export function compareContracts(before: DiscoveryDocument, after: DiscoveryDocument): ContractDiff {
  const changes: ContractChange[] = [];
  if (before.protocolVersion !== after.protocolVersion) changes.push(change("potentially-breaking", "MCP-DRIFT-001", "protocolVersion", `Protocol version changed from ${before.protocolVersion ?? "unknown"} to ${after.protocolVersion ?? "unknown"}`, before.protocolVersion, after.protocolVersion));
  diffCapabilities(before.server.capabilities, after.server.capabilities, changes);
  diffNamed("tool", before.tools, after.tools, "name", changes);
  diffNamed("resource", before.resources, after.resources, "uri", changes);
  diffNamed("resource template", before.resourceTemplates, after.resourceTemplates, "uriTemplate", changes);
  diffNamed("prompt", before.prompts, after.prompts, "name", changes);
  changes.sort((a, b) => rank(a.severity) - rank(b.severity) || a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  return { status: changes.length ? "changed" : "unchanged", breaking: changes.filter((x) => x.severity === "breaking").length, potentiallyBreaking: changes.filter((x) => x.severity === "potentially-breaking").length, nonBreaking: changes.filter((x) => x.severity === "non-breaking").length, changes };
}

export async function checkContract(lockFile: string, target: Target): Promise<{ lock: DiscoveryDocument; current: DiscoveryDocument; diff: ContractDiff }> {
  const lock = await readContract(lockFile); const current = await discoverTarget(target);
  return { lock, current, diff: compareContracts(lock, current) };
}
export async function updateContract(lockFile: string, target: Target): Promise<ContractDiff> {
  const previous = await readContract(lockFile); const current = await discoverTarget(target); const diff = compareContracts(previous, current); await writeLock(current, lockFile); return diff;
}
export async function readContract(file: string): Promise<DiscoveryDocument> {
  const source = await readFile(file, "utf8"); return (file.endsWith(".json") ? JSON.parse(source) : YAML.parse(source)) as DiscoveryDocument;
}

export function contractReport(diff: ContractDiff): string {
  if (!diff.changes.length) return "No MCP contract changes detected.";
  const lines = [`${diff.breaking} breaking, ${diff.potentiallyBreaking} potentially breaking, ${diff.nonBreaking} non-breaking changes`];
  for (const severity of ["breaking", "potentially-breaking", "non-breaking"] as const) {
    const group = diff.changes.filter((item) => item.severity === severity); if (!group.length) continue;
    lines.push("", severity === "breaking" ? "Breaking" : severity === "potentially-breaking" ? "Potentially breaking" : "Non-breaking");
    for (const item of group) lines.push(`${severity === "breaking" ? "✗" : severity === "potentially-breaking" ? "!" : "✓"} ${item.message} [${item.code}]`);
  }
  return lines.join("\n");
}
export function contractMarkdown(diff: ContractDiff): string {
  const icon = (severity: DriftSeverity) => severity === "breaking" ? "❌" : severity === "potentially-breaking" ? "⚠️" : "✅";
  return [`# MCP Contract Drift`, "", `**${diff.breaking} breaking · ${diff.potentiallyBreaking} potentially breaking · ${diff.nonBreaking} non-breaking**`, "", ...diff.changes.map((item) => `- ${icon(item.severity)} **${item.code}** — ${item.message} \`${item.path}\``), ""].join("\n");
}

function diffCapabilities(before: unknown, after: unknown, changes: ContractChange[]): void {
  const oldKeys = keys(before); const newKeys = keys(after);
  for (const key of oldKeys) if (!newKeys.has(key)) changes.push(change("breaking", "MCP-DRIFT-010", `capabilities.${key}`, `Capability “${key}” was removed`));
  for (const key of newKeys) if (!oldKeys.has(key)) changes.push(change("non-breaking", "MCP-DRIFT-011", `capabilities.${key}`, `Capability “${key}” was added`));
}
function diffNamed(kind: string, before: unknown[], after: unknown[], key: string, changes: ContractChange[]): void {
  const oldMap = index(before, key); const newMap = index(after, key);
  for (const [name] of oldMap) if (!newMap.has(name)) changes.push(change("breaking", "MCP-DRIFT-100", `${kind}.${name}`, `${capitalize(kind)} “${name}” was removed`));
  for (const [name] of newMap) if (!oldMap.has(name)) changes.push(change("non-breaking", "MCP-DRIFT-101", `${kind}.${name}`, `${capitalize(kind)} “${name}” was added`));
  for (const [name, oldItem] of oldMap) {
    const next = newMap.get(name); if (!next) continue;
    if (kind === "tool") diffSchema((oldItem as any).inputSchema, (next as any).inputSchema, `tools.${name}.inputSchema`, changes);
    if (kind === "tool") diffSchema((oldItem as any).outputSchema, (next as any).outputSchema, `tools.${name}.outputSchema`, changes, true);
    if (kind === "prompt") diffPromptArgs(name, oldItem, next, changes);
    if (JSON.stringify((oldItem as any).description) !== JSON.stringify((next as any).description)) changes.push(change("potentially-breaking", "MCP-DRIFT-120", `${kind}.${name}.description`, `${capitalize(kind)} “${name}” description changed`));
  }
}
function diffSchema(before: any, after: any, path: string, changes: ContractChange[], output = false): void {
  if (!before && after) { changes.push(change(output ? "potentially-breaking" : "non-breaking", "MCP-DRIFT-200", path, `${output ? "Output" : "Input"} schema was added`)); return; }
  if (before && !after) { changes.push(change("potentially-breaking", "MCP-DRIFT-201", path, `${output ? "Output" : "Input"} schema was removed`)); return; }
  if (!before || !after) return;
  if (before.type !== after.type) changes.push(change("breaking", "MCP-DRIFT-202", `${path}.type`, `Schema type changed from ${String(before.type)} to ${String(after.type)}`));
  const oldRequired = new Set<string>(before.required ?? []); const newRequired = new Set<string>(after.required ?? []);
  for (const name of newRequired) if (!oldRequired.has(name)) changes.push(change("breaking", "MCP-DRIFT-203", `${path}.required.${name}`, `Required input “${name}” was added`));
  for (const name of oldRequired) if (!newRequired.has(name)) changes.push(change("non-breaking", "MCP-DRIFT-204", `${path}.required.${name}`, `Input “${name}” is no longer required`));
  const oldProps = before.properties ?? {}; const newProps = after.properties ?? {};
  for (const name of Object.keys(oldProps)) if (!(name in newProps)) changes.push(change("breaking", "MCP-DRIFT-205", `${path}.properties.${name}`, `Schema property “${name}” was removed`));
  for (const name of Object.keys(newProps)) if (!(name in oldProps)) changes.push(change(newRequired.has(name) ? "breaking" : "non-breaking", "MCP-DRIFT-206", `${path}.properties.${name}`, `${newRequired.has(name) ? "Required" : "Optional"} schema property “${name}” was added`));
  for (const name of Object.keys(oldProps)) if (name in newProps) {
    if (oldProps[name]?.type !== newProps[name]?.type) changes.push(change("breaking", "MCP-DRIFT-207", `${path}.properties.${name}.type`, `Property “${name}” type changed from ${String(oldProps[name]?.type)} to ${String(newProps[name]?.type)}`));
    const oldEnum = oldProps[name]?.enum as unknown[] | undefined; const newEnum = newProps[name]?.enum as unknown[] | undefined;
    if (oldEnum && newEnum) { for (const value of oldEnum) if (!newEnum.some((x) => JSON.stringify(x) === JSON.stringify(value))) changes.push(change("breaking", "MCP-DRIFT-208", `${path}.properties.${name}.enum`, `Enum value ${JSON.stringify(value)} was removed from “${name}”`)); for (const value of newEnum) if (!oldEnum.some((x) => JSON.stringify(x) === JSON.stringify(value))) changes.push(change("non-breaking", "MCP-DRIFT-209", `${path}.properties.${name}.enum`, `Enum value ${JSON.stringify(value)} was added to “${name}”`)); }
  }
}
function diffPromptArgs(name: string, before: any, after: any, changes: ContractChange[]) { const oldMap = index(before.arguments ?? [], "name"); const newMap = index(after.arguments ?? [], "name"); for (const [arg, value] of oldMap) if (!newMap.has(arg)) changes.push(change((value as any).required ? "breaking" : "potentially-breaking", "MCP-DRIFT-300", `prompts.${name}.arguments.${arg}`, `Prompt argument “${arg}” was removed from “${name}”`)); for (const [arg, value] of newMap) if (!oldMap.has(arg)) changes.push(change((value as any).required ? "breaking" : "non-breaking", "MCP-DRIFT-301", `prompts.${name}.arguments.${arg}`, `${(value as any).required ? "Required" : "Optional"} prompt argument “${arg}” was added to “${name}”`)); }
function index(items: unknown[], key: string): Map<string, unknown> { return new Map(items.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && typeof (item as any)[key] === "string").map((item) => [String(item[key]), item])); }
function keys(value: unknown): Set<string> { return new Set(typeof value === "object" && value ? Object.keys(value) : []); }
function change(severity: DriftSeverity, code: string, path: string, message: string, before?: unknown, after?: unknown): ContractChange { return { severity, code, path, message, before, after }; }
function rank(value: DriftSeverity) { return value === "breaking" ? 0 : value === "potentially-breaking" ? 1 : 2; }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
