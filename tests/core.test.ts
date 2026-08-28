import { describe, expect, it } from "vitest";
import { assertResponse } from "../src/assertions.js";
import { readPath, replaceVariables } from "../src/path.js";
import { runSuite } from "../src/runner.js";
import type { Suite, TestSession } from "../src/types.js";

describe("JSON paths and variables", () => {
  it("reads nested arrays", () => {
    expect(readPath({ tools: [{ name: "add" }] }, "$.tools[0].name")).toBe("add");
  });

  it("preserves exact captured value types", () => {
    expect(replaceVariables({ value: "${count}" }, { count: 3 })).toEqual({ value: 3 });
  });
});

describe("assertions", () => {
  it("supports subset containment", () => {
    expect(() => assertResponse(
      { tools: [{ name: "add", description: "Adds numbers" }] },
      { json: { path: "$.tools", contains: { name: "add" } } },
    )).not.toThrow();
  });
});

describe("runner", () => {
  it("runs multi-step tests and captures values", async () => {
    const requests: unknown[] = [];
    const session: TestSession = {
      connect: async () => ({ protocolVersion: "2025-03-26" }),
      request: async (method, params) => {
        requests.push({ method, params });
        return method === "tools/list" ? { tools: [{ name: "add" }] } : { content: [{ text: "5" }] };
      },
      close: async () => {},
      diagnostics: () => [],
    };
    const suite: Suite = {
      version: 1,
      target: { transport: "stdio", command: "fixture" },
      tests: [{
        name: "calculator",
        steps: [
          { request: { method: "tools/list" }, capture: { toolName: "$.tools[0].name" } },
          { request: { method: "tools/call", params: { name: "${toolName}", arguments: { a: 2, b: 3 } } }, assert: { json: { path: "$.content[0].text", equals: "5" } } },
        ],
      }],
    };

    const result = await runSuite(suite, { sessionFactory: () => session });
    expect(result.status).toBe("passed");
    expect(result.protocolVersions).toEqual(["2025-03-26"]);
    expect(requests[1]).toEqual({ method: "tools/call", params: { name: "add", arguments: { a: 2, b: 3 } } });
  });
});
