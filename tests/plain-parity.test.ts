import { describe, expect, it } from "vitest";
import { compileQaLanguage } from "../src/qa-language.js";
import { runParity } from "../src/parity.js";
import type { Target, TestSession } from "../src/types.js";

const source = `MCP Test 1
Suite: "Calculator behaves the same everywhere"
Compare target "Local": node server.js
Compare target "QA environment": https://qa.example.com/mcp

Test: "Adding numbers gives the same answer"
  Id: add
  Call tool "add" with:
    a: 20
    b: 22
  Expect "structuredContent.sum" equals 42
`;

describe("plain-language parity", () => {
  it("compiles named stdio and HTTP targets", () => {
    const suite = compileQaLanguage(source);
    expect(suite.target.transport).toBe("stdio");
    expect(suite.targets).toEqual({
      Local: { transport: "stdio", command: "node", args: ["server.js"] },
      "QA environment": { transport: "streamable-http", url: "https://qa.example.com/mcp" },
    });
    expect(suite.tests[0]?.steps[0]).toMatchObject({ tool: { name: "add", arguments: { a: 20, b: 22 } } });
  });

  it("runs the compiled plain-language suite as a parity matrix", async () => {
    const suite = compileQaLanguage(source);
    const sessionFactory = (_target: Target): TestSession => ({ connect: async () => ({}), request: async () => ({ structuredContent: { sum: 42 } }), close: async () => {}, diagnostics: () => [] });
    const result = await runParity(suite, suite.targets!, { sessionFactory });
    expect(result.status).toBe("passed");
    expect(result.rows[0]?.statuses).toEqual({ Local: "passed", "QA environment": "passed" });
  });

  it("rejects a single parity target with a readable instruction", () => {
    expect(() => compileQaLanguage(`Suite: "Incomplete parity"\nCompare target "Only": node server.js\nTest: "ping"\n  Send "ping"`)).toThrow(/at least two.*Compare target/i);
  });
});
