import { describe, expect, it } from "vitest";
import { auditCsv, auditPdf } from "../src/export.js";
import { auditMarkdown, auditReport, auditTarget, type AuditResult } from "../src/audit.js";
import type { Target } from "../src/types.js";

const target: Target = { transport: "stdio", command: "node", args: ["--import", "tsx", "tests/fixtures/server.ts"] };

describe("deterministic security audit", () => {
  it("runs non-destructive probes and skips tool execution unless explicitly allowed", async () => {
    const result = await auditTarget(target);
    expect(result.deterministic).toBe(true);
    expect(result.score).toBe(100);
    expect(result.findings.some((item) => item.category === "malformed-request" && item.status === "passed")).toBe(true);
    expect(result.findings.some((item) => item.category === "tool-spoofing" && item.status === "passed")).toBe(true);
    expect(result.findings.some((item) => item.tool === "add" && item.status === "skipped" && item.message.includes("--allow-tool add"))).toBe(true);
  }, 60_000);

  it("produces terminal, markdown, CSV, and rich PDF reports", () => {
    const result: AuditResult = {
      schemaVersion: 1, server: { name: "demo", version: "1" }, startedAt: "2026-01-01T00:00:00Z", durationMs: 12,
      score: 45, grade: "F", deterministic: true,
      summary: { passed: 1, failed: 2, skipped: 1, critical: 1, high: 1, medium: 0, low: 0 },
      findings: [
        { id: "MCP-AUDIT-001", category: "malformed-request", title: "Reject malformed", status: "passed", severity: "info", message: "Rejected" },
        { id: "MCP-AUDIT-005-x", category: "prompt-injection", title: "Injection", status: "failed", severity: "high", tool: "x", message: "Canary reflected" },
        { id: "MCP-AUDIT-006-x", category: "secret-exposure", title: "Secret", status: "failed", severity: "critical", tool: "x", message: "Secret exposed", evidence: "[CANARY REDACTED]" },
        { id: "MCP-AUDIT-004", category: "path-traversal", title: "Traversal", status: "skipped", severity: "info", message: "No resources" },
      ],
    };
    expect(auditReport(result)).toContain("45/100 (grade F)");
    expect(auditMarkdown(result)).toContain("# MCP Rigor security audit");
    expect(auditCsv(result)).toContain("MCP-AUDIT-006-x,secret-exposure,failed,critical");
    const pdf = auditPdf(result).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/Helvetica-Bold");
    expect(pdf.trim().endsWith("%%EOF")).toBe(true);
  });
});
