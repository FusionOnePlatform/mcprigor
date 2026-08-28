import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { fingerprint } from "./canonical.js";
import type { Target } from "./types.js";

export interface PersistedState {
  formatVersion: 1;
  createdAt: string;
  targetFingerprint: string;
  suiteFingerprint: string;
  outputs: Record<string, unknown>;
  integrity: string;
}

export function targetFingerprint(target: Target): string {
  if (target.transport === "stdio") return fingerprint({ transport: target.transport, command: target.command, args: target.args ?? [], cwd: target.cwd });
  return fingerprint({ transport: target.transport, url: target.url });
}

export async function readState(file: string, target: Target, allowTargetMismatch = false): Promise<PersistedState> {
  const value = JSON.parse(await readFile(file, "utf8")) as PersistedState;
  if (value.formatVersion !== 1 || typeof value.outputs !== "object" || !value.outputs) throw new Error("MCP-STATE-001 State file format is invalid");
  const expectedIntegrity = fingerprint({ ...value, integrity: undefined });
  if (value.integrity !== expectedIntegrity) throw new Error("MCP-STATE-002 State file integrity check failed");
  const current = targetFingerprint(target);
  if (!allowTargetMismatch && value.targetFingerprint !== current) throw new Error("MCP-STATE-003 State file belongs to a different MCP target. Use --allow-state-target-mismatch only after reviewing it.");
  return value;
}

export async function writeState(file: string, target: Target, suite: unknown, outputs: Record<string, unknown>): Promise<void> {
  const core = { formatVersion: 1 as const, createdAt: new Date().toISOString(), targetFingerprint: targetFingerprint(target), suiteFingerprint: fingerprint(suite), outputs };
  const value: PersistedState = { ...core, integrity: fingerprint({ ...core, integrity: undefined }) };
  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}
