import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { callIsolatedFunction, inspectExtension } from "./extension-host.js";
import type { ExtensionPermission } from "./extension-sdk.js";

export type UtilityFunction = (args: Record<string, unknown>) => unknown | Promise<unknown>;

const builtins: Record<string, UtilityFunction> = {
  lowercase: ({ value }) => String(value).toLowerCase(),
  uppercase: ({ value }) => String(value).toUpperCase(),
  trim: ({ value }) => String(value).trim(),
  join: ({ values, separator = "" }) => (Array.isArray(values) ? values : []).join(String(separator)),
  replace: ({ value, find, replacement = "" }) => String(value).split(String(find)).join(String(replacement)),
  length: ({ value }) => typeof value === "string" || Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0,
  number: ({ value }) => { const result = Number(value); if (!Number.isFinite(result)) throw new Error(`cannot convert ${String(value)} to a number`); return result; },
  text: ({ value }) => typeof value === "string" ? value : JSON.stringify(value),
  json: ({ value }) => typeof value === "string" ? JSON.parse(value) : value,
  round: ({ value, digits = 0 }) => { const scale = 10 ** Number(digits); return Math.round(Number(value) * scale) / scale; },
  urlEncode: ({ value }) => encodeURIComponent(String(value)),
  base64: ({ value }) => Buffer.from(String(value)).toString("base64"),
  hash: ({ value, algorithm = "sha256" }) => createHash(String(algorithm)).update(String(value)).digest("hex"),
};

export interface FunctionRegistryOptions {
  modules?: string[];
  allowCustomCode?: boolean;
  timeoutMs?: number;
  cwd?: string;
  permissions?: ExtensionPermission[];
  unsafeLegacy?: boolean;
  allowlist?: string[];
}

export async function createFunctionRegistry(options: FunctionRegistryOptions = {}): Promise<Map<string, UtilityFunction>> {
  const functions = new Map(Object.entries(builtins));
  const modules = options.modules ?? [];
  if (modules.length && !options.allowCustomCode) throw new Error("MCP-EXT-001 Custom functions are configured but not enabled. Add --allow-custom-code after reviewing them.");
  for (const modulePath of modules) {
    if (options.allowlist && !options.allowlist.includes(modulePath)) throw new Error(`MCP-EXT-109 Extension “${modulePath}” is not in the reviewed allowlist`);
    if (options.unsafeLegacy) {
      const url = modulePath.startsWith("file:") ? modulePath : pathToFileURL(`${options.cwd ?? process.cwd()}/${modulePath}`.replace(/\/+/g, "/")).href;
      const imported = await import(url) as Record<string, unknown>;
      for (const [name, value] of Object.entries(imported)) if (typeof value === "function") functions.set(name, value as UtilityFunction);
      continue;
    }
    const descriptor = await inspectExtension(modulePath, { cwd: options.cwd, timeoutMs: options.timeoutMs, permissions: options.permissions });
    for (const name of descriptor.functions) functions.set(name, (args) => callIsolatedFunction(modulePath, name, args, { cwd: options.cwd, timeoutMs: options.timeoutMs, permissions: options.permissions }));
  }
  return functions;
}

export async function callUtility(registry: Map<string, UtilityFunction>, name: string, args: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
  const fn = registry.get(name);
  if (!fn) throw new Error(`MCP-EXT-002 Unknown utility function “${name}”`);
  return Promise.race([
    Promise.resolve(fn(args)),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`MCP-EXT-003 Function “${name}” exceeded ${timeoutMs}ms`)), timeoutMs)),
  ]).then((value) => {
    try { JSON.stringify(value); } catch { throw new Error(`MCP-EXT-004 Function “${name}” returned a value that cannot be saved as JSON`); }
    return value;
  });
}

export function builtinNames(): string[] { return Object.keys(builtins).sort(); }
