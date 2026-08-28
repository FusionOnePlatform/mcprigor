import { rename, writeFile } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { discoverTarget } from "./discovery.js";
import { readPath } from "./path.js";
import { createSession } from "./session.js";
import type { DiscoveryDocument, Target } from "./types.js";

export interface Choice<T> { label: string; value: T; description?: string }
export interface PromptAdapter {
  select<T>(id: string, message: string, choices: Choice<T>[]): Promise<T>;
  multiselect<T>(id: string, message: string, choices: Choice<T>[]): Promise<T[]>;
  input(id: string, message: string, initial?: string): Promise<string>;
  confirm(id: string, message: string, initial?: boolean): Promise<boolean>;
  note(message: string): Promise<void>;
  close(): Promise<void>;
}
export interface AuthoredOperation { kind: "tool" | "resource" | "prompt"; name: string; input?: Record<string, unknown>; response: unknown }
export interface AuthoredAssertion { path: string; kind: "equals" | "contains" | "exists"; expected?: unknown }
export interface AuthoredTest { suiteName: string; testName: string; target: Target; operation: AuthoredOperation; assertions: AuthoredAssertion[] }

export async function authorTest(target: Target, prompts: PromptAdapter, output: string): Promise<AuthoredTest> {
  const discovery = await discoverTarget(target);
  const kind = await prompts.select("operation.kind", "What would you like to test?", availableKinds(discovery));
  const selected = await chooseOperation(kind, discovery, prompts);
  const input = await collectInputs(kind, selected, prompts);
  await prompts.note(`Request preview:\n${selectedName(selected)} ${JSON.stringify(input, null, 2)}`);
  if (!await prompts.confirm("request.run", "Run this request now?", true)) throw new Error("MCP-AUTHOR-001 Authoring cancelled before preview run");
  const session = createSession(target);
  let response: unknown;
  try {
    await session.connect();
    response = kind === "tool" ? await session.request("tools/call", { name: selectedName(selected), arguments: input })
      : kind === "resource" ? await session.request("resources/read", { uri: selectedName(selected) })
      : await session.request("prompts/get", { name: selectedName(selected), arguments: input });
  } finally { await session.close(); }
  const fields = flattenResponse(response);
  const chosen = await prompts.multiselect("assertions.fields", "Which returned fields should be checked?", fields.map((field) => ({ label: `${field.path} = ${field.preview}`, value: field })));
  const assertions: AuthoredAssertion[] = [];
  for (const field of chosen) {
    const kindOfAssertion = await prompts.select(`assertion.${field.path}`, `How should ${field.path} be checked?`, assertionChoices(field.value));
    assertions.push({ path: field.path, kind: kindOfAssertion, ...(kindOfAssertion === "exists" ? {} : { expected: field.value }) });
  }
  const testName = await prompts.input("test.name", "Name this test", `${kind === "tool" ? "Tool" : kind === "resource" ? "Resource" : "Prompt"} ${selectedName(selected)} works`);
  const authored: AuthoredTest = { suiteName: "Generated MCP acceptance test", testName, target, operation: { kind, name: selectedName(selected), input, response }, assertions };
  const source = renderAuthoredTest(authored);
  await prompts.note(`Generated test:\n\n${source}`);
  if (!await prompts.confirm("file.write", `Write ${output}?`, true)) throw new Error("MCP-AUTHOR-002 Authoring cancelled before writing");
  await atomicWrite(output, source);
  return authored;
}

