#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import YAML from "yaml";
import { authorTest, createReadlinePromptAdapter } from "./author.js";
import { checkContract, compareContracts, contractMarkdown, contractReport, readContract, updateContract } from "./contract.js";
import { discoverTarget, generateSuite, writeGeneratedSuite, writeLock } from "./discovery.js";
import { loadTestFile } from "./qa-loader.js";
import { parityMarkdown, parityReport, runParity } from "./parity.js";
import { githubAnnotations, terminalReport, writeHtmlReport, writeJsonReport, writeJunitReport } from "./reporters.js";
import { runSuite } from "./runner.js";
import { replayReport, replayTrace } from "./replay.js";
import { readState, writeState } from "./state.js";
import { compareEvidence, showEvidence, TraceRecorder, writeEvidenceBundle } from "./trace.js";
import { collectTargetSecrets, createRedactor } from "./redact.js";
import { writeStarter } from "./starter.js";
import type { DiscoveryDocument, Suite } from "./types.js";
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
  if (command === "coverage") {
    if (!file || file.startsWith("--")) throw new UsageError("coverage requires a suite file");
    assertKnownFlags(flags, ["--fail-under", "--json", "--markdown"]);
    const suite = await loadTestFile(resolve(file), compileOptions);
    const { measureCoverage, coverageReport, coverageMarkdown } = await import("./coverage.js");
    const result = await measureCoverage(suite); const threshold = Number(flag(flags, "--fail-under") ?? 0);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new UsageError("coverage --fail-under must be between 0 and 100");
    console.log(flags.includes("--markdown") ? coverageMarkdown(result) : coverageReport(result));
    const jsonOut = flag(flags, "--json"); if (jsonOut) await writeFile(jsonOut, JSON.stringify(result, null, 2) + "\n", "utf8");
    if (result.score < threshold) { console.error(`\nCoverage gate failed: ${result.score}% is below --fail-under ${threshold}.`); process.exitCode = 1; }
    return;
  }
  if (command === "publish") {
    if (!file || file.startsWith("--")) throw new UsageError("publish requires a suite file");
    assertKnownFlags(flags, ["--site", "--out", "--test", "--env", "--command", "--url", "--allow-remote-data", "--allow-custom-code", "--max-rows", "--include-json"]);
    const suite = await loadTestFile(resolve(file), compileOptions);
    await applyEnvironment(suite, flag(flags, "--env"));
    applyTargetOverride(suite, flag(flags, "--command"), flag(flags, "--url"));
    const site = flag(flags, "--site"); const outDir = flag(flags, "--out");
    if (!site && !outDir) throw new UsageError("publish requires --site NETLIFY_SITE (with NETLIFY_AUTH_TOKEN set) or --out DIRECTORY for a local bundle");
    const trace = new TraceRecorder(createRedactor([...(suite.redact ?? []), ...collectTargetSecrets(suite.target)]));
    const filter = flag(flags, "--test");
    const result = await runSuite(suite, { ...(filter ? { filter } : {}), allowCustomCode: compileOptions.allowCustomCode, cwd: process.cwd(), trace });
    console.log(terminalReport(result));
    const { buildTimeline } = await import("./timeline.js");
    const { tmpdir } = await import("node:os"); const { mkdtemp, readFile: readTmp, rm } = await import("node:fs/promises"); const { join: joinPath } = await import("node:path");
    const scratch = await mkdtemp(joinPath(tmpdir(), "mcprigor-publish-"));
    const htmlPath = joinPath(scratch, "index.html");
    await writeHtmlReport(result, htmlPath, buildTimeline(trace.events));
    const files: Record<string, string> = { "/index.html": await readTmp(htmlPath, "utf8") };
    if (flags.includes("--include-json")) files["/result.json"] = JSON.stringify(result, null, 2) + "\n";
    await rm(scratch, { recursive: true, force: true });
    const { publishToNetlify, writeLocalBundle } = await import("./publish.js");
    if (site) {
      const token = process.env.NETLIFY_AUTH_TOKEN || process.env.MCPRIGOR_PUBLISH_TOKEN;
      if (!token) throw new UsageError("publish needs NETLIFY_AUTH_TOKEN (or MCPRIGOR_PUBLISH_TOKEN) in the environment; tokens are never accepted as flags");
      const deployed = await publishToNetlify(files, { site, token });
      console.log(`\nPublished report: ${deployed.url}\nDeploy: ${deployed.deployId} (${deployed.files.length} file${deployed.files.length === 1 ? "" : "s"})`);
    }
    if (outDir) { const written = await writeLocalBundle(files, resolve(outDir)); console.log(`\nReport bundle written to ${resolve(outDir)} (${written.length} file${written.length === 1 ? "" : "s"}). Host the directory on any static site.`); }
    process.exitCode = result.status === "passed" ? 0 : 1;
    return;
  }
  if (command === "monitor") {
    if (!file || file.startsWith("--")) throw new UsageError("monitor requires an HTTP suite file");
    assertKnownFlags(flags, ["--every", "--notify", "--notify-on", "--max-runs"]);
    const every = requiredFlag(flags, "--every"); const notifyOn = flag(flags, "--notify-on") ?? "change";
    if (!["failure", "recovery", "change", "always"].includes(notifyOn)) throw new UsageError("monitor --notify-on must be failure, recovery, change, or always");
    const { monitorSuite, monitorLine, parseDuration } = await import("./monitor.js");
    const controller = new AbortController(); const stop = () => controller.abort(); process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try { await monitorSuite(resolve(file), { cwd: process.cwd(), everyMs: parseDuration(every), notify: flag(flags, "--notify"), notifyOn: notifyOn as "failure" | "recovery" | "change" | "always", maxRuns: numericFlag(flags, "--max-runs"), signal: controller.signal, onRun: (event) => console.log(monitorLine(event)) }); }
    finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
    return;
  }
  if (command === "trends") {
    assertKnownFlags(flags, ["--csv", "--pdf", "--json", "--suite", "--window"]);
    const { loadHistoryFor } = await import("./flaky.js");
    const { historyCsv, trendsCsv, trendsPdf } = await import("./export.js");
    const allFlags = file?.startsWith("--") ? [file, ...flags] : flags;
    const windowSize = Number(flag(allFlags, "--window") ?? 500);
    const suiteFilter = flag(allFlags, "--suite") ?? (file && !file.startsWith("--") ? file : undefined);
    let entries = (await loadHistoryFor(process.cwd())).filter((entry) => entry.mode === "test").slice(-Math.max(1, windowSize));
    if (suiteFilter) entries = entries.filter((entry) => entry.suite === suiteFilter);
    if (!entries.length) throw new UsageError(`No recorded runs found${suiteFilter ? ` for ${suiteFilter}` : ""}. Run tests first; history lives in .mcprigor/workspace-history.jsonl.`);
    const csvOut = flag(allFlags, "--csv"); const pdfOut = flag(allFlags, "--pdf");
    if (csvOut) { await writeFile(csvOut, csvOut.endsWith(".raw.csv") ? historyCsv(entries) : trendsCsv(entries), "utf8"); console.log(`Trends CSV written to ${csvOut}${csvOut.endsWith(".raw.csv") ? " (raw per-run rows)" : " (per-test aggregates)"}`); }
    if (pdfOut) { await writeFile(pdfOut, trendsPdf(entries, suiteFilter)); console.log(`Trends PDF written to ${pdfOut}`); }
    if (flags.includes("--json") || (!csvOut && !pdfOut)) process.stdout.write(trendsCsv(entries));
    return;
  }

  if (command === "audit") {
    const allFlags = file?.startsWith("--") ? [file, ...flags] : flags;
    assertKnownFlags(allFlags, ["--command", "--url", "--allow-tool", "--timeout", "--json", "--pdf", "--csv", "--markdown", "--fail-on"]);
    const targetFile = file && !file.startsWith("--") ? file : undefined;
    let target: Suite["target"];
    if (targetFile) target = (await loadTestFile(resolve(targetFile), compileOptions)).target;
    else {
      const commandOverride = flag(allFlags, "--command"); const urlOverride = flag(allFlags, "--url");
      if (!!commandOverride === !!urlOverride) throw new UsageError("audit requires a suite file, or exactly one of --command / --url");
      target = commandOverride ? commandTarget(commandOverride) : { transport: "streamable-http", url: urlOverride! };
    }
    const failOn = flag(allFlags, "--fail-on") ?? "high";
    if (!["critical", "high", "medium", "low", "none"].includes(failOn)) throw new UsageError("audit --fail-on must be critical, high, medium, low, or none");
    const { auditTarget, auditReport, auditMarkdown } = await import("./audit.js");
    const result = await auditTarget(target, { allowTools: repeatedFlag(allFlags, "--allow-tool"), timeoutMs: numericFlag(allFlags, "--timeout") });
    console.log(allFlags.includes("--markdown") ? auditMarkdown(result) : auditReport(result));
    const { auditPdf, auditCsv } = await import("./export.js");
    const jsonOut = flag(allFlags, "--json"); const pdfOut = flag(allFlags, "--pdf"); const csvOut = flag(allFlags, "--csv");
    if (jsonOut) await writeFile(jsonOut, JSON.stringify(result, null, 2) + "\n", "utf8");
    if (pdfOut) await writeFile(pdfOut, auditPdf(result));
    if (csvOut) await writeFile(csvOut, auditCsv(result), "utf8");
    const rank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 } as const;
    if (failOn !== "none" && result.findings.some((item) => item.status === "failed" && rank[item.severity] >= rank[failOn as keyof typeof rank])) process.exitCode = 1;
    return;
  }

  if (command === "record") {
    const out = flag([file ?? "", ...flags], "--out") ?? "recorded-tests.mcpr";
    const separator = process.argv.indexOf("--");
    if (separator < 0 || !process.argv[separator + 1]) throw new UsageError('record requires the server command after "--", e.g. mcprigor record --out draft.mcpr -- node dist/server.js');
    const [serverCommand, ...serverArgs] = process.argv.slice(separator + 1) as [string, ...string[]];
    const { recordSession } = await import("./record.js");
    console.error(`Recording MCP traffic through ${[serverCommand, ...serverArgs].join(" ")} — drive the session from your client, then close it.`);
    const recorded = await recordSession({ command: serverCommand, args: serverArgs, out });
    console.error(`\n✓ Recorded ${recorded.calls} tool call${recorded.calls === 1 ? "" : "s"} into ${recorded.out}\nReview the draft, then: mcprigor test ${recorded.out}`);
    return;
  }
  if (command === "flaky") {
    assertKnownFlags(flags, ["--window", "--json"]);
    const { analyzeFlakiness, flakyReport, loadHistoryFor } = await import("./flaky.js");
    const root = file && !file.startsWith("--") ? resolve(file) : process.cwd();
    const entries = await loadHistoryFor(root);
    if (!entries.length) { console.log(`No run history found under ${root}/.mcprigor/. Run tests first (CLI runs, the QA workspace, and mcprigor serve all record history).`); return; }
    const data = analyzeFlakiness(entries, numericFlag(flags, "--window") ?? 200);
    console.log(flakyReport(data));
    const jsonOut = flag(flags, "--json");
    if (jsonOut) await writeFile(jsonOut, JSON.stringify(data, null, 2) + "\n", "utf8");
    process.exitCode = data.tests.length ? 1 : 0; return;
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
  if (command === "convert") {
    if (!file || file.startsWith("--")) throw new UsageError("convert requires a suite file (.mcpr, .yaml, .yml, or .json)");
    assertKnownFlags(flags, ["--out", "--format", "--allow-remote-data", "--allow-custom-code", "--max-rows"]);
    const suite = await loadTestFile(resolve(file), compileOptions);
    const format = flag(flags, "--format") ?? "yaml";
    if (!["yaml", "json"].includes(format)) throw new UsageError(`--format must be yaml or json (got ${format})`);
    const loader = await import("./loader.js");
    const validateSuiteModel: (value: unknown) => asserts value is import("./types.js").Suite = loader.validateSuite;
    const plain = JSON.parse(JSON.stringify(suite)) as unknown;
    validateSuiteModel(plain); // guarantee: every natural-language suite converts to a schema-valid YAML/JSON suite
    const rendered = format === "json" ? JSON.stringify(plain, null, 2) + "\n" : YAML.stringify(plain);
    const out = flag(flags, "--out");
    if (out) { await writeFile(resolve(out), rendered, "utf8"); console.log(`✓ Wrote the equivalent ${format.toUpperCase()} suite to ${out}`); }
    else process.stdout.write(rendered);
    return;
  }
  if (command === "drift") {
    assertKnownFlags(flags, ["--against", "--fail-on", "--markdown", "--json", "--out", "--github-annotations", "--allow-remote-data", "--allow-custom-code", "--max-rows", "--env"]);
    const lockFile = requiredFlag(flags, "--against");
    const failOn = flag(flags, "--fail-on") ?? "breaking";
    if (!["breaking", "potentially-breaking", "any", "none"].includes(failOn)) throw new UsageError(`--fail-on must be one of: breaking, potentially-breaking, any, none (got ${failOn})`);
    const suite = await loadTestFile(resolve(file), compileOptions);
    await applyEnvironment(suite, flag(flags, "--env"));
    const checked = await checkContract(resolve(lockFile), suite.target);
    const diff = checked.diff;
    console.log(flags.includes("--markdown") ? contractMarkdown(diff) : contractReport(diff));
    const jsonOut = flag(flags, "--json");
    if (jsonOut) await writeFile(jsonOut, JSON.stringify({ lock: lockFile, failOn, ...diff }, null, 2) + "\n", "utf8");
    if (flags.includes("--github-annotations") || process.env.GITHUB_ACTIONS === "true") {
      const esc = (value: string) => value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
      for (const item of diff.changes) {
        const kind = item.severity === "breaking" ? "error" : item.severity === "potentially-breaking" ? "warning" : "notice";
        console.log(`::${kind} title=${esc(`MCP drift ${item.code}`)}::${esc(item.message)}`);
      }
    }
    const gate = failOn === "none" ? false
      : failOn === "any" ? diff.status === "changed"
      : failOn === "potentially-breaking" ? diff.breaking + diff.potentiallyBreaking > 0
      : diff.breaking > 0;
    if (gate) console.log(`\nDrift gate failed (--fail-on ${failOn}).`);
    else if (diff.status === "changed") console.log(`\nDrift detected but within the allowed gate (--fail-on ${failOn}).`);
    process.exitCode = gate ? 1 : 0; return;
  }
  if (command === "composition-check") {
    const suite = await loadTestFile(resolve(file), compileOptions);
    if (!suite.servers) throw new UsageError("composition-check requires at least two Named server declarations (or a YAML servers mapping)");
    const { discoverComposition, compositionReport } = await import("./composition.js");
    const lock = await discoverComposition(suite.servers); console.log(compositionReport(lock));
    process.exitCode = lock.issues.some((issue) => issue.severity === "breaking") ? 1 : 0; return;
  }
  if (command === "composition-discover") {
    const suite = await loadTestFile(resolve(file), compileOptions);
    if (!suite.servers) throw new UsageError("composition-discover requires at least two Named server declarations (or a YAML servers mapping)");
    const { discoverComposition, compositionReport, writeCompositionLock } = await import("./composition.js");
    const lock = await discoverComposition(suite.servers); const out = flag(flags, "--out") ?? "mcp.composition.lock.yaml";
    await writeCompositionLock(lock, out); console.log(compositionReport(lock)); console.log(`Saved combined fleet contract to ${out}`); return;
  }
  if (command === "composition-drift") {
    const suite = await loadTestFile(resolve(file), compileOptions);
    if (!suite.servers) throw new UsageError("composition-drift requires at least two Named server declarations (or a YAML servers mapping)");
    const against = requiredFlag(flags, "--against"); const failOn = flag(flags, "--fail-on") ?? "breaking";
    if (!["breaking", "potentially-breaking", "any", "none"].includes(failOn)) throw new UsageError("composition-drift --fail-on must be breaking, potentially-breaking, any, or none");
    const { discoverComposition, readCompositionLock, compareCompositions, compositionDriftReport } = await import("./composition.js");
    const diff = compareCompositions(await readCompositionLock(resolve(against)), await discoverComposition(suite.servers));
    console.log(compositionDriftReport(diff)); const jsonOut = flag(flags, "--json"); if (jsonOut) await writeFile(jsonOut, JSON.stringify(diff, null, 2) + "\n", "utf8");
    const gate = failOn === "none" ? false : failOn === "any" ? diff.status === "changed" : failOn === "potentially-breaking" ? diff.breaking + diff.potentiallyBreaking > 0 : diff.breaking > 0;
    process.exitCode = gate ? 1 : 0; return;
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

  assertKnownFlags(flags, ["--test", "--html", "--json", "--junit", "--evidence", "--snapshot", "--update-snapshots", "--state-in", "--state-out", "--allow-state-target-mismatch", "--allow-remote-data", "--allow-custom-code", "--max-rows", "--command", "--url", "--watch", "--github-annotations", "--no-github-annotations", "--retries", "--quarantine", "--env", "--csv", "--pdf", "--fail-on-regression"]);
  const suite = await loadTestFile(resolve(file), compileOptions);
  await applyEnvironment(suite, flag(flags, "--env"));
  applyTargetOverride(suite, flag(flags, "--command"), flag(flags, "--url"));
  const filter = flag(flags, "--test");
  const stateIn = flag(flags, "--state-in");
  const loadedState = stateIn ? await readState(resolve(stateIn), suite.target, flags.includes("--allow-state-target-mismatch")) : undefined;
  const evidenceDirectory = flag(flags, "--evidence");
  const htmlFile = flag(flags, "--html");
  const trace = (evidenceDirectory || htmlFile) ? new TraceRecorder(createRedactor([...(suite.redact ?? []), ...collectTargetSecrets(suite.target)])) : undefined;
  const snapshotFile = flag(flags, "--snapshot");
  if (flags.includes("--update-snapshots") && !snapshotFile && !suite.snapshots?.file) throw new UsageError("--update-snapshots requires --snapshot FILE or suite snapshot configuration");
  const retries = numericFlag(flags, "--retries");
  const quarantine = flags.includes("--quarantine") ? await (await import("./flaky.js")).readQuarantine(resolve(".mcprigor")) : undefined;
  const suiteRelative = file;
  const runOnce = async (loadedSuite = suite) => {
    const result = await runSuite(loadedSuite, { ...(filter ? { filter } : {}), allowCustomCode: compileOptions.allowCustomCode, cwd: process.cwd(), state: loadedState?.outputs, trace, snapshotFile, updateSnapshots: flags.includes("--update-snapshots"), ...(retries ? { retries } : {}), ...(quarantine ? { quarantine, suitePath: suiteRelative } : {}) });
    const { appendHistory } = await import("./workspace.js");
    const { join: joinPath } = await import("node:path");
    await appendHistory(joinPath(process.cwd(), ".mcprigor", "workspace-history.jsonl"), { at: new Date().toISOString(), mode: "test", suite: suiteRelative, status: result.status, durationMs: result.durationMs, tests: result.tests.map((t) => ({ name: t.name, status: t.status, durationMs: t.durationMs, ...(t.error ? { error: t.error } : {}) })) });
    return result;
  };
  if (flags.includes("--watch")) {
    if (flags.includes("--update-snapshots")) throw new UsageError("--watch cannot be combined with --update-snapshots; update snapshots in a single explicit run");
    return watchAndRun(resolve(file), suite, compileOptions, runOnce);
  }
  const result = await runOnce();
  console.log(terminalReport(result));
  const json = flag(flags, "--json");
  const junit = flag(flags, "--junit");
  const csvOut = flag(flags, "--csv");
  const pdfOut = flag(flags, "--pdf");
  const html = htmlFile;
  if (flags.includes("--github-annotations") || (process.env.GITHUB_ACTIONS === "true" && !flags.includes("--no-github-annotations"))) console.log("\n" + githubAnnotations(result, file));
  if (json) await writeJsonReport(result, json);
  if (junit) await writeJunitReport(result, junit);
  if (csvOut || pdfOut) { const { writeRunCsv, writeRunPdf } = await import("./export.js"); if (csvOut) await writeRunCsv(result, csvOut); if (pdfOut) await writeRunPdf(result, pdfOut); }
  if (suite.budgets?.length || flags.includes("--fail-on-regression")) {
    const { loadHistoryFor } = await import("./flaky.js");
    const { checkBudgets, checkRegressions, budgetReport, regressionReport } = await import("./perf.js");
    const entries = (await loadHistoryFor(process.cwd())).filter((entry) => entry.mode === "test");
    const suitePath = relative(process.cwd(), resolve(file));
    let perfFailed = false;
    if (suite.budgets?.length) {
      const outcomes = checkBudgets(suite, entries, suitePath, result);
      console.log(budgetReport(outcomes));
      if (outcomes.some((outcome) => !outcome.insufficient && !outcome.withinBudget)) perfFailed = true;
    }
    if (flags.includes("--fail-on-regression")) {
      const outcomes = checkRegressions(entries, suitePath, result);
      console.log(regressionReport(outcomes));
      if (outcomes.some((outcome) => outcome.regressed)) perfFailed = true;
    }
    if (perfFailed && result.status === "passed") { console.error("\nLatency gate failed."); process.exitCode = 1; }
  }
  if (html) { const { buildTimeline } = await import("./timeline.js"); await writeHtmlReport(result, html, trace ? buildTimeline(trace.events) : undefined); console.log(`\nReadable report: ${html}`); }
  if (evidenceDirectory && trace) { const manifest = await writeEvidenceBundle(evidenceDirectory, result, suite.target, trace); console.log(`\nEvidence bundle: ${evidenceDirectory}\nNormalized trace: ${manifest.normalizedTraceHash}`); }
  const stateOut = flag(flags, "--state-out");
  if (stateOut && result.status === "passed") { await writeState(resolve(stateOut), suite.target, suite, result.outputs); console.log(`\nSaved reusable outputs: ${stateOut}`); }
  else if (stateOut) console.log("\nState was not saved because the run did not pass.");
  process.exitCode = result.status === "passed" ? 0 : 1;
}

const VALUE_FLAGS = new Set(["--test", "--html", "--json", "--junit", "--evidence", "--snapshot", "--state-in", "--state-out", "--max-rows", "--command", "--url", "--out", "--target", "--timeout", "--allow-tool", "--port", "--retries", "--window", "--env", "--every", "--notify", "--notify-on", "--max-runs", "--site", "--against", "--fail-on", "--fail-under", "--csv", "--pdf", "--format"]);
function assertKnownFlags(args: string[], known: string[]): void {
  const knownSet = new Set(known);
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!;
    if (!value.startsWith("--")) continue;
    if (!knownSet.has(value)) throw new UsageError(`Unknown option for this command: ${value}. Run mcprigor --help to see supported options.`);
    if (VALUE_FLAGS.has(value)) index++;
  }
}
async function applyEnvironment(suite: { target: Suite["target"] }, requested?: string): Promise<void> {
  const { findProjectConfig, environmentTarget } = await import("./project-config.js");
  const config = await findProjectConfig(process.cwd());
  if (!config && !requested) return;
  const picked = environmentTarget(config, requested);
  if (!picked) return;
  suite.target = picked.target;
  console.log(`Environment: ${picked.name} (${picked.target.transport === "stdio" ? [picked.target.command, ...(picked.target.args ?? [])].join(" ") : picked.target.url}) from mcprigor.config.yaml\n`);
}
function commandTarget(command: string): Extract<Suite["target"], { transport: "stdio" }> {
  const [head, ...rest] = command.split(/\s+/).filter(Boolean);
  if (!head) throw new UsageError("--command requires a non-empty server command");
  return { transport: "stdio", command: head, args: rest };
}
function applyTargetOverride(suite: { target: Suite["target"] }, command?: string, url?: string): void {
  if (command && url) throw new UsageError("Use either --command or --url, not both");
  if (command) {
    suite.target = commandTarget(command);
    console.log(`Target override: running against command "${command}" instead of the suite's declared target.\n`);
  } else if (url) {
    suite.target = { transport: "streamable-http", url };
    console.log(`Target override: running against ${url} instead of the suite's declared target.\n`);
  }
}

