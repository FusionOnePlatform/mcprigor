import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fingerprint } from "./canonical.js";
import YAML from "yaml";
import { callIsolatedProvider } from "./extension-host.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface DataRow { id: string; values: Record<string, unknown>; index: number; source: string }
export interface DataSet { rows: DataRow[]; fingerprint: string; source: string }
export interface DataContext { cwd: string; maxRows: number; allowRemote: boolean; allowCustomCode: boolean; headers?: Record<string, string> }
export interface DataProvider { load(config: Record<string, unknown>, context: DataContext): Promise<Record<string, unknown>[]> }

const providerCache = new Map<string, Promise<Record<string, unknown>[]>>();
export function clearDataCache(): void { providerCache.clear(); }

export async function loadData(config: Record<string, unknown>, context: Partial<DataContext> = {}): Promise<DataSet> {
  const full: DataContext = { cwd: context.cwd ?? process.cwd(), maxRows: context.maxRows ?? 1000, allowRemote: context.allowRemote ?? false, allowCustomCode: context.allowCustomCode ?? false, headers: context.headers };
  const providerName = String(config.provider ?? inferProvider(String(config.file ?? config.url ?? "")));
  const provider = await getProvider(providerName, config, full);
  const loaderKey = JSON.stringify({ providerName, cwd: full.cwd, config: { ...config, cache: undefined, where: undefined, columns: undefined, derive: undefined, sample: undefined, join: undefined } });
  const load = () => provider.load(config, full);
  let values = structuredClone(await (config.cache === true ? providerCache.get(loaderKey) ?? providerCache.set(loaderKey, load()).get(loaderKey)! : load()));
  values = await transformRows(values, config, full);
  if (values.length > full.maxRows) throw new Error(`MCP-DATA-002 Data source has ${values.length} rows; the limit is ${full.maxRows}`);
  const source = String(config.file ?? config.url ?? providerName);
  const rows = values.map((value, index) => ({ id: String(value.caseId ?? value.id ?? index + 1), values: value, index: index + 1, source }));
  return { rows, fingerprint: fingerprint(values), source };
}

type ColumnType = "string" | "number" | "boolean" | "date" | "json";
async function transformRows(values: Record<string, unknown>[], config: Record<string, unknown>, context: DataContext): Promise<Record<string, unknown>[]> {
  let rows = values;
  if (config.columns) rows = rows.map((row, index) => coerceRow(row, config.columns as Record<string, unknown>, index));
  if (config.join) rows = await joinRows(rows, config.join as Record<string, unknown>, context);
  if (config.derive) rows = rows.map((row) => deriveRow(row, config.derive as Record<string, string>));
  if (config.where) rows = rows.filter((row) => matchesWhere(row, config.where as Record<string, unknown>));
  if (config.sample !== undefined) rows = sampleRows(rows, config.sample);
  return rows;
}