export function renderAuthoredTest(test: AuthoredTest): string {
  const lines = [`MCP Test 1`, `Suite: ${JSON.stringify(test.suiteName)}`];
  if (test.target.transport === "stdio") lines.push(`Server: ${[test.target.command, ...(test.target.args ?? [])].map(quoteCommand).join(" ")}`);
  else lines.push(`MCP URL: ${test.target.url}`);
  lines.push("", `Test: ${JSON.stringify(test.testName)}`);
  if (test.operation.kind === "tool") lines.push(`  Require: tools`, `  Call tool ${JSON.stringify(test.operation.name)}${Object.keys(test.operation.input ?? {}).length ? " with:" : ""}`);
  else if (test.operation.kind === "resource") lines.push(`  Require: resources`, `  Read resource ${JSON.stringify(test.operation.name)}`);
  else lines.push(`  Require: prompts`, `  Get prompt ${JSON.stringify(test.operation.name)}${Object.keys(test.operation.input ?? {}).length ? " with:" : ""}`);
  if (Object.keys(test.operation.input ?? {}).length) for (const [key, value] of Object.entries(sortObject(test.operation.input!))) lines.push(`    ${key}: ${JSON.stringify(value)}`);
  lines.push("", "  Expect it succeeds");
  for (const assertion of [...test.assertions].sort((a, b) => a.path.localeCompare(b.path))) {
    const path = assertion.path.replace(/^\$\.?/, "");
    lines.push(assertion.kind === "exists" ? `  Expect ${JSON.stringify(path)} exists` : `  Expect ${JSON.stringify(path)} ${assertion.kind} ${JSON.stringify(assertion.expected)}`);
  }
  return `${lines.join("\n")}\n`;
}

export interface FlatField { path: string; value: unknown; preview: string }
export function flattenResponse(value: unknown, path = "$", depth = 0): FlatField[] {
  if (depth > 8) return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => flattenResponse(item, `${path}[${index}]`, depth + 1));
  if (typeof value === "object" && value !== null) return Object.keys(value).sort().flatMap((key) => flattenResponse((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1));
  return [{ path, value, preview: JSON.stringify(value)?.slice(0, 100) ?? String(value) }];
}

export class ScriptedPromptAdapter implements PromptAdapter {
  readonly transcript: Array<{ id: string; answer: unknown }> = [];
  constructor(private readonly answers: Record<string, unknown>) {}
  async select<T>(id: string, _message: string, choices: Choice<T>[]): Promise<T> { const answer = this.answer(id); const found = choices.find((choice) => choice.value === answer || choice.label === answer); if (!found) throw new Error(`No scripted choice for ${id}: ${String(answer)}`); return found.value; }
  async multiselect<T>(id: string, _message: string, choices: Choice<T>[]): Promise<T[]> { const answers = this.answer(id) as unknown[]; return choices.filter((choice) => answers.includes(choice.value) || answers.includes(choice.label)).map((choice) => choice.value); }
  async input(id: string, _message: string, initial?: string): Promise<string> { return String(this.answer(id, initial)); }
  async confirm(id: string, _message: string, initial = false): Promise<boolean> { return Boolean(this.answer(id, initial)); }
  async note(_message: string): Promise<void> {}
  async close(): Promise<void> {}
  private answer(id: string, fallback?: unknown): unknown { const value = id in this.answers ? this.answers[id] : fallback; if (value === undefined) throw new Error(`Missing scripted answer: ${id}`); this.transcript.push({ id, answer: value }); return value; }
}

export function createReadlinePromptAdapter(): PromptAdapter {
  const rl = createInterface({ input: stdin, output: stdout });
  const inputPrompt = async (_id: string, message: string, initial?: string) => (await rl.question(`${message}${initial ? ` [${initial}]` : ""}: `)).trim() || initial || "";
  return {
    input: inputPrompt,
    async select(id, message, choices) { await noteChoices(message, choices); const answer = Number(await inputPrompt(id, "Choose a number")); if (!Number.isInteger(answer) || !choices[answer - 1]) throw new Error("Please run author again and choose a listed number."); return choices[answer - 1]!.value; },
    async multiselect(id, message, choices) { await noteChoices(message, choices); const answer = await inputPrompt(id, "Choose numbers separated by commas"); return answer.split(",").map(Number).filter((n) => choices[n - 1]).map((n) => choices[n - 1]!.value); },
    async confirm(id, message, initial = false) { const answer = (await inputPrompt(id, `${message} (y/n)`, initial ? "y" : "n")).toLowerCase(); return answer === "y" || answer === "yes"; },
    async note(message) { stdout.write(`${message}\n`); }, async close() { rl.close(); },
  };
  async function noteChoices(message: string, choices: Choice<unknown>[]) { stdout.write(`\n${message}\n${choices.map((choice, index) => `  ${index + 1}. ${choice.label}${choice.description ? ` — ${choice.description}` : ""}`).join("\n")}\n`); }
}

