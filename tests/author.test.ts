import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorTest, flattenResponse, renderAuthoredTest, ScriptedPromptAdapter } from "../src/author.js";
import { loadTestFile } from "../src/qa-loader.js";
import { runSuite } from "../src/runner.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
const target = { transport: "stdio" as const, command: "node", args: ["--import", "tsx", resolve("tests/fixtures/server.ts")] };

describe("guided no-code authoring", () => {
  it("flattens response leaves deterministically", () => {
    expect(flattenResponse({ z: 2, a: [{ name: "one" }] }).map((field) => field.path)).toEqual(["$.a[0].name", "$.z"]);
  });

  it("renders stable plain-language source", () => {
    const source = renderAuthoredTest({ suiteName: "Generated", testName: "Add works", target, operation: { kind: "tool", name: "add", input: { b: 3, a: 2 }, response: {} }, assertions: [{ path: "$.structuredContent.sum", kind: "equals", expected: 5 }] });
    expect(source).toContain("MCP Test 1");
    expect(source.indexOf("    a: 2")).toBeLessThan(source.indexOf("    b: 3"));
    expect(source).toContain('Expect "structuredContent.sum" equals 5');
  });

  it("discovers, previews, generates, and executes a tool test", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-author-")); dirs.push(directory);
    const output = join(directory, "add.mcpr");
    const prompts = new ScriptedPromptAdapter({
      "operation.kind": "tool", "tool.name": "add", "input.a": "20", "input.b": "22",
      "request.run": true, "assertions.fields": ["$.structuredContent.sum = 42"],
      "assertion.$.structuredContent.sum": "equals", "test.name": "Adding returns 42", "file.write": true,
    });
    await authorTest(target, prompts, output);
    const source = await readFile(output, "utf8");
    expect(source).toContain('Call tool "add"');
    expect(source).not.toContain("undefined");
    const suite = await loadTestFile(output);
    const result = await runSuite(suite);
    expect(result.status).toBe("passed");
  }, 20_000);
});
