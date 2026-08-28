export type ExtensionPermission = "environment" | "filesystem-read" | "network";
export interface ExtensionManifest { schemaVersion: 1; name: string; version: string; permissions?: ExtensionPermission[]; functions?: string[]; provider?: boolean }
export interface ExtensionFunctionContext { signal?: AbortSignal }
export type ExtensionFunction = (args: Record<string, unknown>, context?: ExtensionFunctionContext) => unknown | Promise<unknown>;
export interface ExtensionDataProvider { load(config: Record<string, unknown>, context: { cwd: string; maxRows: number }): Promise<Record<string, unknown>[]> }
export function defineExtension<T extends Record<string, unknown>>(extension: T): T { return extension; }
export function defineManifest(manifest: ExtensionManifest): ExtensionManifest { return manifest; }
