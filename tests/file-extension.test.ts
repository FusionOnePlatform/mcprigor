import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTestFile } from "../src/qa-loader.js";
import { starterTemplate } from "../src/starter.js";

const dirs: string[] = []; afterEach(async () => Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
describe("MCP Rigor file extension", () => {
  it("loads canonical .mcpr files", async () => { const dir = await mkdtemp(join(tmpdir(), "mcpr-ext-")); dirs.push(dir); const file = join(dir, "suite.mcpr"); await writeFile(file, `MCP Test 1\nSuite: "Extension"\nServer: node server.js\nTest: "ping"\n  Send "ping"\n`); expect((await loadTestFile(file)).name).toBe("Extension"); });
  it("rejects conflicting .mcp files with a rename action", async () => { const dir = await mkdtemp(join(tmpdir(), "mcpr-old-")); dirs.push(dir); const file = join(dir, "suite.mcp"); await writeFile(file, starterTemplate); await expect(loadTestFile(file)).rejects.toThrow(/MCP-CONFIG-006.*rename.*suite\.mcpr/i); });
});
