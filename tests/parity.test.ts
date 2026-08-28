import { describe, expect, it } from "vitest";
import { parityMarkdown, parityReport, runParity } from "../src/parity.js";
import type { Suite, Target, TestSession } from "../src/types.js";

const targets = { stdio: { transport: "stdio", command: "fixture" } as Target, http: { transport: "streamable-http", url: "https://fixture.invalid" } as Target };
const suite: Suite = { version: 1, target: targets.stdio, tests: [{ id: "add", name: "add", steps: [{ request: { method: "tools/call", params: { name: "add", arguments: { a: 20, b: 22 } } } }] }] };
function factory(target: Target): TestSession { return { connect: async () => ({ serverName: "fixture", capabilities: {} }), request: async () => ({ structuredContent: { sum: target.transport === "stdio" ? 42 : 42 }, _meta: { sessionId: target.transport } }), close: async () => {}, diagnostics: () => [] }; }

describe("transport parity", () => {
  it("reports equivalent normalized behavior across transports", async () => {
    const result = await runParity(suite, targets, { sessionFactory: factory });
    expect(result.status).toBe("passed"); expect(result.rows[0]?.equivalent).toBe(true);
    expect(parityReport(result)).toContain("All targets behave equivalently"); expect(parityMarkdown(result)).toContain("| `add` |");
  });
  it("pinpoints semantic differences", async () => {
    const result = await runParity(suite, targets, { sessionFactory: (target) => ({ connect: async () => ({}), request: async () => ({ structuredContent: { sum: target.transport === "stdio" ? 42 : 43 } }), close: async () => {}, diagnostics: () => [] }) });
    expect(result.status).toBe("failed"); expect(result.rows[0]?.detail).toContain("sum");
  });
  it("requires two named targets", async () => { await expect(runParity(suite, { only: targets.stdio }, { sessionFactory: factory })).rejects.toThrow(/at least two/); });
});
