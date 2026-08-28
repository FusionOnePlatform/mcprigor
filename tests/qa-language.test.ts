import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileQaLanguage } from "../src/qa-language.js";
import { loadTestFile } from "../src/qa-loader.js";
import { writeHtmlReport } from "../src/reporters.js";
import { runSuite } from "../src/runner.js";

describe("QA-friendly language", () => {
  it("compiles human steps deterministically", () => {
    const suite = compileQaLanguage(`Suite: "Calculator"\nServer: node server.js\nTest: "adds"\n  Require: tools\n  Call tool "add" with:\n    a: 2\n    b: 3\n  Expect "structuredContent.sum" equals 5\n  Save "structuredContent.sum" as "answer"\n`);
    expect(suite.tests[0]?.steps[0]).toMatchObject({
      tool: { name: "add", arguments: { a: 2, b: 3 } },
      assert: { json: [{ path: "$.structuredContent.sum", equals: 5 }] },
      capture: { answer: "$.structuredContent.sum" },
    });
  });

  it("gives line-specific guidance for unknown wording", () => {
    expect(() => compileQaLanguage(`Server: node x.js\nTest: "x"\n  Click the tool\n`, "sample.mcpr")).toThrow(/sample\.mcpr:3.*don't understand/i);
  });

  it("loads and executes a real plain-language MCP test", async () => {
    const suite = await loadTestFile(resolve("examples/qa-friendly.mcpr"));
    const result = await runSuite(suite);
    expect(result.summary).toEqual({ passed: 3, failed: 0, skipped: 0, blocked: 0 });
  }, 20_000);

  it("creates a readable HTML report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-qa-"));
    try {
      const suite = await loadTestFile(resolve("examples/qa-friendly.mcpr"));
      const result = await runSuite(suite, { filter: "*Adding*" });
      const file = join(directory, "report.html");
      await writeHtmlReport(result, file);
      const html = await readFile(file, "utf8");
      expect(html).toContain("1</b> passed");
      expect(html).toContain("Secrets were redacted");
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 15_000);
});
