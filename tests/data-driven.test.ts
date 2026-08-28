import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { loadData } from "../src/data.js";
import { callUtility, createFunctionRegistry } from "../src/extensions.js";
import { compileAdvancedQaLanguage } from "../src/qa-advanced.js";
import { loadTestFile } from "../src/qa-loader.js";
import { runSuite } from "../src/runner.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("data providers", () => {
  it("loads typed CSV and nested JSON with stable fingerprints", async () => {
    const csv = await loadData({ file: "tests/fixtures/cases.csv" }, { cwd: resolve(".") });
    const json = await loadData({ file: "tests/fixtures/cases.json", path: "cases" }, { cwd: resolve(".") });
    expect(csv.rows[0]?.values).toMatchObject({ a: 2, expected: 5 });
    expect(json.rows).toHaveLength(2);
    expect(csv.fingerprint).toMatch(/^sha256:/);
  });

  it("loads an Excel worksheet", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-xlsx-")); temporary.push(directory);
    const file = join(directory, "cases.xlsx");
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Regression");
    sheet.addRow(["caseId", "a", "b"]); sheet.addRow(["excel-one", 2, 3]); await workbook.xlsx.writeFile(file);
    const data = await loadData({ provider: "excel", file, sheet: "Regression" });
    expect(data.rows[0]?.values).toMatchObject({ caseId: "excel-one", a: 2, b: 3 });
  });

  it("gates remote and custom providers", async () => {
    await expect(loadData({ provider: "rest", url: "https://example.com" })).rejects.toThrow(/allow-remote-data/);
    await expect(loadData({ provider: "plugin", module: "x.mjs" })).rejects.toThrow(/allow-custom-code/);
  });
});

describe("utilities and extensions", () => {
  it("runs deterministic builtins", async () => {
    const registry = await createFunctionRegistry();
    expect(await callUtility(registry, "lowercase", { value: " QA " })).toBe(" qa ");
    expect(await callUtility(registry, "hash", { value: "fixed" })).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires opt-in before loading custom code", async () => {
    await expect(createFunctionRegistry({ modules: ["tests/fixtures/custom-functions.mjs"] })).rejects.toThrow(/not enabled/);
    const registry = await createFunctionRegistry({ modules: ["tests/fixtures/custom-functions.mjs"], allowCustomCode: true, cwd: resolve(".") });
    expect(await callUtility(registry, "calculateTax", { amount: 100, rate: 0.08 })).toBe(8);
  });
});

describe("flow and row expansion", () => {
  it("executes inline and CSV rows as isolated named tests", async () => {
    const suite = await loadTestFile(resolve("examples/data-driven.mcpr"));
    expect(suite.tests).toHaveLength(5);
    expect(suite.tests.map((test) => test.name)).toContain("Addition examples from CSV [negative]");
    const result = await runSuite(suite);
    expect(result.summary).toEqual({ passed: 5, failed: 0, skipped: 0, blocked: 0 });
  }, 30_000);

  it("rejects recursive reusable flows", async () => {
    await expect(compileAdvancedQaLanguage(`Suite: "x"\nServer: node x.js\nFlow: "A"\n  Use flow "B"\nFlow: "B"\n  Use flow "A"\nTest: "x"\n  Use flow "A"\n`, "recursive.mcpr")).rejects.toThrow(/Recursive flow/);
  });

  it("executes explicitly enabled custom functions in a test", async () => {
    const suite = await compileAdvancedQaLanguage(`Suite: "custom"\nServer: node --import tsx tests/fixtures/server.ts\nFunctions: tests/fixtures/custom-functions.mjs\nTest: "custom utility"\n  Set "tax" using "calculateTax" with:\n    amount: 100\n    rate: 0.08\n  Call tool "add" with:\n    a: "${"${tax}"}"\n    b: 0\n  Expect "structuredContent.sum" equals 8\n`, resolve("custom.mcpr"));
    await expect(runSuite(suite)).rejects.toThrow(/not enabled/);
    const result = await runSuite(suite, { allowCustomCode: true, cwd: resolve(".") });
    expect(result.status).toBe("passed");
  }, 15_000);
});
