import YAML from "yaml";
import type { JsonAssertion, NativeStep, RequestStep, Suite, TestCase, TestStep, ToolStep } from "./types.js";

type ActionStep = RequestStep | ToolStep | NativeStep;

/** Compile a deliberately small, deterministic human-language format. No LLM is involved. */
export function compileQaLanguage(source: string, file = "test.mcpr"): Suite {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  let name = "MCP acceptance tests";
  let target: Suite["target"] | undefined;
  const targets: Record<string, Suite["target"]> = {};
  const servers: Record<string, Suite["target"]> = {};
  let defaults: Suite["defaults"] | undefined;
  const budgets: NonNullable<Suite["budgets"]> = [];
  let redact: string[] | undefined;
  let snapshots: Suite["snapshots"] | undefined;
  let client: Suite["client"] | undefined;
  const tests: TestCase[] = [];
  let test: TestCase | undefined;
  let step: ActionStep | undefined;
  let phase: "setup" | "test" | "cleanup" = "test";

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    const line = raw.trim();
    const lineNumber = index + 1;
    if (!line || line.startsWith("#")) continue;

    let match: RegExpMatchArray | null;
    if (/^MCP Test 1$/i.test(line)) continue;
    if ((match = line.match(/^Suite:\s*(.+)$/i))) { name = unquote(match[1]!); continue; }
    if ((match = line.match(/^Named server\s+["']([^"']+)["']:\s*(.+)$/i))) {
      const label = match[1]!.trim(); const connection = match[2]!.trim();
      if (/^https?:\/\//i.test(connection)) servers[label] = { transport: "streamable-http", url: unquote(connection) };
      else { const words = splitCommand(connection, file, lineNumber); if (!words.length) fail(file, lineNumber, `Write a command or URL after named server “${label}”.`); servers[label] = { transport: "stdio", command: words[0]!, args: words.slice(1) }; }
      target ??= servers[label]; continue;
    }
    if ((match = line.match(/^Server options for\s+["']([^"']+)["']:\s*$/i))) {
      const selected = servers[match[1]!]; if (!selected) fail(file, lineNumber, `Unknown named server “${match[1]}”. Declare it first.`);
      const block = readIndentedMap(lines, index, file); index = block.lastLine;
      Object.assign(selected, selected.transport === "stdio" ? { cwd: block.value.cwd, env: block.value.env } : httpOptions(block.value as Record<string, unknown>, file)); continue;
    }
    if ((match = line.match(/^(?:Compare|Parity) target\s+["']([^"']+)["']:\s*(.+)$/i))) {
      const label = match[1]!.trim(); const connection = match[2]!.trim();
      if (/^https?:\/\//i.test(connection)) targets[label] = { transport: "streamable-http", url: unquote(connection) };
      else { const words = splitCommand(connection, file, lineNumber); if (!words.length) fail(file, lineNumber, `Write a command or URL after parity target “${label}”.`); targets[label] = { transport: "stdio", command: words[0]!, args: words.slice(1) }; }
      target ??= targets[label]; continue;
    }
    if ((match = line.match(/^Target options for\s+["']([^"']+)["']:\s*$/i))) {
      const selected = targets[match[1]!]; if (!selected) fail(file, lineNumber, `Unknown parity target “${match[1]}”. Declare it first.`);
      const block = readIndentedMap(lines, index, file); index = block.lastLine;
      Object.assign(selected, selected.transport === "stdio" ? { cwd: block.value.cwd, env: block.value.env } : httpOptions(block.value as Record<string, unknown>, file)); continue;
    }
    if ((match = line.match(/^Budget(?:\s+for\s+["']([^"']+)["'])?:\s*p(\d{1,3})\s+(\d+)\s*(ms|milliseconds?|s|seconds?)(?:\s+over\s+(\d+)\s+(?:calls|runs|samples))?$/i))) {
      const maxMs = /^s/i.test(match[4]!) ? Number(match[3]) * 1000 : Number(match[3]);
      budgets.push({ test: match[1] ?? "*", percentile: Number(match[2]), maxMs, ...(match[5] ? { window: Number(match[5]) } : {}) });
      continue;
    }
    if ((match = line.match(/^Default timeout:\s*(\d+)\s*(ms|seconds?)$/i))) { defaults = { timeoutMs: match[2]!.toLowerCase().startsWith("s") ? Number(match[1]) * 1000 : Number(match[1]) }; continue; }
    if ((match = line.match(/^Redact:\s*(.+)$/i))) { redact = match[1]!.split(",").map((item) => unquote(item.trim())).filter(Boolean); continue; }
    if ((match = line.match(/^Snapshots:\s*(.+)$/i))) { snapshots = { file: unquote(match[1]!) }; continue; }
    if ((match = line.match(/^Ignore snapshot paths:\s*(.+)$/i))) { snapshots = { ...(snapshots ?? {}), ignore: match[1]!.split(",").map((item) => unquote(item.trim())) }; continue; }
    if (/^Client behavior:\s*$/i.test(line)) { const block = readIndentedMap(lines, index, file); index = block.lastLine; client = block.value as Suite["client"]; continue; }
    if ((match = line.match(/^Server options:\s*$/i))) { if (!target) fail(file, lineNumber, "Declare Server or MCP URL before Server options."); const block = readIndentedMap(lines, index, file); index = block.lastLine; Object.assign(target, target.transport === "stdio" ? { cwd: block.value.cwd, env: block.value.env } : httpOptions(block.value as Record<string, unknown>, file)); continue; }
    if ((match = line.match(/^Server:\s*(.+)$/i))) {
      const words = splitCommand(match[1]!, file, lineNumber);
      if (!words.length) fail(file, lineNumber, "Write a command after 'Server:'.");
      target = { transport: "stdio", command: words[0]!, args: words.slice(1) };
      continue;
    }
    if ((match = line.match(/^(?:MCP URL|Connect to):\s*(\S+)$/i))) {
      target = { transport: "streamable-http", url: unquote(match[1]!) };
      continue;
    }
    if ((match = line.match(/^(?:Test|Scenario):\s*(.+)$/i))) {
      test = { name: unquote(match[1]!), steps: [] };
      tests.push(test);
      step = undefined;
      phase = "test";
      continue;
    }
    if (!test) fail(file, lineNumber, "Start a scenario with 'Test: what you want to verify'.");

    if ((match = line.match(/^On server\s+["']([^"']+)["']$/i))) { test.server = match[1]!.trim(); continue; }
    if ((match = line.match(/^(?:Id|Test ID):\s*["']?([^"']+?)["']?$/i))) { test.id = match[1]!.trim(); continue; }
    if ((match = line.match(/^Skip(?::\s*(.*))?$/i))) { test.skip = match[1]?.trim() ? unquote(match[1]) : true; continue; }
    if (/^Variables:\s*$/i.test(line)) { const block = readIndentedMap(lines, index, file); index = block.lastLine; test.variables = block.value; continue; }
    if ((match = line.match(/^Require protocol:\s*(.+)$/i))) { test.requires = { ...(test.requires ?? {}), protocolVersions: match[1]!.split(",").map((item) => unquote(item.trim())) }; continue; }
    if ((match = line.match(/^(?:After|Depends on):\s*(.+)$/i))) {
      test.dependsOn = match[1]!.split(",").map((item) => unquote(item.trim())).filter(Boolean);
      continue;
    }
    if (/^Setup:$/i.test(line)) { phase = "setup"; step = undefined; continue; }
    if (/^(?:Steps?|Actions?):$/i.test(line)) { phase = "test"; step = undefined; continue; }
    if (/^Cleanup:$/i.test(line)) { phase = "cleanup"; step = undefined; continue; }
    if ((match = line.match(/^(?:Require|Given (?:the )?server supports):\s*(.+)$/i))) {
      test.requires = { capabilities: match[1]!.split(",").map((item) => item.trim()).filter(Boolean) };
      continue;
    }
    if ((match = line.match(/^Wait for notification\s+["']([^"']+)["'](?:\s+within\s+(\d+)\s+seconds?)?$/i))) {
      step = { name: `Wait for notification “${match[1]}”`, native: { action: "await-notification", method: match[1]!, timeoutMs: match[2] ? Number(match[2]) * 1000 : 5000 }, phase, always: phase === "cleanup" };
      test.steps.push(step); continue;
    }
    if ((match = line.match(/^When the server asks for input,\s*respond\s+["'](accept|decline|cancel)["'](\s+with:)?\s*$/i))) {
      const action = match[1]!.toLowerCase() as "accept" | "decline" | "cancel";
      let content: Record<string, string | number | boolean | string[]> | undefined;
      if (match[2]) { const block = readIndentedMap(lines, index, file); index = block.lastLine; content = block.value as Record<string, string | number | boolean | string[]>; }
      if (content && action !== "accept") fail(file, lineNumber, "Only an 'accept' response can include a 'with:' block of field values.");
      step = { name: `Respond to elicitation with ${action}`, native: { action: "configure-client", behavior: { elicitation: { action, ...(content ? { content } : {}) } } }, phase }; test.steps.push(step); continue;
    }
    if ((match = line.match(/^When the server requests sampling,\s*respond\s+["']([^"']*)["']\s*$/i))) {
      step = { name: "Respond to sampling with a scripted message", native: { action: "configure-client", behavior: { sampling: { model: "mcprigor-scripted", text: match[1]! } } }, phase }; test.steps.push(step); continue;
    }
        if ((match = line.match(/^Subscribe to resource\s+["']([^"']+)["']$/i))) { step = { name: `Subscribe to “${match[1]}”`, native: { action: "subscribe", uri: match[1]! }, phase }; test.steps.push(step); continue; }
    if ((match = line.match(/^Unsubscribe from resource\s+["']([^"']+)["']$/i))) { step = { name: `Unsubscribe from “${match[1]}”`, native: { action: "unsubscribe", uri: match[1]! }, phase, always: phase === "cleanup" }; test.steps.push(step); continue; }
    if ((match = line.match(/^Set log level to\s+["']?([^"']+)["']?$/i))) { step = { name: `Set log level to ${match[1]}`, native: { action: "set-log-level", level: match[1]!.trim() }, phase }; test.steps.push(step); continue; }
    if ((match = line.match(/^Call tool\s+["']([^"']+)["']\s+with progress(?:\s+and cancel after\s+(\d+)\s+ms)?(?:\s+with:)?$/i))) {
      const block = line.toLowerCase().endsWith("with:") ? readIndentedMap(lines, index, file) : undefined; if (block) index = block.lastLine;
      step = { name: `Call tool “${match[1]}” with progress`, native: { action: "request", method: "tools/call", params: { name: match[1]!, arguments: block?.value ?? {} }, progress: true, cancelAfterMs: match[2] ? Number(match[2]) : undefined }, phase }; test.steps.push(step); continue;
    }
    if ((match = line.match(/^List all\s+(tools|resources|prompts|resource templates)$/i))) { const item = match[1]!.toLowerCase(); const mapping: Record<string, [string,string]> = { tools: ["tools/list","tools"], resources: ["resources/list","resources"], prompts: ["prompts/list","prompts"], "resource templates": ["resources/templates/list","resourceTemplates"] }; const [method, field] = mapping[item]!; step = { name: `List all ${item}`, native: { action: "list-all", method, field }, phase }; test.steps.push(step); continue; }
    if ((match = line.match(/^Get task\s+["']([^"']+)["']$/i))) { step = { name: `Get task “${match[1]}”`, native: { action: "task-get", taskId: match[1]! }, phase }; test.steps.push(step); continue; }
    if (/^List tasks$/i.test(line)) { step = { name: "List tasks", native: { action: "task-list" }, phase }; test.steps.push(step); continue; }
    if ((match = line.match(/^Cancel task\s+["']([^"']+)["']$/i))) { step = { name: `Cancel task “${match[1]}”`, native: { action: "task-cancel", taskId: match[1]! }, phase }; test.steps.push(step); continue; }
    if ((match = line.match(/^Set\s+["']([^"']+)["']\s+using\s+["']([^"']+)["'](?:\s+with:)?$/i))) {
      const argumentsBlock = line.toLowerCase().endsWith("with:") ? readIndentedMap(lines, index, file) : undefined;
      if (argumentsBlock) index = argumentsBlock.lastLine;
      const utility: TestStep = { name: `Set “${match[1]}” using ${match[2]}`, set: { variable: match[1]!, function: match[2]!, arguments: argumentsBlock?.value }, phase, always: phase === "cleanup" };
      test.steps.push(utility);
      step = undefined;
      continue;
    }
    if ((match = line.match(/^(?:Call|When I call)(?: the)? tool\s+["']([^"']+)["'](?:\s+with:)?$/i))) {
      const argumentsBlock = line.toLowerCase().endsWith("with:") ? readIndentedMap(lines, index, file) : undefined;
      if (argumentsBlock) index = argumentsBlock.lastLine;
      step = { name: `Call tool “${match[1]}”`, tool: { name: match[1]!, arguments: argumentsBlock?.value }, phase, always: phase === "cleanup" };
      test.steps.push(step);
      continue;
    }
    if ((match = line.match(/^(?:Read|When I read)(?: the)? resource\s+["']([^"']+)["']$/i))) {
      step = { name: `Read resource “${match[1]}”`, request: { method: "resources/read", params: { uri: match[1] } }, phase, always: phase === "cleanup" };
      test.steps.push(step);
      continue;
    }
    if ((match = line.match(/^(?:Get|When I get)(?: the)? prompt\s+["']([^"']+)["'](?:\s+with:)?$/i))) {
      const argumentsBlock = line.toLowerCase().endsWith("with:") ? readIndentedMap(lines, index, file) : undefined;
      if (argumentsBlock) index = argumentsBlock.lastLine;
      step = { name: `Get prompt “${match[1]}”`, request: { method: "prompts/get", params: { name: match[1], arguments: argumentsBlock?.value ?? {} } }, phase, always: phase === "cleanup" };
      test.steps.push(step);
      continue;
    }
    if ((match = line.match(/^(?:Send|When I send)\s+["']([^"']+)["'](?:\s+with:)?$/i))) {
      const params = line.toLowerCase().endsWith("with:") ? readIndentedMap(lines, index, file) : undefined;
      if (params) index = params.lastLine;
      step = { name: `Send ${match[1]}`, request: { method: match[1]!, params: params?.value }, phase, always: phase === "cleanup" };
      test.steps.push(step);
      continue;
    }
    if ((match = line.match(/^(?:Expect|Then)(?: the)? call to finish within\s+(\d+)\s*(ms|milliseconds?|s|seconds?)$/i))) { const current = requireStep(step, file, lineNumber); const limit = /^s/i.test(match[2]!) ? Number(match[1]) * 1000 : Number(match[1]); current.assert = { ...(current.assert ?? {}), maxDurationMs: limit }; continue; }
    if (/^(?:Expect|Then)(?: it)? succeeds?$/i.test(line)) { requireStep(step, file, lineNumber).assert = { status: "success" }; continue; }
    if (/^(?:Expect|Then)(?: an)? error$/i.test(line)) { requireStep(step, file, lineNumber).assert = { status: "error" }; continue; }
    if ((match = line.match(/^Expect error code\s+(-?\d+)$/i))) { const current = requireStep(step, file, lineNumber); current.assert = { ...(current.assert ?? {}), status: "error", error: { ...(current.assert?.error ?? {}), code: Number(match[1]) } }; continue; }
    if ((match = line.match(/^Expect error message\s+(equals|contains|matches)\s+(.+)$/i))) { const current = requireStep(step, file, lineNumber); const value = unquote(match[2]!); current.assert = { ...(current.assert ?? {}), status: "error", error: { ...(current.assert?.error ?? {}), ...(match[1]!.toLowerCase() === "matches" ? { matches: value } : { message: value }) } }; continue; }
    if ((match = line.match(/^Expect\s+["']([^"']+)["']\s+does not equal\s+(.+)$/i))) { addAssertion(requireStep(step, file, lineNumber), { path: pathOf(match[1]!), notEquals: parseValue(match[2]!) }); continue; }
    if ((match = line.match(/^Expect\s+["']([^"']+)["']\s+is a\s+(string|number|boolean|object|array|null)$/i))) { addAssertion(requireStep(step, file, lineNumber), { path: pathOf(match[1]!), type: match[2]!.toLowerCase() as JsonAssertion["type"] }); continue; }
    if ((match = line.match(/^Expect\s+["']([^"']+)["']\s+matches\s+(?!snapshot\b)(.+)$/i))) { addAssertion(requireStep(step, file, lineNumber), { path: pathOf(match[1]!), matches: unquote(match[2]!) }); continue; }
    if ((match = line.match(/^Expect\s+["']([^"']+)["']\s+matches schema:\s*$/i))) { const block = readIndentedMap(lines, index, file); index = block.lastLine; addAssertion(requireStep(step, file, lineNumber), { path: pathOf(match[1]!), schema: block.value }); continue; }
    if ((match = line.match(/^(?:Expect|Then)(?: the)?\s+["']([^"']+)["']\s+(equals|is|contains|exists|has)\s*(.*)$/i))) {
      const assertion = humanAssertion(match[1]!, match[2]!, match[3]!, file, lineNumber);
      addAssertion(requireStep(step, file, lineNumber), assertion);
      continue;
    }
    if ((match = line.match(/^Expect\s+["']([^"']+)["']\s+matches snapshot\s+["']([^"']+)["'](?:\s+ignoring\s+(.+))?$/i))) {
      addAssertion(requireStep(step, file, lineNumber), { path: pathOf(match[1]!), snapshot: { name: match[2]!, ...(match[3] ? { ignore: match[3].split(",").map((item) => unquote(item.trim())) } : {}) } });
      continue;
    }
    if ((match = line.match(/^Export\s+["']([^"']+)["']\s+as\s+["']([^"']+)["'](?:\s+collecting\s+(a list|a map))?(?:\s+(sensitive))?$/i))) {
      const current = requireStep(step, file, lineNumber);
      if (!("native" in current) && !("set" in current)) current.export = { ...(current.export ?? {}), [match[2]!]: { path: pathOf(match[1]!), aggregate: match[3]?.toLowerCase() === "a list" ? "list" : match[3] ? "map" : "single", ...(match[4] ? { sensitive: true } : {}) } };
      continue;
    }
    if ((match = line.match(/^(?:Save|Remember)\s+["']([^"']+)["']\s+as\s+["']([^"']+)["']$/i))) {
      const current = requireStep(step, file, lineNumber);
      current.capture = { ...(current.capture ?? {}), [match[2]!]: pathOf(match[1]!) };
      continue;
    }
    if ((match = line.match(/^Wait up to\s+(\d+)\s*(ms|seconds?)$/i))) {
      const current = requireStep(step, file, lineNumber);
      const timeoutMs = match[2]!.toLowerCase().startsWith("s") ? Number(match[1]) * 1000 : Number(match[1]);
      if ("native" in current) current.native.timeoutMs = timeoutMs; else current.timeoutMs = timeoutMs;
      continue;
    }

    fail(file, lineNumber, `I don't understand “${line}”. Try Call tool, Read resource, Send, Expect, or Save.`);
  }

  if (!target) throw new Error(`QA-LANG-001 ${file}: Add 'Server: command arguments' or 'MCP URL: https://…'.`);
  if (!tests.length) throw new Error(`QA-LANG-001 ${file}: Add at least one 'Test: …'.`);
  for (const item of tests) if (!item.steps.length) throw new Error(`QA-LANG-001 ${file}: Test “${item.name}” has no actions.`);
  if (Object.keys(targets).length === 1) throw new Error(`QA-LANG-001 ${file}: Parity needs at least two 'Compare target' lines.`);
  if (Object.keys(servers).length === 1) throw new Error(`QA-LANG-001 ${file}: A composition needs at least two 'Named server' lines.`);
  for (const item of tests) if (item.server && !servers[item.server]) throw new Error(`QA-LANG-001 ${file}: Test “${item.name}” selects unknown server “${item.server}”. Known servers: ${Object.keys(servers).join(", ")}.`);
  return { version: 1, name, target, ...(Object.keys(targets).length ? { targets } : {}), ...(Object.keys(servers).length ? { servers } : {}), ...(defaults ? { defaults } : {}), ...(budgets.length ? { budgets } : {}), ...(redact ? { redact } : {}), ...(snapshots ? { snapshots } : {}), ...(client ? { client } : {}), tests };
}

function humanAssertion(path: string, verb: string, rest: string, file: string, line: number): JsonAssertion {
  const assertion: JsonAssertion = { path: pathOf(path) };
  const normalized = verb.toLowerCase();
  if (normalized === "exists") return { ...assertion, exists: true };
  if (normalized === "has") {
    const match = rest.match(/^(\d+)\s+(?:items?|results?|entries?)$/i);
    if (!match) fail(file, line, "Use: Expect \"tools\" has 3 items");
    return { ...assertion, length: Number(match[1]) };
  }
  if (!rest.trim()) fail(file, line, `Add a value after '${verb}'.`);
  const value = parseValue(rest.trim());
  return normalized === "contains" ? { ...assertion, contains: value } : { ...assertion, equals: value };
}

function addAssertion(step: ActionStep, assertion: JsonAssertion): void {
  const existing = step.assert?.json;
  const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  step.assert = { ...(step.assert ?? {}), json: [...list, assertion] };
}
function requireStep(step: ActionStep | undefined, file: string, line: number): ActionStep {
  if (!step) fail(file, line, "Add an action before checking its result, for example: Call tool \"add\".");
  return step;
}
function pathOf(path: string): string {
  const normalized = path.replace(/^(result|error)(?=\.|\[|$)/, "").replace(/^\./, "");
  if (!normalized || normalized === "$") return "$";
  return normalized.startsWith("$.") ? normalized : normalized.startsWith("[") ? `$${normalized}` : `$.${normalized}`;
}
function parseValue(value: string): unknown {
  try { return YAML.parse(value); } catch { return unquote(value); }
}
function unquote(value: string): string {
  const text = value.trim();
  return (text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")) ? text.slice(1, -1) : text;
}
function tokenFromOption(value: Record<string, unknown>): { tokenFrom?: string } {
  const raw = value["Token from"] ?? value["token from"];
  return typeof raw === "string" && raw.trim() ? { tokenFrom: raw.trim() } : {};
}
function oauthOption(value: Record<string, unknown>, file: string): { oauth?: import("./types.js").OAuthConfig | true } {
  const raw = value["OAuth"] ?? value["oauth"] ?? value["Auth"] ?? value["auth"];
  if (raw === undefined) return {};
  if (raw === true || (typeof raw === "string" && raw.trim().toLowerCase() === "oauth")) return { oauth: true };
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    const config: import("./types.js").OAuthConfig = {};
    const clientId = record.clientId ?? record["client id"]; if (typeof clientId === "string" && clientId.trim()) config.clientId = clientId.trim();
    const clientSecret = record.clientSecret ?? record["client secret"]; if (typeof clientSecret === "string" && clientSecret.trim()) config.clientSecret = clientSecret.trim();
    const scope = record.scope ?? record.scopes; if (typeof scope === "string" && scope.trim()) config.scope = scope.trim();
    else if (Array.isArray(scope)) config.scope = scope.filter((s) => typeof s === "string").join(" ");
    return { oauth: config };
  }
  fail(file, 0, `Invalid OAuth option. Write “OAuth: oauth” or an OAuth block with clientId/scope.`);
}
function httpOptions(value: Record<string, unknown>, file: string): Record<string, unknown> {
  return { headers: value.headers, ...tokenFromOption(value), ...oauthOption(value, file) };
}

function readIndentedMap(lines: string[], start: number, file: string): { value: Record<string, unknown>; lastLine: number } {
  const parentIndent = lines[start]!.match(/^\s*/)?.[0].length ?? 0;
  const block: string[] = [];
  let lastLine = start;
  for (let index = start + 1; index < lines.length; index++) {
    const raw = lines[index]!;
    if (!raw.trim()) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= parentIndent) break;
    block.push(raw.slice(parentIndent + 2));
    lastLine = index;
  }
  if (!block.length) fail(file, start + 1, "Add indented name/value lines after 'with:'.");
  const value = YAML.parse(block.join("\n"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(file, start + 1, "The 'with:' block must contain name: value pairs.");
  return { value, lastLine };
}
function splitCommand(input: string, file: string, line: number): string[] {
  const words = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if ((input.match(/["']/g)?.length ?? 0) % 2) fail(file, line, "A quote in the server command is not closed.");
  return words.map(unquote);
}
function fail(file: string, line: number, message: string): never {
  throw new Error(`QA-LANG-001 ${file}:${line} ${message}`);
}
