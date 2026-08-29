import { assertError, assertResponse } from "./assertions.js";
import { fingerprint } from "./canonical.js";
import { callUtility, createFunctionRegistry } from "./extensions.js";
import { readPath, replaceVariables } from "./path.js";
import { SnapshotStore } from "./snapshots.js";
import { collectTargetSecrets, createRedactor } from "./redact.js";
import { createSession } from "./session.js";
import { traceSession, type TraceRecorder } from "./trace.js";
import type { RunResult, SessionInfo, StepResult, Suite, TestCase, TestResult, TestSession, TestStep } from "./types.js";

export interface RunOptions {
  filter?: string; sessionFactory?: typeof createSession; allowCustomCode?: boolean;
  retries?: number; quarantine?: Array<{ suite: string; test: string }>; suitePath?: string;
  functionTimeoutMs?: number; cwd?: string; state?: Record<string, unknown>;
  trace?: TraceRecorder;
  snapshotFile?: string;
  updateSnapshots?: boolean;
}

export async function runSuite(suite: Suite, options: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const tests: TestResult[] = [];
  const protocolVersions = new Set<string>();
  const resolvedTarget = replaceVariables(suite.target, { state: options.state ?? {} }) as Suite["target"];
  if (options.cwd && resolvedTarget.transport === "stdio" && !resolvedTarget.cwd) resolvedTarget.cwd = options.cwd;
  if (resolvedTarget.transport === "streamable-http" && resolvedTarget.tokenFrom) {
    const { fetchToken } = await import("./session.js");
    const token = await fetchToken(resolvedTarget.tokenFrom);
    resolvedTarget.headers = { ...resolvedTarget.headers, Authorization: `Bearer ${token}` };
    delete resolvedTarget.tokenFrom;
  }
  const redactor = createRedactor([...(suite.redact ?? []), ...collectTargetSecrets(resolvedTarget)]);
  const snapshots = new SnapshotStore({ file: options.snapshotFile ?? suite.snapshots?.file ?? "mcprigor.snap.json", update: options.updateSnapshots, ignore: suite.snapshots?.ignore });
  await snapshots.load();
  const functions = await createFunctionRegistry({ modules: suite.extensions?.functions, allowCustomCode: options.allowCustomCode, timeoutMs: options.functionTimeoutMs, cwd: options.cwd, permissions: suite.extensions?.permissions, allowlist: suite.extensions?.allowlist, unsafeLegacy: suite.extensions?.unsafeLegacy });
  const ordered = orderTests(suite.tests);
  const resultsById = new Map<string, TestResult>();
  const sharedOutputs: Record<string, unknown> = {};
  let server: RunResult["server"];
  let traceContext: { testId?: string; step?: string } = {};

  for (const test of ordered) {
    const id = testId(test);
    if (options.filter && !matchesFilter(test.name, options.filter)) continue;
    const blocking = (test.dependsOn ?? []).filter((dependency) => {
      const candidates = dependencyResults(dependency, resultsById);
      return !candidates.length || candidates.some((result) => result.status !== "passed");
    });
    if (blocking.length) {
      const result: TestResult = { id, name: test.name, status: "blocked", durationMs: 0, steps: [], error: `MCP-DEP-003 Blocked because these dependencies did not pass: ${blocking.join(", ")}` };
      tests.push(result); resultsById.set(id, result); continue;
    }
    if (test.skip) {
      const result: TestResult = { id, name: test.name, status: "skipped", durationMs: 0, steps: [], ...(typeof test.skip === "string" ? { error: test.skip } : {}) };
      tests.push(result); resultsById.set(id, result); continue;
    }
    if (options.quarantine?.some((entry) => entry.test === test.name && (!options.suitePath || entry.suite === options.suitePath))) {
      const result: TestResult = { id, name: test.name, status: "skipped", durationMs: 0, steps: [], error: "MCP-FLAKY-001 Quarantined as flaky; remove from .mcprigor/quarantine.txt to re-enable" };
      tests.push(result); resultsById.set(id, result); continue;
    }
    const dependencyVariables = Object.fromEntries((test.dependsOn ?? []).flatMap((dependency) => dependencyOutputEntries(dependency, resultsById)));
    traceContext = { testId: id };
    const attempts = Math.max(1, Math.min(5, (options.retries ?? 0) + 1));
    let outcome: Awaited<ReturnType<typeof runTest>> | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const baseSession = (options.sessionFactory ?? createSession)(resolvedTarget);
      const session = options.trace ? traceSession(baseSession, options.trace, () => traceContext) : baseSession;
      session.configureClient?.(suite.client ?? {});
      outcome = await runTest(suite, test, session, protocolVersions, redactor, functions, options.functionTimeoutMs, { state: expandDotted(options.state ?? {}), deps: dependencyVariables }, (step) => { traceContext = { testId: id, step }; }, snapshots);
      if (outcome.result.status !== "failed" || attempt === attempts) break;
    }
    if (!outcome) continue;
    if (attempts > 1 && outcome.result.status === "passed") outcome.result.retried = true;
    server ??= outcome.info ? { name: outcome.info.serverName, version: outcome.info.serverVersion, capabilities: outcome.info.capabilities } : undefined;
    tests.push(outcome.result); resultsById.set(id, outcome.result);
  }

  await snapshots.save();
  aggregateLogicalOutputs(ordered, resultsById, sharedOutputs);
  for (const [id, result] of resultsById) if (result.outputs) for (const [key, value] of Object.entries(result.outputs)) sharedOutputs[`${id}.${key}`] = value;
  const summary = count(tests);
  const core = {
    schemaVersion: 1 as const, suiteName: suite.name ?? "MCP Rigor suite",
    status: summary.failed === 0 && summary.blocked === 0 ? "passed" as const : "failed" as const,
    startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
    protocolVersions: [...protocolVersions].sort(), ...(server ? { server: redactor.value(server) } : {}),
    tests: redactor.value(tests), outputs: redactor.value(sharedOutputs), summary,
  };
  return { ...core, evidenceHash: fingerprint({ ...core, startedAt: undefined, durationMs: undefined }) };
}

