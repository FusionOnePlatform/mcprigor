import { dirname } from "node:path";
import YAML from "yaml";
import { loadData, type DataSet } from "./data.js";
import { compileQaLanguage } from "./qa-language.js";
import type { Suite, TestCase } from "./types.js";

export interface QaCompileOptions { allowRemoteData?: boolean; allowCustomCode?: boolean; maxRows?: number }
interface Block { header: string; lines: string[]; line: number }
interface Flow { name: string; inputs: string[]; defaults: Record<string, unknown>; outputs: Record<string, unknown>; body: string[] }

export async function compileAdvancedQaLanguage(source: string, file: string, options: QaCompileOptions = {}): Promise<Suite> {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const top: string[] = [];
  const blocks: Block[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (/^(Flow|Test|Scenario|Data source):/i.test(line.trim()) && !/^\s/.test(line)) {
      const block: Block = { header: line.trim(), lines: [], line: index + 1 };
      index++;
      while (index < lines.length && (!lines[index]!.trim() || /^\s/.test(lines[index]!))) block.lines.push(lines[index++]!);
      blocks.push(block);
    } else { top.push(line); index++; }
  }

  const flows = new Map<string, Flow>();
  const sources = new Map<string, Record<string, unknown>>();
  const testBlocks: Block[] = [];
  for (const block of blocks) {
    let match: RegExpMatchArray | null;
    if ((match = block.header.match(/^Flow:\s*["']([^"']+)["']$/i))) {
      const inputsLine = block.lines.find((line) => /^\s*Inputs:/i.test(line));
      const declarations = inputsLine ? inputsLine.replace(/^\s*Inputs:\s*/i, "").split(",").map((x) => x.trim()).filter(Boolean) : [];
      const inputs = declarations.map((item) => item.split("=", 1)[0]!.trim());
      const defaults = Object.fromEntries(declarations.filter((item) => item.includes("=")).map((item) => { const at = item.indexOf("="); return [item.slice(0, at).trim(), YAML.parse(item.slice(at + 1).trim())]; }));
      const outputsLine = block.lines.find((line) => /^\s*Outputs:/i.test(line));
      const outputs = outputsLine ? YAML.parse(outputsLine.replace(/^\s*Outputs:\s*/i, "")) ?? {} : {};
      flows.set(match[1]!, { name: match[1]!, inputs, defaults, outputs, body: block.lines.filter((line) => line !== inputsLine && line !== outputsLine) });
    } else if ((match = block.header.match(/^Data source:\s*["']([^"']+)["']$/i))) {
      sources.set(match[1]!, parseIndentedObject(block.lines, file, block.line));
    } else testBlocks.push(block);
  }
  detectFlowCycles(flows);

  const header = top.filter((line) => !/^\s*(Functions|Custom functions):/i.test(line) && !/^\s*MCP Test 1\s*$/i.test(line)).join("\n");
  const modules = top.flatMap((line) => {
    const match = line.trim().match(/^(?:Functions|Custom functions):\s*(.+)$/i);
    return match ? match[1]!.split(",").map((x) => x.trim()) : [];
  });
  const tests: TestCase[] = [];
  for (const block of testBlocks) {
    const expanded = expandFlowCalls(block.lines, flows, [], file);
    const data = await dataFor(expanded.lines, sources, file, options);
    const cleanLines = data ? expanded.lines.filter((_, index) => !data.remove.has(index)) : expanded.lines;
    const rows = data?.set.rows ?? [{ id: "", values: {}, index: 0, source: "" }];
    for (const row of rows) {
      const testText = `${header}\n${block.header}\n${cleanLines.join("\n")}`;
      const compiled = compileQaLanguage(testText, file);
      const test = compiled.tests[0]!;
      test.logicalName = test.name;
      test.id ??= slug(test.name);
      test.variables = { ...expanded.variables, ...(data ? { row: row.values } : {}) };
      if (data) {
        test.name += ` [${row.id}]`;
        test.id = `${test.id}.${row.id}`;
        test.data = { source: data.set.source, row: row.index, id: row.id, fingerprint: data.set.fingerprint };
      }
      tests.push(test);
    }
  }
  if (!tests.length) throw new Error(`QA-LANG-001 ${file}: Add at least one Test block.`);
  const base = compileQaLanguage(`${header}\nTest: "configuration"\n  Send "ping"`, file);
  return { ...base, extensions: modules.length ? { functions: modules } : undefined, tests };
}