async function watchAndRun(file: string, initialSuite: Suite, compileOptions: { allowRemoteData: boolean; allowCustomCode: boolean; maxRows: number | undefined }, runOnce: (suite: Suite) => Promise<{ status: string; tests: Array<{ status: string }> }>): Promise<void> {
  const { watch } = await import("node:fs");
  const { dirname } = await import("node:path");
  const clear = () => process.stdout.write("\x1Bc");
  let running = false;
  let queued = false;
  const cycle = async () => {
    if (running) { queued = true; return; }
    running = true;
    try {
      clear();
      console.log(`MCP Rigor watch — ${new Date().toLocaleTimeString()}\nRunning ${file}\n`);
      let suite: Suite;
      try { suite = await loadTestFile(file, compileOptions); }
      catch (error) { console.log(formatFailure(error)); console.log("\nWaiting for changes…"); return; }
      const result = await runOnce(suite);
      console.log(terminalReport(result as never));
      const failed = result.tests.filter((test) => test.status === "failed").length;
      console.log(failed ? `\n${failed} failing — waiting for changes…` : "\nAll green — waiting for changes…");
    } finally {
      running = false;
      if (queued) { queued = false; void cycle(); }
    }
  };
  const watchDirs = new Set<string>([dirname(file)]);
  const target = initialSuite.target;
  if (target.transport === "stdio" && target.cwd) watchDirs.add(resolve(target.cwd));
  watchDirs.add(process.cwd());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const trigger = (_event: string, name: string | Buffer | null) => {
    const changed = String(name ?? "");
    if (/^\.|node_modules|\.git|\.mcprigor|report\.html|\.log$/.test(changed)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void cycle(), 250);
  };
  for (const dir of watchDirs) { try { watch(dir, { recursive: true }, trigger); } catch { /* fall back to non-recursive below */ try { watch(dir, trigger); } catch { /* ignore unwatchable dirs */ } } }
  console.log(`Watching ${[...watchDirs].join(", ")} for changes. Press Ctrl+C to stop.`);
  await cycle();
  return new Promise<void>(() => {});
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
  mcprigor convert my-tests.mcpr --out my-tests.yaml
                                      Emit the equivalent YAML (or --format
                                      json) suite; both formats run the same
  mcprigor test my-tests.mcpr       Run the tests
  mcprigor test my-tests.mcpr --html report.html
                                      Readable report with a clickable
                                      request/response session timeline
  mcprigor test my-tests.mcpr --command "node dist/server.js"
                                      Override the suite's declared target
  mcprigor test my-tests.mcpr --url https://qa.example.com/mcp
  mcprigor test my-tests.mcpr --watch
                                      Rerun on test or server file changes
  mcprigor test my-tests.mcpr --csv report.csv --pdf report.pdf
                                      Export the run as CSV rows / a PDF report
  mcprigor trends [suite] [--csv out.csv] [--pdf out.pdf] [--window 500]
                                      Export historical trends (pass rates,
                                      durations) from recorded run history
  mcprigor test my-tests.mcpr --env qa
                                      Use a named environment from
                                      mcprigor.config.yaml (dev/qa/prod)
  mcprigor test my-tests.mcpr --retries 2 [--quarantine]
                                      Retry failures; skip quarantined tests
  mcprigor flaky [DIRECTORY] [--window 200] [--json out.json]
                                      Detect pass/fail flips from run history
  mcprigor record --out draft.mcpr -- node dist/server.js
                                      Proxy a live MCP session and generate a
                                      reviewable test draft from real traffic
  mcprigor author server.mcpr --out new-test.mcpr
                                      Guided no-code test creation
  mcprigor audit server.mcpr --pdf audit.pdf --json audit.json
                                      Deterministic security probe pack; tool
                                      execution requires --allow-tool NAME
  mcprigor coverage server.mcpr --fail-under 80 [--json coverage.json]
                                      Report untested tools, resources, prompts,
                                      templates, and input-schema branches
  mcprigor monitor prod.mcpr --every 15m --notify https://hooks.example/rigor
                                      Continuously monitor an HTTP MCP endpoint,
                                      append history, and notify on transitions
  mcprigor publish suite.mcpr --site YOUR_NETLIFY_SITE
                                      Run the suite and host the HTML report at
                                      a shareable URL (NETLIFY_AUTH_TOKEN env);
                                      or --out DIR for a local static bundle

Multi-server compositions:
  mcprigor composition-check fleet.mcpr
  mcprigor composition-discover fleet.mcpr [--out mcp.composition.lock.yaml]
  mcprigor composition-drift fleet.mcpr --against mcp.composition.lock.yaml
  In .mcpr: Named server "catalog": node catalog.js
            On server "catalog"

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
  mcprigor drift suite.mcpr --against mcp.lock.yaml [--fail-on breaking]
                                      CI gate: fail-on breaking (default),
                                      potentially-breaking, any, or none
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