async function runTest(
  suite: Suite, test: TestCase, session: TestSession, versions: Set<string>, redactor: ReturnType<typeof createRedactor>,
  functions: Awaited<ReturnType<typeof createFunctionRegistry>>, functionTimeoutMs = 5000, inherited: Record<string, unknown> = {}, setTraceContext: (step: string) => void = () => {}, snapshots: SnapshotStore,
): Promise<{ result: TestResult; info?: SessionInfo }> {
  const started = Date.now(); const results: StepResult[] = []; const outputs: Record<string, unknown> = {};
  const variables: Record<string, unknown> = { ...inherited, ...(test.variables ?? {}) };
  let failure: string | undefined; let info: SessionInfo | undefined;
  try {
    info = await session.connect(); if (info.protocolVersion) versions.add(info.protocolVersion);
    const unmet = unmetRequirement(test.requires, info);
    if (unmet) return { info, result: { id: testId(test), name: test.name, status: "skipped", durationMs: Date.now() - started, steps: [], error: unmet } };
    for (const [index, step] of test.steps.entries()) {
      if (failure && !step.always && step.phase !== "cleanup") continue;
      const stepStarted = Date.now();
      setTraceContext(step.name ?? `step ${index + 1}`);
      if ("native" in step) {
        const stepName = step.name ?? `MCP native ${step.native.action}`;
        try {
          const result = await executeNativeStep(session, step.native, variables);
          assertResponse(result, replaceVariables(step.assert, variables) as typeof step.assert);
          for (const [key, path] of Object.entries(step.capture ?? {})) { const value = readPath(result, path); if (value === undefined) throw new Error(`MCP-CAPTURE-001 Capture ${key} found no value at ${path}`); variables[key] = value; }
          results.push({ name: stepName, method: `native/${step.native.action}`, status: "passed", durationMs: Date.now() - stepStarted, response: result });
        } catch (error) { failure = codeMessage(error, "MCP-NATIVE-001"); results.push({ name: stepName, method: `native/${step.native.action}`, status: "failed", durationMs: Date.now() - stepStarted, error: failure }); }
        continue;
      }
      if ("set" in step) {
        const stepName = step.name ?? `Set ${step.set.variable} using ${step.set.function}`;
        try {
          variables[step.set.variable] = await callUtility(functions, step.set.function, replaceVariables(step.set.arguments ?? {}, variables) as Record<string, unknown>, functionTimeoutMs);
          results.push({ name: stepName, method: `utility/${step.set.function}`, status: "passed", durationMs: Date.now() - stepStarted, response: variables[step.set.variable] });
        } catch (error) { failure = codeMessage(error, "MCP-EXT-005"); results.push({ name: stepName, method: `utility/${step.set.function}`, status: "failed", durationMs: Date.now() - stepStarted, error: failure }); }
        continue;
      }
      const operation = operationOf(step, variables); const stepName = step.name ?? `${index + 1}. ${operation.method}`;
      try {
        let response: unknown;
        try { response = await session.request(operation.method, operation.params, step.timeoutMs ?? suite.defaults?.timeoutMs ?? 10_000); assertResponse(response, replaceVariables(step.assert, variables) as typeof step.assert); }
        catch (error) { assertError(error, step.assert); response = errorObject(error); }
        const snapshotAssertions = Array.isArray(step.assert?.json) ? step.assert.json : step.assert?.json ? [step.assert.json] : [];
        for (const snapshot of snapshotAssertions) if (snapshot.snapshot) snapshots.match(`${testId(test)}.${snapshot.snapshot.name}`, readPath(response, snapshot.path), snapshot.snapshot.ignore);
        for (const [key, path] of Object.entries(step.capture ?? {})) { const captured = readPath(response, path); if (captured === undefined) throw new Error(`MCP-CAPTURE-001 Capture ${key} found no value at ${path}`); variables[key] = captured; }
        for (const [key, definition] of Object.entries(step.export ?? {})) { const value = readPath(response, definition.path); if (value === undefined) throw new Error(`MCP-EXPORT-001 Export ${key} found no value at ${definition.path}`); outputs[key] = value; }
        results.push({ name: stepName, method: operation.method, status: "passed", durationMs: Date.now() - stepStarted, request: operation.params, response });
      } catch (error) { failure = codeMessage(error, "MCP-ASSERT-001"); results.push({ name: stepName, method: operation.method, status: "failed", durationMs: Date.now() - stepStarted, request: operation.params, error: failure }); }
    }
  } catch (error) { failure = codeMessage(error, "MCP-CONNECT-001"); }
  finally { try { await session.close(); } catch (error) { failure ??= codeMessage(error, "MCP-CLEANUP-001"); } }
  return { info, result: redactor.value({ id: testId(test), name: test.name, status: failure ? "failed" : "passed", durationMs: Date.now() - started, steps: results, ...(Object.keys(outputs).length ? { outputs } : {}), ...(failure ? { error: redactor.text(failure) } : {}) }) };
}