function coerceRow(row: Record<string, unknown>, columns: Record<string, unknown>, index: number): Record<string, unknown> {
  const result = { ...row };
  for (const [column, spec] of Object.entries(columns)) {
    const definition = typeof spec === "string" ? { type: spec } : spec as { type?: string; required?: boolean; enum?: unknown[] };
    const raw = result[column];
    if (raw === undefined || raw === null || raw === "") { if (definition.required) throw new Error(`MCP-DATA-020 Row ${index + 1}: required column “${column}” is missing`); continue; }
    result[column] = coerceValue(raw, (definition.type ?? "string") as ColumnType, column, index);
    if (definition.enum && !definition.enum.some((option) => option === result[column])) throw new Error(`MCP-DATA-022 Row ${index + 1}: column “${column}” value ${JSON.stringify(result[column])} is not one of ${JSON.stringify(definition.enum)}`);
  }
  return result;
}
function coerceValue(value: unknown, type: ColumnType, column: string, index: number): unknown {
  try {
    if (type === "string") return typeof value === "object" ? JSON.stringify(value) : String(value);
    if (type === "number") { const parsed = typeof value === "number" ? value : Number(String(value).trim()); if (!Number.isFinite(parsed)) throw new Error("not a finite number"); return parsed; }
    if (type === "boolean") { if (typeof value === "boolean") return value; const text = String(value).trim().toLowerCase(); if (["true", "yes", "1"].includes(text)) return true; if (["false", "no", "0"].includes(text)) return false; throw new Error("not a boolean"); }
    if (type === "date") { const date = value instanceof Date ? value : new Date(String(value)); if (Number.isNaN(date.getTime())) throw new Error("not a date"); return date.toISOString(); }
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) { throw new Error(`MCP-DATA-021 Row ${index + 1}: column “${column}” cannot be read as ${type}: ${error instanceof Error ? error.message : String(error)}`); }
}
function deriveRow(row: Record<string, unknown>, derive: Record<string, string>): Record<string, unknown> {
  const result = { ...row };
  for (const [column, template] of Object.entries(derive)) result[column] = template.replace(/\$\{([a-zA-Z0-9_.-]+)\}/g, (_, name: string) => { const value = result[name]; return value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value); });
  return result;
}
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([column, condition]) => {
    const value = row[column];
    if (condition === null || typeof condition !== "object" || Array.isArray(condition)) return Array.isArray(condition) ? condition.some((option) => option === value) : value === condition;
    const rules = condition as { equals?: unknown; notEquals?: unknown; in?: unknown[]; matches?: string; greaterThan?: number; lessThan?: number };
    if ("equals" in rules && value !== rules.equals) return false;
    if ("notEquals" in rules && value === rules.notEquals) return false;
    if (rules.in && !rules.in.some((option) => option === value)) return false;
    if (rules.matches !== undefined && !(typeof value === "string" && new RegExp(rules.matches).test(value))) return false;
    if (rules.greaterThan !== undefined && !(typeof value === "number" && value > rules.greaterThan)) return false;
    if (rules.lessThan !== undefined && !(typeof value === "number" && value < rules.lessThan)) return false;
    return true;
  });
}
function sampleRows(rows: Record<string, unknown>[], sample: unknown): Record<string, unknown>[] {
  if (typeof sample === "number") return rows.slice(0, sample);
  const spec = sample as { first?: number; last?: number; every?: number; seed?: number; count?: number };
  if (spec.first !== undefined) return rows.slice(0, spec.first);
  if (spec.last !== undefined) return rows.slice(-spec.last);
  if (spec.every !== undefined) return rows.filter((_, index) => index % Number(spec.every) === 0);
  if (spec.count !== undefined) { let state = (spec.seed ?? 42) >>> 0; const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; }; const copy = [...rows]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j]!, copy[i]!]; } return copy.slice(0, spec.count).sort((a, b) => rows.indexOf(a) - rows.indexOf(b)); }
  throw new Error("MCP-DATA-023 sample must be a number or use first, last, every, or count with an optional seed");
}
async function joinRows(rows: Record<string, unknown>[], join: Record<string, unknown>, context: DataContext): Promise<Record<string, unknown>[]> {
  const on = String(join.on ?? ""); if (!on) throw new Error("MCP-DATA-024 join requires an “on” column");
  const kind = String(join.kind ?? "inner"); if (!["inner", "left"].includes(kind)) throw new Error("MCP-DATA-025 join kind must be inner or left");
  const other = await loadData(join as Record<string, unknown>, context);
  const index = new Map(other.rows.map((row) => [String(row.values[on]), row.values]));
  const prefix = join.prefix ? String(join.prefix) : "";
  const joined: Record<string, unknown>[] = [];
  for (const row of rows) {
    const match = index.get(String(row[on]));
    if (!match) { if (kind === "left") joined.push(row); continue; }
    const extra = Object.fromEntries(Object.entries(match).filter(([key]) => key !== on).map(([key, value]) => [prefix ? `${prefix}${key}` : key, value]));
    joined.push({ ...extra, ...row });
  }
  return joined;
}

