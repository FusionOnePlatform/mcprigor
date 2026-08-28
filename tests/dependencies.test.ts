import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileAdvancedQaLanguage } from "../src/qa-advanced.js";
import { runSuite } from "../src/runner.js";
import { readState, writeState } from "../src/state.js";
import type { Suite, TestSession } from "../src/types.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
const target = { transport: "stdio" as const, command: "fixture" };
const fakeSession = (): TestSession => ({ connect: async () => ({ capabilities: { tools: {} } }), request: async (_method, params) => ({ value: (params as any)?.arguments?.value ?? 42 }), close: async () => {}, diagnostics: () => [] });

describe("cross-test outputs", () => {
  it("orders dependencies and passes immutable exported values", async () => {
    const suite: Suite = { version: 1, target, tests: [
      { id: "consumer", name: "consumer", dependsOn: ["producer"], steps: [{ tool: { name: "echo", arguments: { value: "${deps.producer.answer}" } }, assert: { json: { path: "$.value", equals: 42 } } }] },
      { id: "producer", name: "producer", steps: [{ tool: { name: "echo" }, export: { answer: { path: "$.value" } } }] },
    ] };
    const result = await runSuite(suite, { sessionFactory: fakeSession });
    expect(result.tests.map((test) => test.id)).toEqual(["producer", "consumer"]);
    expect(result.summary).toEqual({ passed: 2, failed: 0, skipped: 0, blocked: 0 });
    expect(result.outputs["producer.answer"]).toBe(42);
  });

  it("blocks consumers without opening a session when producer fails", async () => {
    let sessions = 0;
    const suite: Suite = { version: 1, target, tests: [
      { id: "bad", name: "bad", steps: [{ tool: { name: "echo" }, assert: { json: { path: "$.value", equals: 99 } } }] },
      { id: "blocked", name: "blocked", dependsOn: ["bad"], steps: [{ request: { method: "ping" } }] },
    ] };
    const result = await runSuite(suite, { sessionFactory: () => { sessions++; return fakeSession(); } });
    expect(result.tests[1]?.status).toBe("blocked");
    expect(sessions).toBe(1);
  });

  it("rejects unknown and circular dependencies before execution", async () => {
    const unknown: Suite = { version: 1, target, tests: [{ id: "a", name: "a", dependsOn: ["missing"], steps: [{ request: { method: "ping" } }] }] };
    await expect(runSuite(unknown, { sessionFactory: fakeSession })).rejects.toThrow(/unknown test/);
    const cycle: Suite = { version: 1, target, tests: [
      { id: "a", name: "a", dependsOn: ["b"], steps: [{ request: { method: "ping" } }] },
      { id: "b", name: "b", dependsOn: ["a"], steps: [{ request: { method: "ping" } }] },
    ] };
    await expect(runSuite(cycle, { sessionFactory: fakeSession })).rejects.toThrow(/Circular/);
  });

  it("compiles QA dependency and export syntax", async () => {
    const suite = await compileAdvancedQaLanguage(`Suite: "dependencies"\nServer: node x.js\nTest: "Create"\n  Id: create\n  Call tool "echo"\n  Export "value" as "id"\nTest: "Get"\n  Id: get\n  Depends on: create\n  Call tool "echo" with:\n    value: "${"${deps.create.id}"}"\n`, resolve("deps.mcpr"));
    expect(suite.tests[1]).toMatchObject({ id: "get", dependsOn: ["create"] });
    expect((suite.tests[0]?.steps[0] as any).export.id.path).toBe("$.value");
  });
});

describe("cross-run state", () => {
  it("writes atomically, verifies integrity, and loads values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-state-")); dirs.push(directory);
    const file = join(directory, "state.json");
    await writeState(file, target, { name: "suite" }, { startingValue: 10 });
    const state = await readState(file, target);
    expect(state.outputs.startingValue).toBe(10);
    expect((await readFile(file, "utf8"))).toContain("targetFingerprint");
  });

  it("rejects state from a different target unless explicitly allowed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-state-")); dirs.push(directory);
    const file = join(directory, "state.json");
    await writeState(file, target, {}, { id: 1 });
    const other = { transport: "stdio" as const, command: "other" };
    await expect(readState(file, other)).rejects.toThrow(/different MCP target/);
    await expect(readState(file, other, true)).resolves.toMatchObject({ outputs: { id: 1 } });
  });
});
