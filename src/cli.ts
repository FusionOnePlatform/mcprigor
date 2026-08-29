#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { authorTest, createReadlinePromptAdapter } from "./author.js";
import { checkContract, compareContracts, contractMarkdown, contractReport, readContract, updateContract } from "./contract.js";
import { discoverTarget, generateSuite, writeGeneratedSuite, writeLock } from "./discovery.js";
import { loadTestFile } from "./qa-loader.js";
import { parityMarkdown, parityReport, runParity } from "./parity.js";
import { terminalReport, writeHtmlReport, writeJsonReport, writeJunitReport } from "./reporters.js";
import { runSuite } from "./runner.js";
import { replayReport, replayTrace } from "./replay.js";
import { readState, writeState } from "./state.js";
import { compareEvidence, showEvidence, TraceRecorder, writeEvidenceBundle } from "./trace.js";
import { collectTargetSecrets, createRedactor } from "./redact.js";
import { writeStarter } from "./starter.js";
import type { DiscoveryDocument } from "./types.js";
import { startWorkspace } from "./workspace.js";
import { installSignalCleanup } from "./session.js";
import { formatFailure } from "./errors.js";
const removeSignalCleanup = installSignalCleanup();

async function main(): Promise<void> {
  const [command, file, ...flags] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") return help();
  if (command === "serve" || command === "mcp") { const { startMcpServer } = await import("./mcp-server.js"); await startMcpServer({ root: file && !file.startsWith("--") ? file : process.cwd() }); return new Promise<void>(() => {}); }
  if (command === "workspace" || command === "web") { const workspace = await startWorkspace({ root: file && !file.startsWith("--") ? file : process.cwd(), port: numericFlag([file ?? "", ...flags], "--port") }); console.log(`MCP Rigor QA Workspace\n${workspace.url}\n\nPress Ctrl+C to stop.`); return new Promise<void>(() => {}); }
  const compileOptions = { allowRemoteData: flags.includes("--allow-remote-data"), allowCustomCode: flags.includes("--allow-custom-code"), maxRows: numericFlag(flags, "--max-rows") };
  if (command === "snapshot-diff") { if (!file || !flags[0]) throw new UsageError("snapshot-diff requires two JSON files"); const { semanticDiff, renderSemanticDiff } = await import("./snapshots.js"); const changes = semanticDiff(JSON.parse(await readFile(file, "utf8")), JSON.parse(await readFile(flags[0], "utf8"))); console.log(changes.length ? renderSemanticDiff(changes) : "Snapshots are semantically identical."); process.exitCode = changes.length ? 1 : 0; return; }
  if (command === "evidence-show") { if (!file) throw new UsageError("evidence-show requires a bundle directory"); console.log(await showEvidence(file)); return; }
  if (command === "evidence-compare") { if (!file) throw new UsageError("evidence-compare requires two bundle directories"); const second = flags[0]; if (!second) throw new UsageError("evidence-compare requires two bundle directories"); console.log(await compareEvidence(file, second)); return; }
  if (command === "replay") { if (!file) throw new UsageError("replay requires a trace JSONL file"); const targetFile = requiredFlag(flags, "--target"); const suite = await loadTestFile(resolve(targetFile), compileOptions); const result = await replayTrace(resolve(file), suite.target, { allowTools: repeatedFlag(flags, "--allow-tool"), timeoutMs: numericFlag(flags, "--timeout") }); console.log(replayReport(result)); process.exitCode = result.status === "passed" ? 0 : 1; return; }
  if (command === "contract-diff") { if (!file || !flags[0]) throw new UsageError("contract-diff requires OLD and NEW lock files"); const diff = compareContracts(await readContract(file), await readContract(flags[0])); console.log(flags.includes("--markdown") ? contractMarkdown(diff) : contractReport(diff)); process.exitCode = diff.breaking ? 1 : 0; return; }
  if (command === "init") {
    const output = file ?? "my-mcp-tests.mcpr";
    await writeStarter(output, flags.includes("--force"));
    console.log(`✓ Created ${output}\n\nNext:\n  1. Open the file and set your server command or URL.\n  2. Change the example tool and expected result.\n  3. Run: mcprigor test ${output}`);
    return;
  }
  if (!file) throw new UsageError(`The ${command} command requires a test file`);

  if (command === "author" || command === "create") {
    const targetSuite = await loadTestFile(resolve(file), compileOptions);
    const output = flag(flags, "--out") ?? "authored-test.mcpr";
    const prompts = createReadlinePromptAdapter();
    try { await authorTest(targetSuite.target, prompts, output); console.log(`\n✓ Created ${output}\nRun it with: mcprigor test ${output}`); }
    finally { await prompts.close(); }
    return;
  }

  if (command === "parity") {
    const suite = await loadTestFile(resolve(file), compileOptions);
    if (!suite.targets) throw new UsageError("parity requires at least two named targets in the suite's targets section");
    const result = await runParity(suite, suite.targets, { allowCustomCode: compileOptions.allowCustomCode, cwd: process.cwd() });
    const report = flags.includes("--markdown") ? parityMarkdown(result) : parityReport(result);
    const out = flag(flags, "--out"); if (out) await writeFile(out, report, "utf8"); else console.log(report);
    process.exitCode = result.status === "passed" ? 0 : 1; return;
  }
  if (command === "validate" || command === "check") {
    await loadTestFile(resolve(file), compileOptions);
    console.log(`✓ ${file} looks good and is ready to run`);
    return;
  }
  if (command === "contract-check") {
    const suite = await loadTestFile(resolve(requiredFlag(flags, "--target")), compileOptions);
    const checked = await checkContract(resolve(file), suite.target);
    const report = flags.includes("--markdown") ? contractMarkdown(checked.diff) : contractReport(checked.diff);
    const out = flag(flags, "--out"); if (out) await writeFile(out, report + "\n", "utf8"); else console.log(report);
    process.exitCode = checked.diff.breaking ? 1 : 0; return;
  }
  if (command === "contract-update") {
    const suite = await loadTestFile(resolve(requiredFlag(flags, "--target")), compileOptions);
    const diff = await updateContract(resolve(file), suite.target); console.log(contractReport(diff)); return;
  }
  if (command === "discover") {
    const suite = await loadTestFile(resolve(file), compileOptions);
    const output = flag(flags, "--out") ?? "mcp.lock.yaml";
    const lock = await discoverTarget(suite.target);
    await writeLock(lock, output);
    console.log(`✓ Found ${lock.tools.length} tools, ${lock.resources.length} resources, and ${lock.prompts.length} prompts`);
    console.log(`  Saved the server contract to ${output}`);
    return;
  }
  if (command === "generate") {
    const lock = YAML.parse(await readFile(resolve(file), "utf8")) as DiscoveryDocument;
    const targetFile = requiredFlag(flags, "--target");
    const target = (await loadTestFile(resolve(targetFile))).target;
    const output = flag(flags, "--out") ?? "mcp.generated.yaml";
    await writeGeneratedSuite(generateSuite(lock, target), output);
    console.log(`✓ Created ready-to-run contract tests in ${output}`);
    return;
  }
  if (command !== "run" && command !== "test") throw new UsageError(`Unknown command: ${command}. Try: mcprigor --help`);

  const suite = await loadTestFile(resolve(file), compileOptions);
  const filter = flag(flags, "--test");
  const stateIn = flag(flags, "--state-in");
  const loadedState = stateIn ? await readState(resolve(stateIn), suite.target, flags.includes("--allow-state-target-mismatch")) : undefined;
  const evidenceDirectory = flag(flags, "--evidence");
  const trace = evidenceDirectory ? new TraceRecorder(createRedactor([...(suite.redact ?? []), ...collectTargetSecrets(suite.target)])) : undefined;
  const snapshotFile = flag(flags, "--snapshot");
  if (flags.includes("--update-snapshots") && !snapshotFile && !suite.snapshots?.file) throw new UsageError("--update-snapshots requires --snapshot FILE or suite snapshot configuration");
  const result = await runSuite(suite, { ...(filter ? { filter } : {}), allowCustomCode: compileOptions.allowCustomCode, cwd: process.cwd(), state: loadedState?.outputs, trace, snapshotFile, updateSnapshots: flags.includes("--update-snapshots") });
  console.log(terminalReport(result));
  const json = flag(flags, "--json");
  const junit = flag(flags, "--junit");
  const html = flag(flags, "--html");
  if (json) await writeJsonReport(result, json);
  if (junit) await writeJunitReport(result, junit);
  if (html) { await writeHtmlReport(result, html); console.log(`\nReadable report: ${html}`); }
  if (evidenceDirectory && trace) { const manifest = await writeEvidenceBundle(evidenceDirectory, result, suite.target, trace); console.log(`\nEvidence bundle: ${evidenceDirectory}\nNormalized trace: ${manifest.normalizedTraceHash}`); }
  const stateOut = flag(flags, "--state-out");
  if (stateOut && result.status === "passed") { await writeState(resolve(stateOut), suite.target, suite, result.outputs); console.log(`\nSaved reusable outputs: ${stateOut}`); }
  else if (stateOut) console.log("\nState was not saved because the run did not pass.");
  process.exitCode = result.status === "passed" ? 0 : 1;
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function repeatedFlag(args: string[], name: string): string[] { return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]!] : []); }
function numericFlag(args: string[], name: string): number | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new UsageError(`${name} must be a positive whole number`);
  return parsed;
}
function requiredFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new UsageError(`${name} is required`);
  return value;
}
function help(): void {
  console.log(`MCP Rigor — acceptance testing for everyone

Start here:
  mcprigor workspace [DIRECTORY] [--port 4173]
                                      Open the local QA web workspace
  mcprigor serve [DIRECTORY]          Expose MCP Rigor as an MCP server (stdio)
                                      so AI agents can write and run tests
  mcprigor init my-tests.mcpr       Create an editable example
  mcprigor check my-tests.mcpr      Check the wording before running
  mcprigor test my-tests.mcpr       Run the tests
  mcprigor test my-tests.mcpr --html report.html
  mcprigor author server.mcpr --out new-test.mcpr
                                      Guided no-code test creation

Transport parity:
  mcprigor parity suite.mcpr [--markdown] [--out parity.md]
  In .mcpr: Compare target "Local": node server.js
           Compare target "QA": https://qa.example.com/mcp

Data engineering:
  Typed columns, validation, filters, derived values, joins, deterministic samples
  --max-rows 1000          Limit expanded data rows
  --allow-remote-data      Allow REST and Google Sheets
  --allow-custom-code      Allow reviewed function/provider modules

Cross-test and cross-run state:
  --state-in state.json    Load read-only values as \${state.name}
  --state-out state.json   Save successful exported outputs
  --allow-state-target-mismatch  Accept reviewed state from another target

Contract drift:
  mcprigor contract-check mcp.lock.yaml --target server.mcpr [--markdown]
  mcprigor contract-diff old.lock.yaml new.lock.yaml [--markdown]
  mcprigor contract-update mcp.lock.yaml --target server.mcpr

Snapshots and replay:
  mcprigor test tests.mcpr --snapshot expected.snap.json
  mcprigor test tests.mcpr --snapshot expected.snap.json --update-snapshots
  mcprigor snapshot-diff OLD.json NEW.json
  mcprigor replay trace.normalized.jsonl --target server.mcpr [--allow-tool NAME]

Evidence:
  mcprigor test tests.mcpr --evidence .mcprigor/run-1
  mcprigor evidence-show .mcprigor/run-1
  mcprigor evidence-compare RUN-A RUN-B

Advanced:
  mcprigor discover <test-file> [--out mcp.lock.yaml]
  mcprigor generate <lock-file> --target <test-file>
  mcprigor run <yaml-or-json> [--json result.json] [--junit result.xml]

Test files can use friendly .mcpr language or YAML/JSON. No AI or coding is required.`);
}
class UsageError extends Error {}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nMCP Rigor could not continue\n${formatFailure(error)}\n\nTip: run 'mcprigor check <your-file>' to check the test wording.`);
  process.exitCode = error instanceof UsageError || /MCP-CONFIG|QA-LANG|QA-INIT|required/.test(message) ? 2 : 3;
}).finally(() => removeSignalCleanup());
