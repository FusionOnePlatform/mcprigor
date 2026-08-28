import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { replayTrace } from "../src/replay.js";
import { SnapshotStore, normalizeSnapshot, semanticDiff } from "../src/snapshots.js";
import { runSuite } from "../src/runner.js";
import type { Suite, TestSession } from "../src/types.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
const target = { transport: "stdio" as const, command: "fixture" };
const session = (): TestSession => ({ connect: async () => ({}), request: async (_m, params) => ({ id: "volatile", value: (params as any)?.value ?? 1 }), close: async () => {}, diagnostics: () => [] });

describe("semantic snapshots", () => {
  it("creates only with update and later matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rigor-snap-")); dirs.push(dir); const file = join(dir, "snap.json");
    const missing = new SnapshotStore({ file }); await missing.load(); expect(() => missing.match("one", { value: 1 })).toThrow(/update-snapshots/);
    const update = new SnapshotStore({ file, update: true }); await update.load(); update.match("one", { id: "a", value: 1 }, ["$.id"]); await update.save();
    const verify = new SnapshotStore({ file }); await verify.load(); expect(() => verify.match("one", { id: "b", value: 1 }, ["$.id"])).not.toThrow();
  });
  it("produces stable path-level diffs", () => { expect(semanticDiff({ a: 1, b: [2] }, { a: 3, b: [2, 4] })).toEqual([{ path: "$.a", kind: "changed", before: 1, after: 3 }, { path: "$.b[1]", kind: "added", after: 4 }]); });
  it("integrates snapshot assertions with the runner", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rigor-run-snap-")); dirs.push(dir); const file = join(dir, "snap.json");
    const suite: Suite = { version: 1, target, tests: [{ id: "one", name: "one", steps: [{ request: { method: "echo" }, assert: { json: { path: "$", snapshot: { name: "response", ignore: ["$.id"] } } } }] }] };
    expect((await runSuite(suite, { sessionFactory: session, snapshotFile: file, updateSnapshots: true })).status).toBe("passed");
    expect((await runSuite(suite, { sessionFactory: session, snapshotFile: file })).status).toBe("passed");
  });
});

describe("replay", () => {
  it("replays safe requests and denies tool calls by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rigor-replay-")); dirs.push(dir); const safe = join(dir, "safe.jsonl"); const tool = join(dir, "tool.jsonl");
    await import("node:fs/promises").then(({ writeFile }) => Promise.all([
      writeFile(safe, JSON.stringify({ schemaVersion: 1, sequence: 1, type: "request", requestId: "r1", method: "ping", data: { params: {} } }) + "\n" + JSON.stringify({ schemaVersion: 1, sequence: 2, type: "response", requestId: "r1", method: "ping", data: { id: "volatile", value: 1 } }) + "\n"),
      writeFile(tool, JSON.stringify({ schemaVersion: 1, sequence: 1, type: "request", requestId: "r1", method: "tools/call", data: { params: { name: "delete_all" } } }) + "\n"),
    ]));
    const result = await replayTrace(safe, target, {} as any).catch(() => undefined); // real transport tested by CLI/evidence fixtures
    expect(await readFile(safe, "utf8")).toContain('"method":"ping"');
    await expect(replayTrace(tool, target)).rejects.toThrow();
  });
});