function expandFlowCalls(lines: string[], flows: Map<string, Flow>, stack: string[], file: string): { lines: string[]; variables: Record<string, unknown> } {
  const output: string[] = []; const variables: Record<string, unknown> = {}; let call = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!; const match = line.trim().match(/^Use flow\s+["']([^"']+)["'](?:\s+with:)?$/i);
    if (!match) { output.push(line); continue; }
    const flow = flows.get(match[1]!);
    if (!flow) throw new Error(`QA-FLOW-001 ${file}: Unknown flow “${match[1]}”`);
    if (stack.includes(flow.name)) throw new Error(`QA-FLOW-002 Recursive flow: ${[...stack, flow.name].join(" → ")}`);
    const argsBlock = line.trim().toLowerCase().endsWith("with:") ? readMap(lines, index) : undefined;
    if (argsBlock) index = argsBlock.last;
    const args = { ...flow.defaults, ...(argsBlock?.value ?? {}) };
    for (const supplied of Object.keys(args)) if (!flow.inputs.includes(supplied)) throw new Error(`MCPLANG411 Flow “${flow.name}” does not declare input “${supplied}”`);
    for (const input of flow.inputs) if (!(input in args)) throw new Error(`MCPLANG410 Flow “${flow.name}” needs input “${input}”`);
    const prefix = `flow${call++}`;
    for (const [key, value] of Object.entries(args)) variables[`${prefix}.${key}`] = value;
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const body = flow.body.map((bodyLine) => {
      const normalized = bodyLine.replace(/^  /, "");
      return indent + normalized.replace(/\$\{([^}]+)\}/g, (_, key: string) => `\${${prefix}.${key}}`);
    });
    const nested = expandFlowCalls(body, flows, [...stack, flow.name], file);
    output.push(...nested.lines); Object.assign(variables, nested.variables);
  }
  return { lines: output, variables };
}

async function dataFor(lines: string[], sources: Map<string, Record<string, unknown>>, file: string, options: QaCompileOptions): Promise<{ set: DataSet; remove: Set<number> } | undefined> {
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!.trim(); let config: Record<string, unknown> | undefined; const remove = new Set<number>([index]);
    let match = text.match(/^For each row in\s+["']([^"']+)["'](?:\s+from sheet\s+["']([^"']+)["'])?$/i);
    if (match) config = { file: match[1], ...(match[2] ? { provider: "excel", sheet: match[2] } : {}) };
    match = text.match(/^For each row from\s+["']([^"']+)["']$/i);
    if (match) { config = sources.get(match[1]!); if (!config) throw new Error(`QA-DATA-001 ${file}: Unknown data source “${match[1]}”`); }
    if (/^For each row:$/i.test(text)) {
      const table: string[] = []; let cursor = index + 1;
      while (cursor < lines.length && /^\s*\|/.test(lines[cursor]!)) { table.push(lines[cursor]!.trim()); remove.add(cursor++); }
      config = { provider: "inline", rows: parseTable(table, file) };
    }
    if (config) return { set: await loadData(interpolateEnv(config), { cwd: dirname(file), maxRows: options.maxRows, allowRemote: options.allowRemoteData, allowCustomCode: options.allowCustomCode }), remove };
  }
  return undefined;
}

