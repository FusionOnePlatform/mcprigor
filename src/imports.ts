import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ImportGraph { source: string; importedFiles: string[] }

/** Resolve flow-library imports and inline declarations without executing imported tests. */
export async function resolveFlowImports(source: string, entryFile: string, stack: string[] = []): Promise<ImportGraph> {
  const canonical = await realpath(entryFile).catch(() => resolve(entryFile));
  if (stack.includes(canonical)) throw new Error(`MCPLANG301 Import cycle: ${[...stack, canonical].join(" → ")}`);
  const expression = /^Import flows from\s+["']([^"']+)["']\s*$/gim;
  const importedFiles: string[] = [];
  const chunks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(source))) {
    const imported = await realpath(resolve(dirname(canonical), match[1]!)).catch(() => resolve(dirname(canonical), match![1]!));
    let importedSource: string;
    try { importedSource = await readFile(imported, "utf8"); }
    catch { throw new Error(`MCPLANG302 Cannot import flow library ${match[1]} from ${entryFile}`); }
    const graph = await resolveFlowImports(importedSource, imported, [...stack, canonical]);
    importedFiles.push(imported, ...graph.importedFiles);
    chunks.push(flowDeclarationsOnly(graph.source));
  }
  return { source: `${chunks.join("\n")}\n${source.replace(expression, "")}`, importedFiles: [...new Set(importedFiles)] };
}

function flowDeclarationsOnly(source: string): string {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const output: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (/^Flow:/i.test(lines[index]!.trim()) && !/^\s/.test(lines[index]!)) {
      output.push(lines[index++]!);
      while (index < lines.length && (!lines[index]!.trim() || /^\s/.test(lines[index]!))) output.push(lines[index++]!);
    } else index++;
  }
  return output.join("\n");
}
