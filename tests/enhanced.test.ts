import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverTarget, generateSuite, writeLock } from "../src/discovery.js";
import { loadSuite, validateSuite } from "../src/loader.js";
import { createRedactor } from "../src/redact.js";
import { runSuite } from "../src/runner.js";

const target = { transport: "stdio" as const, command: "node", args: ["--import", "tsx", "tests/fixtures/server.ts"], cwd: resolve(".") };

describe("strict validation", () => {
  it("rejects unknown fields", () => {
    expect(() => validateSuite({ version: 1, target: { transport: "stdio", command: "x", typo: true }, tests: [{ name: "x", steps: [{ request: { method: "ping" } }] }] })).toThrow(/additional properties/);
  });

  it("rejects duplicate test names", () => {
    expect(() => validateSuite({ version: 1, target: { transport: "stdio", command: "x" }, tests: [1, 2].map(() => ({ name: "same", steps: [{ request: { method: "ping" } }] })) })).toThrow(/Duplicate test name/);
  });
});

describe("redaction", () => {
  it("redacts nested keys, bearer tokens, and known values", () => {
    const value = createRedactor(["secret-value"]).value({ password: "one", note: "secret-value", auth: "Bearer abc.123" });
    expect(JSON.stringify(value)).not.toMatch(/one|secret-value|abc\.123/);
  });
});

describe("real stdio MCP", () => {
  it("runs semantic tool steps and capability skips", async () => {
    const suite = await loadSuite(resolve("tests/fixtures/e2e.yaml"));
    suite.target = target;
    const result = await runSuite(suite);
    expect(result.status).toBe("passed");
    expect(result.summary).toEqual({ passed: 1, failed: 0, skipped: 1, blocked: 0 });
    expect(result.evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  }, 15_000);

  it("discovers, fingerprints, locks, and generates a contract suite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcprigor-"));
    try {
      const lock = await discoverTarget(target);
      expect((lock.tools[0] as { name: string }).name).toBe("add");
      expect(lock.fingerprint).toMatch(/^sha256:/);
      const file = join(directory, "mcp.lock.yaml");
      await writeLock(lock, file);
      expect(await readFile(file, "utf8")).toContain("fingerprint:");
      const suite = generateSuite(lock, target);
      const result = await runSuite(suite);
      expect(result.status).toBe("passed");
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 20_000);
});
