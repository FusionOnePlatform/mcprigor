import { describe, expect, it } from "vitest";
import { createRedactor } from "../src/redact.js";
import { classifyFailure, formatFailure, sanitizeTerminal } from "../src/errors.js";
import { loadData } from "../src/data.js";
import { createFunctionRegistry } from "../src/extensions.js";

describe("security hardening", () => {
  it("redacts URI credentials and encoded secret variants", () => { const redactor = createRedactor(["s3cr3t!"]); const text = redactor.text("https://user:pass@example.com/x?token=s3cr3t! raw=s3cr3t! encoded=s3cr3t%21 twice=s3cr3t%2521"); expect(text).not.toContain("pass"); expect(text).not.toContain("s3cr3t"); expect(text).toContain("REDACTED"); });
  it("strips terminal ANSI OSC and controls", () => { const hostile = "ok\u001b[31mRED\u001b[0m\u001b]52;c;Y2xpcA==\u0007\u0000done"; const clean = sanitizeTerminal(hostile); expect(clean).not.toContain("\u001b"); expect(clean).not.toContain("\u0000"); expect(clean).toContain("okREDdone"); });
  it("classifies stable QA-facing failures", () => { expect(classifyFailure(new Error("MCP-DATA-021 bad row")).category).toBe("data-loading"); expect(classifyFailure(new Error("MCP-CLEANUP-001 close failed")).category).toBe("cleanup"); expect(formatFailure(new Error("MCP-ASSERT-001 wrong"))).toContain("Action:"); });
  it("blocks private remote data before fetch", async () => { await expect(loadData({ provider: "rest", url: "http://127.0.0.1/data" }, { allowRemote: true })).rejects.toThrow(/private|local/); await expect(loadData({ provider: "rest", url: "http://user:pass@example.com/data" }, { allowRemote: true })).rejects.toThrow(/credential-free/); });
  it("enforces exact extension allowlists", async () => { await expect(createFunctionRegistry({ modules: ["tests/fixtures/isolated-extension.mjs"], allowCustomCode: true, cwd: process.cwd(), allowlist: ["other.mjs"] })).rejects.toThrow(/allowlist/); });
});