function parseTable(lines: string[], file: string): Record<string, unknown>[] {
  if (lines.length < 2) throw new Error(`QA-DATA-002 ${file}: An inline table needs a header and at least one row`);
  const cells = (line: string) => line.slice(1, -1).split("|").map((x) => x.trim());
  const headers = cells(lines[0]!);
  return lines.slice(1).map((line) => Object.fromEntries(cells(line).map((value, index) => [headers[index]!, YAML.parse(value)])));
}
function parseIndentedObject(lines: string[], file: string, line: number): Record<string, unknown> {
  const phrases = lines.map((item) => item.trim()).filter(Boolean);
  if (phrases.some((item) => /^(From|Column|Derive|Keep rows|Sample|Cache|Join)\b/i.test(item))) return parseDataPhrases(phrases, file, line);
  const value = YAML.parse(lines.map((x) => x.replace(/^  /, "")).join("\n"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`QA-DATA-003 ${file}:${line} Data source needs indented name/value settings`);
  return value;
}
function parseDataPhrases(lines: string[], file: string, line: number): Record<string, unknown> {
  const config: Record<string, any> = {};
  for (const text of lines) {
    let match: RegExpMatchArray | null;
    if ((match = text.match(/^From\s+(CSV|JSON|YAML|Excel)\s+["']([^"']+)["'](?:\s+sheet\s+["']([^"']+)["'])?$/i))) { config.provider = match[1]!.toLowerCase(); config.file = match[2]!; if (match[3]) config.sheet = match[3]; continue; }
    if ((match = text.match(/^From REST\s+["']([^"']+)["'](?:\s+at\s+["']([^"']+)["'])?$/i))) { config.provider = "rest"; config.url = match[1]!; if (match[2]) config.path = match[2]; continue; }
    if ((match = text.match(/^Column\s+["']([^"']+)["']\s+is\s+(string|number|boolean|date|json)(?:\s+(required))?(?:\s+one of\s+(.+))?$/i))) { config.columns ??= {}; config.columns[match[1]!] = { type: match[2]!.toLowerCase(), ...(match[3] ? { required: true } : {}), ...(match[4] ? { enum: match[4].split(",").map((item) => YAML.parse(item.trim())) } : {}) }; continue; }
    if ((match = text.match(/^Derive\s+["']([^"']+)["']\s+as\s+(.+)$/i))) { config.derive ??= {}; config.derive[match[1]!] = unquotePhrase(match[2]!); continue; }
    if ((match = text.match(/^Keep rows where\s+["']([^"']+)["']\s+(equals|does not equal|is one of|matches|is greater than|is less than)\s+(.+)$/i))) { config.where ??= {}; const value = match[3]!.split(",").map((item) => YAML.parse(item.trim())); const op: Record<string,string> = { equals: "equals", "does not equal": "notEquals", "is one of": "in", matches: "matches", "is greater than": "greaterThan", "is less than": "lessThan" }; config.where[match[1]!] = match[2]!.toLowerCase() === "equals" ? value[0] : { [op[match[2]!.toLowerCase()]!]: match[2]!.toLowerCase() === "is one of" ? value : value[0] }; continue; }
    if ((match = text.match(/^Sample\s+(first|last|every)\s+(\d+)\s+rows?$/i))) { config.sample = { [match[1]!.toLowerCase()]: Number(match[2]) }; continue; }
    if ((match = text.match(/^Sample\s+(\d+)\s+rows?\s+with seed\s+(\d+)$/i))) { config.sample = { count: Number(match[1]), seed: Number(match[2]) }; continue; }
    if (/^Cache(?: this)? source$/i.test(text)) { config.cache = true; continue; }
    throw new Error(`QA-DATA-004 ${file}:${line} I don't understand data setting “${text}”`);
  }
  return config;
}
function unquotePhrase(value: string): string { const text = value.trim(); return ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) ? text.slice(1, -1) : text; }
function readMap(lines: string[], start: number): { value: Record<string, unknown>; last: number } {
  const parent = lines[start]!.match(/^\s*/)?.[0].length ?? 0; const body: string[] = []; let last = start;
  for (let index = start + 1; index < lines.length; index++) { const indent = lines[index]!.match(/^\s*/)?.[0].length ?? 0; if (lines[index]!.trim() && indent <= parent) break; if (lines[index]!.trim()) { body.push(lines[index]!.slice(parent + 2)); last = index; } }
  return { value: YAML.parse(body.join("\n")) ?? {}, last };
}
function detectFlowCycles(flows: Map<string, Flow>): void {
  const visit = (name: string, stack: string[]) => { if (stack.includes(name)) throw new Error(`QA-FLOW-002 Recursive flow: ${[...stack, name].join(" → ")}`); const flow = flows.get(name); if (!flow) return; for (const line of flow.body) { const match = line.trim().match(/^Use flow\s+["']([^"']+)/i); if (match) visit(match[1]!, [...stack, name]); } };
  for (const name of flows.keys()) visit(name, []);
}
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "test"; }
function interpolateEnv(value: Record<string, unknown>): Record<string, unknown> { return JSON.parse(JSON.stringify(value).replace(/\$\{env\.([^}]+)\}/g, (_, name) => process.env[name] ?? "")); }