async function getProvider(name: string, config: Record<string, unknown>, context: DataContext): Promise<DataProvider> {
  if (name === "inline") return { load: async ({ rows }) => ensureRows(rows) };
  if (["csv", "json", "yaml"].includes(name)) return { load: async ({ file, path }) => loadFile(resolve(context.cwd, String(file)), name, path) };
  if (name === "excel") return { load: async ({ file, sheet }) => loadExcel(resolve(context.cwd, String(file)), sheet) };
  if (name === "rest") return { load: async ({ url, path, headers }) => loadRest(String(url), path, { ...context.headers, ...(headers as Record<string, string> | undefined) }, context) };
  if (name === "google-sheets") return { load: async (input) => loadGoogleSheets(input, context) };
  if (name === "sql") {
    if (!context.allowCustomCode) throw new Error("MCP-DATA-003 SQL providers require --allow-custom-code");
    if (!config.module) throw new Error("MCP-DATA-012 SQL sources require a reviewed provider module");
    return getProvider("plugin", { ...config, provider: "plugin" }, context);
  }
  if (name === "plugin") {
    if (!context.allowCustomCode) throw new Error("MCP-DATA-003 Custom data providers require --allow-custom-code");
    const modulePath = resolve(context.cwd, String(config.module));
    if (config.unsafeLegacy === true) {
      const imported = await import(pathToFileURL(modulePath).href) as { default?: DataProvider; provider?: DataProvider };
      const provider = imported.default ?? imported.provider;
      if (!provider?.load) throw new Error(`MCP-DATA-004 ${modulePath} does not export a data provider`);
      return provider;
    }
    return { load: async (providerConfig, providerContext) => callIsolatedProvider(modulePath, providerConfig, { cwd: providerContext.cwd, maxRows: providerContext.maxRows }, { timeoutMs: Number(config.timeoutMs ?? 5000), permissions: Array.isArray(config.permissions) ? config.permissions as any : [] }) };
  }
  throw new Error(`MCP-DATA-001 Unknown data provider “${name}”`);
}

async function loadFile(file: string, kind: string, path: unknown): Promise<Record<string, unknown>[]> {
  const source = await readFile(file, "utf8");
  if (Buffer.byteLength(source) > 10 * 1024 * 1024) throw new Error("MCP-DATA-005 Data file exceeds 10 MiB");
  let value: unknown;
  if (kind === "csv") value = parseCsv(source);
  else if (kind === "json") value = JSON.parse(source);
  else { const document = YAML.parseDocument(source, { uniqueKeys: true, schema: "core" }); if (document.errors.length) throw document.errors[0]; value = document.toJS({ maxAliasCount: 20 }); assertDataDepth(value); }
  if (path) for (const part of String(path).split(".")) value = (value as Record<string, unknown>)?.[part];
  return ensureRows(value);
}

