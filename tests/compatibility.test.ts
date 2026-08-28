import { describe, expect, it } from "vitest";
import { runSuite } from "../src/runner.js";
import type { Suite, TestSession } from "../src/types.js";

const protocol = process.env.MCP_RIGOR_PROTOCOL ?? "2025-06-18"; const transport = process.env.MCP_RIGOR_TRANSPORT ?? "stdio";
describe(`compatibility ${protocol} ${transport}`, () => {
  it("runs the known-good behavior under the selected protocol and transport model", async () => {
    const sessionFactory = (): TestSession => ({ connect: async () => ({ protocolVersion: protocol, serverName: "known-good", capabilities: { tools: {} } }), request: async () => ({ structuredContent: { sum: 42 } }), close: async () => {}, diagnostics: () => [] });
    const suite: Suite = { version: 1, target: transport === "stdio" ? { transport: "stdio", command: "fixture" } : { transport: "streamable-http", url: "https://fixture.invalid/mcp" }, tests: [{ name: "known good", requires: { protocolVersions: [protocol], capabilities: ["tools"] }, steps: [{ tool: { name: "add", arguments: { a: 20, b: 22 } }, assert: { json: { path: "$.structuredContent.sum", equals: 42 } } }] }] };
    expect((await runSuite(suite, { sessionFactory })).status).toBe("passed");
  });
  it("skips an unsupported protocol revision predictably", async () => { const sessionFactory = (): TestSession => ({ connect: async () => ({ protocolVersion: protocol }), request: async () => ({}), close: async () => {}, diagnostics: () => [] }); const suite: Suite = { version: 1, target: { transport: "stdio", command: "fixture" }, tests: [{ name: "revision gate", requires: { protocolVersions: ["not-this-revision"] }, steps: [{ request: { method: "ping" } }] }] }; expect((await runSuite(suite, { sessionFactory })).tests[0]?.status).toBe("skipped"); });
});
