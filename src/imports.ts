import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface ImportGraph { source: string; importedFiles: string[] }
export interface ImportLimits { rootDir?: string; maxDepth?: number; maxImports?: number; maxFileBytes?: number }

const MAX_DEPTH = 8;
const MAX_IMPORTS = 64;
const MAX_FILE_BYTES = 1024 * 1024;

/** Resolve flow-library imports and inline declarations without executing imported tests.
 *
 * Confinement: imports must stay inside the suite root (the entry file's directory by
 * default). Absolute paths, `..` traversal escaping the root, and symlinks that
 * canonicalize outside the root are rejected. Recursion depth, import count, and
 * imported file size are limited to bound resource use on hostile inputs.
 */
export async function resolveFlowImports(source: string, entryFile: string, stack: string[] = [], limits: ImportLimits = {}): Promise<ImportGraph> {
  const canonical = await realpath(entryFile).catch(() => resolve(entryFile));
  const rootDir = limits.rootDir ?? await realpath(dirname(canonical)).catch(() => resolve(dirname(canonical)));
  const maxDepth = limits.maxDepth ?? MAX_DEPTH;
  const maxImports = limits.maxImports ?? MAX_IMPORTS;
  const maxFileBytes = limits.maxFileBytes ?? MAX_FILE_BYTES;
  if (stack.includes(canonical)) throw new Error(`MCPLANG301 Import cycle: ${[...stack, canonical].join(" → ")}`);
  if (stack.length >= maxDepth) throw new Error(`MCPLANG303 Import depth exceeds ${maxDepth} in ${entryFile}`);
  const expression = /^Import flows from\s+["']([^"']+)["']\s*$/gim;
  const importedFiles: string[] = [];
  const chunks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(source))) {
    const specifier = match[1]!;
    if (isAbsolute(specifier)) throw new Error(`MCPLANG304 Import path must be relative to the test file, not absolute: ${specifier}`);
    const imported = await confine(resolve(dirname(canonical), specifier), rootDir, specifier);
    const size = await stat(imported).then((s) => s.size).catch(() => 0);
    if (size > maxFileBytes) throw new Error(`MCPLANG305 Imported flow library ${specifier} exceeds ${maxFileBytes} bytes`);
    let importedSource: string;
    try { importedSource = await readFile(imported, "utf8"); }
    catch { throw new Error(`MCPLANG302 Cannot import flow library ${specifier} from ${entryFile}`); }
    const graph = await resolveFlowImports(importedSource, imported, [...stack, canonical], { rootDir, maxDepth, maxImports, maxFileBytes });
    importedFiles.push(imported, ...graph.importedFiles);
    if (new Set(importedFiles).size > maxImports) throw new Error(`MCPLANG306 More than ${maxImports} imported flow libraries`);
    chunks.push(flowDeclarationsOnly(graph.source));
  }
  return { source: `${chunks.join("\n")}\n${source.replace(expression, "")}`, importedFiles: [...new Set(importedFiles)] };
}

async function confine(candidate: string, rootDir: string, specifier: string): Promise<string> {
  const canonical = await realpath(candidate).catch(() => candidate);
  const relation = relative(rootDir, canonical);
  if (relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation))) return canonical;
  throw new Error(`MCPLANG307 Import ${specifier} resolves outside the test suite directory (${rootDir}). Keep shared flow libraries inside the suite folder.`);
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