function parseCsv(source: string): Record<string, unknown>[] {
  const records = csvRecords(source);
  const headers = records.shift() ?? [];
  if (new Set(headers).size !== headers.length) throw new Error("MCP-DATA-006 CSV has duplicate column names");
  return records.filter((row) => row.some((item) => item !== "")).map((row) => Object.fromEntries(headers.map((header, index) => [header, scalar(row[index] ?? "")])));
}
function csvRecords(source: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  const pushField = () => { if (field.length > 1024 * 1024) throw new Error("MCP-DATA-026 CSV field exceeds 1 MiB"); row.push(field); field = ""; if (row.length > 1000) throw new Error("MCP-DATA-027 CSV row exceeds 1000 columns"); };
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted && char === '"' && source[i + 1] === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { pushField(); }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && source[i + 1] === "\n") i++; pushField(); rows.push(row); if (rows.length > 1_000_000) throw new Error("MCP-DATA-028 CSV exceeds one million rows"); row = []; }
    else field += char;
  }
  if (field || row.length) { pushField(); rows.push(row); }
  if (quoted) throw new Error("MCP-DATA-007 CSV contains an unclosed quoted value");
  return rows;
}
function scalar(value: string): unknown {
  const text = value.trim();
  if (text === "") return "";
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return Number(text);
  return value;
}
async function loadExcel(file: string, sheet: unknown): Promise<Record<string, unknown>[]> {
  const info = await stat(file); if (info.size > 25 * 1024 * 1024) throw new Error("MCP-DATA-018 Spreadsheet exceeds the 25 MiB compressed limit");
  const archive = await readFile(file);
  if (archive[0] !== 0x50 || archive[1] !== 0x4b) throw new Error("MCP-DATA-019 Spreadsheet is not a valid XLSX ZIP container");
  const { readXlsxSheet } = await import("./xlsx.js");
  const { rows } = readXlsxSheet(archive, sheet === undefined || sheet === null ? undefined : String(sheet));
  const [headerRow, ...body] = rows;
  if (!headerRow?.length) return [];
  const headers = headerRow.map((cell) => String(cell ?? ""));
  return body
    .filter((row) => row.some((cell) => cell !== "" && cell !== undefined && cell !== null))
    .map((row) => Object.fromEntries(headers.map((header, index) => {
      const value = row[index];
      return [header, value === null || value === undefined ? "" : value];
    })));
}
async function loadRest(url: string, path: unknown, headers: Record<string, string> | undefined, context: DataContext): Promise<Record<string, unknown>[]> {
  if (!context.allowRemote) throw new Error("MCP-DATA-009 Remote data requires --allow-remote-data");
  let current = new URL(url); let redirects = 0;
  while (true) {
    await assertPublicUrl(current);
    const response = await fetch(current, { headers, signal: AbortSignal.timeout(10000), redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get("location"); if (!location || ++redirects > 3) throw new Error("MCP-DATA-014 Remote data exceeded 3 redirects"); current = new URL(location, current); continue; }
    if (!response.ok) throw new Error(`MCP-DATA-010 Data request returned HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0); if (declared > 10 * 1024 * 1024) throw new Error("MCP-DATA-015 Remote response exceeds 10 MiB");
    const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("MCP-DATA-015 Remote response exceeds 10 MiB");
    let value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (path) for (const part of String(path).split(".")) value = (value as Record<string, unknown>)?.[part];
    return ensureRows(value);
  }
}
async function loadGoogleSheets(config: Record<string, unknown>, context: DataContext): Promise<Record<string, unknown>[]> {
  const id = String(config.spreadsheetId); const range = encodeURIComponent(String(config.range ?? "Sheet1"));
  const key = config.apiKey ? String(config.apiKey) : undefined;
  const accessToken = config.accessToken ? String(config.accessToken) : undefined;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${range}${key ? `?key=${encodeURIComponent(key)}` : ""}`;
  const rows = await loadRest(url, "values", accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined, context) as unknown as unknown[][];
  const [headers = [], ...values] = rows;
  return values.map((row) => Object.fromEntries(headers.map((header, index) => [String(header), row[index]])));
}
function assertDataDepth(value: unknown, depth = 0, nodes = { count: 0 }): void { if (++nodes.count > 100_000) throw new Error("MCP-DATA-030 YAML exceeds 100,000 nodes"); if (depth > 50) throw new Error("MCP-DATA-029 YAML nesting exceeds 50 levels"); if (Array.isArray(value)) for (const item of value) assertDataDepth(item, depth + 1, nodes); else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`MCP-DATA-031 Unsafe YAML key “${key}”`); assertDataDepth(item, depth + 1, nodes); } }
function ensureRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) throw new Error("MCP-DATA-011 Data must be a list of rows with named columns");
  return value as Record<string, unknown>[];
}
async function assertPublicUrl(url: URL): Promise<void> { if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 8192) throw new Error("MCP-DATA-013 Remote URL must be credential-free HTTP(S) under 8 KiB"); const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []); if (!addresses.length && !isIP(url.hostname)) throw new Error("MCP-DATA-016 Remote host could not be resolved"); const values = addresses.length ? addresses.map((item) => item.address) : [url.hostname]; if (values.some(privateAddress)) throw new Error(`MCP-DATA-017 Remote data cannot access private or local network address ${url.hostname}`); }
function privateAddress(address: string): boolean { const value = address.toLowerCase().replace(/^::ffff:/, ""); if (value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true; const parts = value.split(".").map(Number); if (parts.length !== 4) return false; const [a,b] = parts; return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168 || a! >= 224; }
function inferProvider(source: string): string {
  const extension = extname(source).toLowerCase();
  return extension === ".csv" ? "csv" : extension === ".json" ? "json" : [".yaml", ".yml"].includes(extension) ? "yaml" : [".xlsx", ".xls"].includes(extension) ? "excel" : source.startsWith("http") ? "rest" : "inline";
}