function orderTests(tests: TestCase[]): TestCase[] {
  const ids = new Map<string, TestCase>();
  for (const test of tests) { const id = testId(test); if (ids.has(id)) throw new Error(`MCP-DEP-001 Duplicate test ID: ${id}`); ids.set(id, test); }
  const result: TestCase[] = []; const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (test: TestCase) => { const id = testId(test); if (visiting.has(id)) throw new Error(`MCP-DEP-002 Circular test dependency involving ${id}`); if (visited.has(id)) return; visiting.add(id); for (const dependency of test.dependsOn ?? []) { const matches = tests.filter((candidate) => testId(candidate) === dependency || candidate.logicalName && slug(candidate.logicalName) === dependency); if (!matches.length) throw new Error(`MCP-DEP-004 Test ${id} depends on unknown test ${dependency}`); for (const match of matches) visit(match); } visiting.delete(id); visited.add(id); result.push(test); };
  for (const test of tests) visit(test); return result;
}
function expandDotted(values: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split("."); let current = root;
    for (let index = 0; index < parts.length - 1; index++) { const part = parts[index]!; const next = current[part]; current = typeof next === "object" && next !== null ? next as Record<string, unknown> : (current[part] = {}) as Record<string, unknown>; }
    current[parts.at(-1)!] = value;
  }
  return root;
}
function dependencyResults(dependency: string, results: Map<string, TestResult>): TestResult[] { return [...results].filter(([id]) => id === dependency || id.startsWith(`${dependency}.`)).map(([, result]) => result); }
function dependencyOutputEntries(dependency: string, results: Map<string, TestResult>): Array<[string, unknown]> {
  const matches = [...results].filter(([id]) => id === dependency || id.startsWith(`${dependency}.`));
  if (matches.length === 1) return [[dependency, matches[0]![1].outputs ?? {}]];
  const combined: Record<string, unknown[]> = {};
  for (const [, result] of matches) for (const [key, value] of Object.entries(result.outputs ?? {})) (combined[key] ??= []).push(value);
  return [[dependency, combined]];
}
function aggregateLogicalOutputs(tests: TestCase[], results: Map<string, TestResult>, destination: Record<string, unknown>): void {
  const groups = new Map<string, TestCase[]>();
  for (const test of tests) { const logical = slug(test.logicalName ?? test.name); groups.set(logical, [...(groups.get(logical) ?? []), test]); }
  for (const [logical, group] of groups) if (group.length > 1) {
    const names = new Set(group.flatMap((test) => Object.keys(results.get(testId(test))?.outputs ?? {})));
    for (const name of names) destination[`${logical}.${name}`] = group.map((test) => results.get(testId(test))?.outputs?.[name]).filter((value) => value !== undefined);
  }
}
async function executeNativeStep(session: TestSession, native: Extract<TestStep, { native: unknown }>["native"], variables: Record<string, unknown>): Promise<unknown> {
  const params = replaceVariables(native.params, variables);
  if (native.behavior) session.configureClient?.(replaceVariables(native.behavior, variables) as any);
  if (native.action === "configure-client") return { configured: true };
  if (native.action === "await-notification") { if (!session.awaitEvent || !native.method) throw new Error("Native event support is unavailable"); return session.awaitEvent(native.method, native.timeoutMs); }
  if (native.action === "subscribe") { if (!session.subscribe || !native.uri) throw new Error("Resource subscription support is unavailable"); return session.subscribe(String(replaceVariables(native.uri, variables))); }
  if (native.action === "unsubscribe") { if (!session.unsubscribe || !native.uri) throw new Error("Resource subscription support is unavailable"); return session.unsubscribe(String(replaceVariables(native.uri, variables))); }
  if (native.action === "set-log-level") { if (!session.setLoggingLevel || !native.level) throw new Error("Logging support is unavailable"); return session.setLoggingLevel(native.level); }
  if (native.action === "list-all") { if (!native.method || !native.field) throw new Error("list-all needs method and field"); const items: unknown[] = []; let cursor: string | undefined; const seen = new Set<string>(); do { const page = await session.request(native.method, cursor ? { ...(params as any), cursor } : params, native.timeoutMs); const value = (page as any)[native.field]; if (Array.isArray(value)) items.push(...value); cursor = typeof (page as any).nextCursor === "string" ? (page as any).nextCursor : undefined; if (cursor && seen.has(cursor)) throw new Error(`MCP-PAGE-001 Repeated pagination cursor ${cursor}`); if (cursor) seen.add(cursor); } while (cursor); return { items, pages: seen.size + 1 }; }
  if (native.action === "task-get") return session.request("tasks/get", { taskId: String(replaceVariables(native.taskId, variables)) }, native.timeoutMs);
  if (native.action === "task-list") return session.request("tasks/list", params, native.timeoutMs);
  if (native.action === "task-cancel") return session.request("tasks/cancel", { taskId: String(replaceVariables(native.taskId, variables)) }, native.timeoutMs);
  if (!session.nativeRequest || !native.method) throw new Error("Native request support is unavailable");
  return session.nativeRequest(native.method, params, { timeoutMs: native.timeoutMs, progress: native.progress, cancelAfterMs: native.cancelAfterMs, task: false });
}
function operationOf(step: Exclude<TestStep, { set: unknown } | { native: unknown }>, variables: Record<string, unknown>) { if ("tool" in step) { const tool = replaceVariables(step.tool, variables) as typeof step.tool; return { method: "tools/call", params: { name: tool.name, arguments: tool.arguments ?? {} } }; } return { method: step.request.method, params: replaceVariables(step.request.params, variables) }; }
function unmetRequirement(requires: TestCase["requires"], info: SessionInfo): string | undefined { if (!requires) return undefined; if (requires.protocolVersions?.length && (!info.protocolVersion || !requires.protocolVersions.includes(info.protocolVersion))) return `MCP-REQ-002 requires protocol ${requires.protocolVersions.join(", ")}; server negotiated ${info.protocolVersion ?? "unknown"}`; for (const capability of requires.capabilities ?? []) if (!hasPath(info.capabilities, capability)) return `MCP-REQ-001 server does not declare capability ${capability}`; return undefined; }
function hasPath(value: unknown, path: string): boolean { let current = value; for (const part of path.split(".")) { if (typeof current !== "object" || current === null || !(part in current)) return false; current = (current as Record<string, unknown>)[part]; } return true; }
function count(tests: TestResult[]) { return { passed: tests.filter((x) => x.status === "passed").length, failed: tests.filter((x) => x.status === "failed").length, skipped: tests.filter((x) => x.status === "skipped").length, blocked: tests.filter((x) => x.status === "blocked").length }; }
function matchesFilter(name: string, filter: string): boolean { const escaped = filter.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*"); return new RegExp(`^${escaped}$`, "i").test(name); }
function testId(test: TestCase): string { return test.id ?? slug(test.name); }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "test"; }
function codeMessage(error: unknown, code: string): string { const message = error instanceof Error ? error.message : String(error); return /^MCP-[A-Z]+-\d{3}/.test(message) ? message : `${code} ${message}`; }
function errorObject(error: unknown): unknown { if (typeof error !== "object" || error === null) return { message: String(error) }; const value = error as { code?: unknown; message?: unknown; data?: unknown }; return { code: value.code, message: String(value.message ?? error), data: value.data }; }
