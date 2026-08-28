import { describe, expect, it } from "vitest";
import { compareContracts, contractMarkdown, contractReport } from "../src/contract.js";
import type { DiscoveryDocument } from "../src/types.js";

function lock(overrides: Partial<DiscoveryDocument> = {}): DiscoveryDocument {
  return { schemaVersion: 1, discoveredAt: "fixed", target: { transport: "stdio" }, server: { name: "fixture", version: "1", capabilities: { tools: {} } }, protocolVersion: "2025-03-26", tools: [], resources: [], resourceTemplates: [], prompts: [], fingerprint: "sha256:x", diagnostics: [], ...overrides };
}

describe("contract drift", () => {
  it("classifies additions and removals", () => {
    const before = lock({ tools: [{ name: "old", inputSchema: { type: "object" } }] });
    const after = lock({ tools: [{ name: "new", inputSchema: { type: "object" } }] });
    const diff = compareContracts(before, after);
    expect(diff.breaking).toBe(1);
    expect(diff.nonBreaking).toBe(1);
    expect(diff.changes.map((item) => item.message)).toEqual(["Tool “old” was removed", "Tool “new” was added"]);
  });

  it("classifies required properties, enums, and capability drift", () => {
    const before = lock({ tools: [{ name: "search", inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["a", "b"] } }, required: [] } }] });
    const after = lock({ server: { capabilities: {} }, tools: [{ name: "search", inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["a"] }, tenant: { type: "string" } }, required: ["tenant"] } }] });
    const diff = compareContracts(before, after);
    expect(diff.changes.some((item) => item.code === "MCP-DRIFT-203" && item.severity === "breaking")).toBe(true);
    expect(diff.changes.some((item) => item.code === "MCP-DRIFT-208")).toBe(true);
    expect(diff.changes.some((item) => item.code === "MCP-DRIFT-010")).toBe(true);
  });

  it("renders stable text and Markdown", () => {
    const diff = compareContracts(lock(), lock({ resources: [{ uri: "fixture://new" }] }));
    expect(contractReport(diff)).toContain("Resource “fixture://new” was added");
    expect(contractMarkdown(diff)).toContain("# MCP Contract Drift");
    expect(contractMarkdown(diff)).toContain("MCP-DRIFT-101");
  });

  it("ignores discovery timestamps and fingerprints", () => {
    expect(compareContracts(lock(), lock({ discoveredAt: "later", fingerprint: "sha256:y" })).status).toBe("unchanged");
  });
});
