import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalize } from "./canonical.js";
import { readPath } from "./path.js";

export interface SnapshotFile { schemaVersion: 1; snapshots: Record<string, unknown> }
export interface SnapshotOptions { file: string; update?: boolean; ignore?: string[] }

export class SnapshotStore {
  private data: SnapshotFile = { schemaVersion: 1, snapshots: {} }; private dirty = false;
  constructor(private readonly options: SnapshotOptions) {}
  async load(): Promise<void> { try { const value = JSON.parse(await readFile(resolve(this.options.file), "utf8")) as SnapshotFile; if (value.schemaVersion !== 1 || !value.snapshots) throw new Error("invalid format"); this.data = value; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`MCP-SNAPSHOT-001 Cannot load snapshot: ${error instanceof Error ? error.message : String(error)}`); } }
  match(name: string, actual: unknown, ignore: string[] = []): void {
    const normalized = normalizeSnapshot(actual, [...(this.options.ignore ?? []), ...ignore]);
    if (!(name in this.data.snapshots)) { if (!this.options.update) throw new Error(`MCP-SNAPSHOT-002 Snapshot “${name}” does not exist. Re-run with --update-snapshots.`); this.data.snapshots[name] = normalized; this.dirty = true; return; }
    const expected = this.data.snapshots[name]; const changes = semanticDiff(expected, normalized);
    if (changes.length) { if (this.options.update) { this.data.snapshots[name] = normalized; this.dirty = true; return; } throw new Error(`MCP-SNAPSHOT-003 Snapshot “${name}” changed:\n${renderSemanticDiff(changes)}`); }
  }
  async save(): Promise<void> { if (!this.dirty) return; const file = resolve(this.options.file); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(canonicalize(this.data), null, 2) + "\n", "utf8"); }
}

export interface SemanticChange { path: string; kind: "added" | "removed" | "changed"; before?: unknown; after?: unknown }
export function semanticDiff(before: unknown, after: unknown, path = "$", changes: SemanticChange[] = []): SemanticChange[] {
  if (Object.is(before, after)) return changes;
  if (Array.isArray(before) && Array.isArray(after)) { const length = Math.max(before.length, after.length); for (let i = 0; i < length; i++) { if (i >= before.length) changes.push({ path: `${path}[${i}]`, kind: "added", after: after[i] }); else if (i >= after.length) changes.push({ path: `${path}[${i}]`, kind: "removed", before: before[i] }); else semanticDiff(before[i], after[i], `${path}[${i}]`, changes); } return changes; }
  if (record(before) && record(after)) { const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(); for (const key of keys) { if (!(key in before)) changes.push({ path: `${path}.${key}`, kind: "added", after: after[key] }); else if (!(key in after)) changes.push({ path: `${path}.${key}`, kind: "removed", before: before[key] }); else semanticDiff(before[key], after[key], `${path}.${key}`, changes); } return changes; }
  changes.push({ path, kind: "changed", before, after }); return changes;
}
export function renderSemanticDiff(changes: SemanticChange[]): string { return changes.map((item) => item.kind === "added" ? `+ ${item.path}: ${JSON.stringify(item.after)}` : item.kind === "removed" ? `- ${item.path}: ${JSON.stringify(item.before)}` : `- ${item.path}: ${JSON.stringify(item.before)}\n+ ${item.path}: ${JSON.stringify(item.after)}`).join("\n"); }
export function normalizeSnapshot(value: unknown, ignore: string[]): unknown { const clone = structuredClone(value); for (const path of ignore) removePath(clone, path); return canonicalize(clone); }
function removePath(value: unknown, path: string): void { if (!path.startsWith("$.") || !record(value)) return; const parts = path.slice(2).replace(/\[(\d+)\]/g, ".$1").split("."); let current: any = value; for (let i = 0; i < parts.length - 1; i++) { current = current?.[parts[i]!]; if (current == null) return; } if (Array.isArray(current)) current.splice(Number(parts.at(-1)), 1); else if (record(current)) delete current[parts.at(-1)!]; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