function availableKinds(lock: DiscoveryDocument): Choice<"tool" | "resource" | "prompt">[] { return [lock.tools.length ? { label: "Call a tool", value: "tool" as const } : undefined, lock.resources.length ? { label: "Read a resource", value: "resource" as const } : undefined, lock.prompts.length ? { label: "Get a prompt", value: "prompt" as const } : undefined].filter((x): x is Choice<"tool" | "resource" | "prompt"> => !!x); }
async function chooseOperation(kind: string, lock: DiscoveryDocument, prompts: PromptAdapter): Promise<Record<string, unknown>> { const list = kind === "tool" ? lock.tools : kind === "resource" ? lock.resources : lock.prompts; const choices = (list as Record<string, unknown>[]).map((item) => ({ label: String(item.name ?? item.uri), value: item, description: typeof item.description === "string" ? item.description : undefined })); return prompts.select(`${kind}.name`, `Choose a ${kind}`, choices); }
async function collectInputs(kind: string, item: Record<string, unknown>, prompts: PromptAdapter): Promise<Record<string, unknown>> { if (kind === "resource") return {}; const result: Record<string, unknown> = {}; const schema = kind === "tool" ? item.inputSchema as Record<string, unknown> | undefined : undefined; const properties = schema?.properties as Record<string, Record<string, unknown>> | undefined; const required = new Set(Array.isArray(schema?.required) ? schema.required as string[] : []); if (properties) for (const key of Object.keys(properties).sort()) { const field = properties[key]!; if (!required.has(key) && !await prompts.confirm(`input.${key}.set`, `Set optional ${key}?`, false)) continue; const raw = await prompts.input(`input.${key}`, `${key}${required.has(key) ? " (required)" : ""}${field.type ? `, ${String(field.type)}` : ""}`, field.default === undefined ? undefined : String(field.default)); result[key] = parseInput(raw, field.type); } else if (kind === "prompt") for (const argument of (item.arguments as Record<string, unknown>[] | undefined) ?? []) { const key = String(argument.name); if (!argument.required && !await prompts.confirm(`input.${key}.set`, `Set optional ${key}?`, false)) continue; result[key] = await prompts.input(`input.${key}`, `${key}${argument.required ? " (required)" : ""}`); } return sortObject(result); }
function parseInput(value: string, type: unknown): unknown { if (type === "integer" || type === "number") { const parsed = Number(value); if (!Number.isFinite(parsed) || type === "integer" && !Number.isInteger(parsed)) throw new Error(`Invalid ${String(type)}: ${value}`); return parsed; } if (type === "boolean") return value.toLowerCase() === "true"; if (type === "array" || type === "object") return JSON.parse(value); return value; }
function assertionChoices(value: unknown): Choice<AuthoredAssertion["kind"]>[] { return [{ label: "equals current value", value: "equals" }, ...(typeof value === "string" ? [{ label: "contains current text", value: "contains" as const }] : []), { label: "exists", value: "exists" }]; }
function selectedName(item: Record<string, unknown>): string { return String(item.name ?? item.uri); }
function sortObject(value: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))); }
function quoteCommand(value: string): string { return /\s/.test(value) ? JSON.stringify(value) : value; }
async function atomicWrite(file: string, source: string): Promise<void> { const absolute = resolve(file); const temporary = `${dirname(absolute)}/.${basename(absolute)}.${process.pid}.tmp`; await writeFile(temporary, source, "utf8"); await rename(temporary, absolute); }
