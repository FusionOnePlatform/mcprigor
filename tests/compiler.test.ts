import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageDiagnostic, lexLanguage, validateLanguageDocument } from "../src/language.js";
import { loadTestFile } from "../src/qa-loader.js";
import { runSuite } from "../src/runner.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("formal language frontend", () => {
  it("creates located nodes and accepts the version header", () => {
    const document = lexLanguage(`MCP Test 1\nSuite: "x"\nServer: node x.js\nTest: "works"\n  Send "ping"\n`, "sample.mcpr");
    expect(document.nodes[3]).toMatchObject({ kind: "test", span: { start: { line: 4, column: 1 } } });
    expect(() => validateLanguageDocument(document)).not.toThrow();
  });

  it("reports caret diagnostics for tabs, indentation, and action ordering", () => {
    expect(() => lexLanguage("\tTest: \"x\"", "tabs.mcpr")).toThrow(/MCPLANG101[\s\S]*tabs\.mcpr:1:1[\s\S]*\^/);
    expect(() => lexLanguage(" Test: \"x\"", "indent.mcpr")).toThrow(/MCPLANG102/);
    const doc = lexLanguage(`Suite: "x"\nServer: node x\nTest: "bad"\n  Expect "value" equals 1\n`, "order.mcpr");
    expect(() => validateLanguageDocument(doc)).toThrow(/MCPLANG203[\s\S]*action before it/);
  });

  it("rejects duplicate tests before lowering", () => {
    const doc = lexLanguage(`Test: "same"\n  Send "ping"\nTest: "same"\n  Send "ping"`, "duplicate.mcpr");
    expect(() => validateLanguageDocument(doc)).toThrow(LanguageDiagnostic);
  });

  it("imports flow-only libraries and applies default inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-import-")); dirs.push(directory);
    const file = join(directory, "main.mcpr");
    await writeFile(file, `MCP Test 1\nSuite: "imports"\nServer: node --import tsx ${resolve("tests/fixtures/server.ts")}\nImport flows from "${resolve("tests/fixtures/shared-flows.mcpr")}"\nTest: "uses imported flow"\n  Use flow "Add with default" with:\n    a: 4\n    expected: 5\n`);
    const suite = await loadTestFile(file);
    const result = await runSuite(suite);
    expect(result.status).toBe("passed");
  }, 15_000);
});
