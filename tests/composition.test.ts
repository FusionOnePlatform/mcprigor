import { describe, expect, it } from "vitest";
import { compareCompositions, compositionIssues, discoverComposition } from "../src/composition.js";
import { compileQaLanguage } from "../src/qa-language.js";
import { runSuite } from "../src/runner.js";
import type { CompositionLock } from "../src/composition.js";
import type { DiscoveryDocument, Target } from "../src/types.js";

const first: Target = { transport: "stdio", command: "node", args: ["--import", "tsx", "tests/fixtures/server.ts"] };
const second: Target = { transport: "stdio", command: "node", args: ["--import", "tsx", "tests/fixtures/server-conflict.ts"] };

function doc(name: string, tools: unknown[]): DiscoveryDocument {
  return { schemaVersion: 1, discoveredAt: "now", target: { transport: "stdio" }, server: { name }, protocolVersion: "x", tools, resources: [], resourceTemplates: [], prompts: [], fingerprint: name, diagnostics: [] };
}

describe("multi-server compositions", () => {
  it("detects tool collisions and conflicting schemas", () => {
    const issues = compositionIssues({
      a: doc("a", [{ name: "same", inputSchema: { type: "object", properties: { x: { type: "number" } } } }]),
      b: doc("b", [{ name: "same", inputSchema: { type: "object", properties: { x: { type: "string" } } } }]),
    });
    expect(issues.map((item) => item.code)).toEqual(["MCP-COMP-002", "MCP-COMP-001"]);
    expect(issues[0]).toMatchObject({ severity: "breaking", servers: ["a", "b"] });
  });

  it("discovers the fleet with a stable combined fingerprint", async () => {
    const one = await discoverComposition({ calculator: first, conflict: second });
    const two = await discoverComposition({ conflict: second, calculator: first });
    expect(one.fingerprint).toBe(two.fingerprint);
    expect(one.issues.some((item) => item.code === "MCP-COMP-002" && item.name === "add")).toBe(true);
  }, 60_000);

  it("routes each natural-language test to its named server", async () => {
    const suite = compileQaLanguage(`MCP Test 1
Suite: "Fleet"
Named server "calculator": node --import tsx tests/fixtures/server.ts
Named server "strings": node --import tsx tests/fixtures/server-conflict.ts

Test: "numbers"
  On server "calculator"
  Call tool "add" with:
    a: 20
    b: 22
  Expect "structuredContent.sum" equals 42

Test: "strings"
  On server "strings"
  Call tool "echo" with:
    text: "hello"
  Expect "structuredContent.text" equals "hello"
`);
    expect(suite.servers && Object.keys(suite.servers)).toEqual(["calculator", "strings"]);
    const result = await runSuite(suite, { cwd: process.cwd() });
    expect(result.summary).toMatchObject({ passed: 2, failed: 0 });
    expect(result.tests.map((test) => test.server)).toEqual(["calculator", "strings"]);
  }, 60_000);

  it("rejects unknown server selections during compilation", () => {
    expect(() => compileQaLanguage(`MCP Test 1
Named server "a": node a.js
Named server "b": node b.js
Test: "bad"
  On server "ghost"
  Send "ping"
`)).toThrow(/unknown server “ghost”/);
  });

  it("reports fleet drift including removed servers and new conflicts", () => {
    const before: CompositionLock = { schemaVersion: 1, kind: "mcprigor-composition", discoveredAt: "a", fingerprint: "a", issues: [], servers: { a: doc("a", []) , b: doc("b", []) } };
    const after: CompositionLock = { schemaVersion: 1, kind: "mcprigor-composition", discoveredAt: "b", fingerprint: "b", issues: [{ code: "MCP-COMP-001", severity: "potentially-breaking", kind: "tool-collision", name: "x", servers: ["a", "c"], message: "collision" }], servers: { a: doc("a", []), c: doc("c", []) } };
    const diff = compareCompositions(before, after);
    expect(diff.breaking).toBe(1);
    expect(diff.potentiallyBreaking).toBe(1);
    expect(diff.nonBreaking).toBe(1);
    expect(diff.changes.some((item) => item.message.includes("b") && item.message.includes("removed"))).toBe(true);
  });
});
