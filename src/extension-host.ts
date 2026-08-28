import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ExtensionManifest, ExtensionPermission } from "./extension-sdk.js";

export interface ExtensionDescriptor { modulePath: string; manifest?: ExtensionManifest; functions: string[]; provider: boolean }
export interface ExtensionHostOptions { cwd?: string; timeoutMs?: number; permissions?: ExtensionPermission[]; maxOldGenerationSizeMb?: number }

export async function inspectExtension(modulePath: string, options: ExtensionHostOptions = {}): Promise<ExtensionDescriptor> {
  const absolute = resolve(options.cwd ?? process.cwd(), modulePath);
  const value = await workerCall(absolute, { kind: "inspect" }, options) as Omit<ExtensionDescriptor, "modulePath">;
  if (value.manifest) validateManifest(value.manifest, options.permissions ?? []);
  return { modulePath: absolute, ...value };
}
export async function callIsolatedFunction(modulePath: string, name: string, args: Record<string, unknown>, options: ExtensionHostOptions = {}): Promise<unknown> {
  const descriptor = await inspectExtension(modulePath, options); if (!descriptor.functions.includes(name)) throw new Error(`MCP-EXT-102 Extension does not declare function “${name}”`);
  return workerCall(descriptor.modulePath, { kind: "function", name, args }, options);
}
export async function callIsolatedProvider(modulePath: string, config: Record<string, unknown>, context: { cwd: string; maxRows: number }, options: ExtensionHostOptions = {}): Promise<Record<string, unknown>[]> {
  const descriptor = await inspectExtension(modulePath, options); if (!descriptor.provider) throw new Error("MCP-EXT-103 Extension does not declare a data provider");
  const value = await workerCall(descriptor.modulePath, { kind: "provider", config, context }, options); if (!Array.isArray(value)) throw new Error("MCP-EXT-104 Provider result must be an array"); return value as Record<string, unknown>[];
}
function validateManifest(manifest: ExtensionManifest, granted: ExtensionPermission[]): void {
  if (manifest.schemaVersion !== 1 || !manifest.name || !manifest.version) throw new Error("MCP-EXT-100 Invalid extension manifest");
  const denied = (manifest.permissions ?? []).filter((permission) => !granted.includes(permission));
  if (denied.length) throw new Error(`MCP-EXT-101 Extension “${manifest.name}” requires permissions not granted: ${denied.join(", ")}`);
}
function workerEntry(): { url: URL; execArgv: string[] } {
  if (!import.meta.url.endsWith(".ts")) return { url: new URL("./extension-worker.js", import.meta.url), execArgv: [] };
  // Running from TypeScript sources (tests): prefer the built worker because
  // --import tsx does not reliably register loaders for worker threads on Node 20.
  const built = new URL("../dist/extension-worker.js", import.meta.url);
  if (existsSync(fileURLToPath(built))) return { url: built, execArgv: [] };
  return { url: new URL("./extension-worker.ts", import.meta.url), execArgv: ["--import", "tsx"] };
}
function workerCall(modulePath: string, payload: Record<string, unknown>, options: ExtensionHostOptions): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const entry = workerEntry();
    const worker = new Worker(entry.url, { execArgv: entry.execArgv, workerData: { modulePath, ...payload }, resourceLimits: { maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? 64 } });
    const timeout = setTimeout(() => { void worker.terminate(); reject(new Error(`MCP-EXT-105 Isolated extension exceeded ${options.timeoutMs ?? 5000}ms`)); }, options.timeoutMs ?? 5000);
    worker.once("message", (message: { ok: boolean; value?: unknown; error?: { message: string } }) => { clearTimeout(timeout); void worker.terminate(); if (message.ok) { try { JSON.stringify(message.value); resolvePromise(message.value); } catch { reject(new Error("MCP-EXT-106 Extension returned a non-JSON value")); } } else reject(new Error(`MCP-EXT-107 ${message.error?.message ?? "Extension failed"}`)); });
    worker.once("error", (error) => { clearTimeout(timeout); reject(new Error(`MCP-EXT-108 Worker failed: ${error.message}`)); });
  });
}
