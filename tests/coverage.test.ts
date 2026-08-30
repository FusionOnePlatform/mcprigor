import { describe, expect, it } from "vitest";
import { coverageAgainst, coverageMarkdown, coverageReport } from "../src/coverage.js";
import type { DiscoveryDocument, Suite } from "../src/types.js";

const contract: DiscoveryDocument = {
  schemaVersion: 1, discoveredAt: "", target: { transport: "stdio" }, server: { name: "x" }, fingerprint: "x", diagnostics: [], protocolVersion: "x",
  tools: [
    { name: "search", inputSchema: { type: "object", properties: { query: { type: "string" }, mode: { type: "string", enum: ["fast", "deep"] } }, required: ["query"] } },
    { name: "delete", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
  ],
  resources: [{ uri: "catalog://status" }, { uri: "catalog://secret" }], resourceTemplates: [{ uriTemplate: "catalog://item/{id}" }], prompts: [{ name: "greet" }, { name: "review" }],
};
const suite: Suite = {
  version: 1, target: { transport: "stdio", command: "node" }, tests: [{ name: "covered", steps: [
    { tool: { name: "search", arguments: { query: "shoes", mode: "fast" } } },
    { request: { method: "resources/read", params: { uri: "catalog://status" } } },
    { request: { method: "prompts/get", params: { name: "greet" } } },
  ] }],
};

describe("MCP contract coverage", () => {
  it("reports untested surfaces and schema enum branches", () => {
    const result = coverageAgainst(suite, contract);
    expect(result.surfaces.tools).toEqual({ covered: 1, total: 2, percent: 50 });
    expect(result.surfaces.resources.percent).toBe(50);
    expect(result.surfaces.prompts.percent).toBe(50);
    expect(result.surfaces.resourceTemplates.percent).toBe(0);
    expect(result.items.find((x) => x.name.includes('enum="fast"'))?.covered).toBe(true);
    expect(result.items.find((x) => x.name.includes('enum="deep"'))?.covered).toBe(false);
    expect(result.items.find((x) => x.kind === "tool" && x.name === "delete")?.covered).toBe(false);
  });
  it("renders terminal and markdown reports", () => {
    const result = coverageAgainst(suite, contract);
    expect(coverageReport(result)).toContain("Uncovered:");
    expect(coverageMarkdown(result)).toContain("# MCP Rigor coverage");
  });
});
