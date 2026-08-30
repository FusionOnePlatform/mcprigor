import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { loadTestFile } from "../src/qa-loader.js";
import { validateSuite } from "../src/loader.js";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const MCPR_EXAMPLES = [
  "examples/qa-friendly.mcpr",
  "examples/plain-parity.mcpr",
  "examples/full-language-parity.mcpr",
  "examples/data-driven.mcpr",
  "examples/dependent-tests.mcpr",
];

describe("YAML/natural-language suite parity", () => {
  it("every shipped natural-language example converts to a schema-valid YAML suite that reloads identically", async () => {
    for (const example of MCPR_EXAMPLES) {
      const suite = await loadTestFile(example, { allowCustomCode: true, allowRemoteData: true });
      const plain = JSON.parse(JSON.stringify(suite)) as unknown;
      validateSuite(plain); // schema accepts everything the compiler can produce
      const root = await mkdtemp(join(tmpdir(), "rigor-parity-")); roots.push(root);
      const yamlFile = join(root, "suite.yaml");
      await writeFile(yamlFile, YAML.stringify(plain), "utf8");
      const reloaded = await loadTestFile(yamlFile);
      expect(JSON.parse(JSON.stringify(reloaded))).toEqual(plain); // YAML loader yields the identical suite model
    }
  }, 30_000);

  it("mcprigor convert emits YAML and JSON that validate and reload", async () => {
    const root = await mkdtemp(join(tmpdir(), "rigor-convert-")); roots.push(root);
    const cli = join(process.cwd(), "dist", "cli.js");
    const yamlOut = join(root, "converted.yaml");
    const jsonOut = join(root, "converted.json");
    await exec(process.execPath, [cli, "convert", "examples/qa-friendly.mcpr", "--out", yamlOut]);
    await exec(process.execPath, [cli, "convert", "examples/qa-friendly.mcpr", "--format", "json", "--out", jsonOut]);
    const fromYaml = await loadTestFile(yamlOut);
    const fromJson = await loadTestFile(jsonOut);
    expect(JSON.parse(JSON.stringify(fromYaml))).toEqual(JSON.parse(JSON.stringify(fromJson)));
    expect(fromYaml.tests.length).toBeGreaterThan(0);
    const stdout = await exec(process.execPath, [cli, "convert", "examples/qa-friendly.mcpr"]);
    expect(YAML.parse(stdout.stdout).version).toBe(1);
    await expect(exec(process.execPath, [cli, "convert", "examples/qa-friendly.mcpr", "--format", "toml"])).rejects.toThrow(/--format must be yaml or json/);
  }, 30_000);

  it("a converted YAML suite runs with the same results as the original .mcpr", async () => {
    const root = await mkdtemp(join(tmpdir(), "rigor-parity-run-")); roots.push(root);
    const cli = join(process.cwd(), "dist", "cli.js");
    const source = await readFile("examples/qa-friendly.mcpr", "utf8");
    const mcprFile = join(root, "suite.mcpr");
    await writeFile(mcprFile, source.replaceAll("tests/fixtures/server.ts", join(process.cwd(), "tests/fixtures/server.ts")), "utf8");
    const yamlFile = join(root, "suite.yaml");
    await exec(process.execPath, [cli, "convert", mcprFile, "--out", yamlFile]);
    const mcprJson = join(root, "mcpr.json"); const yamlJson = join(root, "yaml.json");
    await exec(process.execPath, [cli, "test", mcprFile, "--json", mcprJson], { cwd: process.cwd() });
    await exec(process.execPath, [cli, "test", yamlFile, "--json", yamlJson], { cwd: process.cwd() });
    const a = JSON.parse(await readFile(mcprJson, "utf8"));
    const b = JSON.parse(await readFile(yamlJson, "utf8"));
    expect(b.status).toBe(a.status);
    expect(b.tests.map((t: { name: string; status: string }) => [t.name, t.status])).toEqual(a.tests.map((t: { name: string; status: string }) => [t.name, t.status]));
  }, 60_000);
});
