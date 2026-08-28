import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";

interface Input { modulePath: string; kind: "inspect" | "function" | "provider"; name?: string; args?: Record<string, unknown>; config?: Record<string, unknown>; context?: { cwd: string; maxRows: number } }
const input = workerData as Input;
try {
  const imported = await import(pathToFileURL(input.modulePath).href) as Record<string, any>;
  const manifest = imported.manifest ?? imported.default?.manifest;
  if (input.kind === "inspect") {
    const functions = manifest?.functions ?? Object.entries(imported).filter(([name, value]) => name !== "manifest" && typeof value === "function").map(([name]) => name);
    parentPort!.postMessage({ ok: true, value: { manifest, functions, provider: Boolean(manifest?.provider || imported.provider?.load || imported.default?.load) } });
  } else if (input.kind === "function") {
    const fn = imported[input.name!] ?? imported.default?.functions?.[input.name!];
    if (typeof fn !== "function") throw new Error(`Function “${input.name}” is not exported`);
    parentPort!.postMessage({ ok: true, value: await fn(input.args ?? {}) });
  } else {
    const provider = imported.provider ?? imported.default;
    if (!provider?.load) throw new Error("Extension does not export a provider with load()");
    parentPort!.postMessage({ ok: true, value: await provider.load(input.config ?? {}, input.context ?? { cwd: ".", maxRows: 1000 }) });
  }
} catch (error) {
  parentPort!.postMessage({ ok: false, error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined } });
}
