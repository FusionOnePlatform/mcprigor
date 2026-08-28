import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { compileAdvancedQaLanguage, type QaCompileOptions } from "./qa-advanced.js";
import { resolveFlowImports } from "./imports.js";
import { lexLanguage, validateLanguageDocument } from "./language.js";
import { loadSuite, validateSuite } from "./loader.js";
import type { Suite } from "./types.js";

export async function loadTestFile(file: string, options: QaCompileOptions = {}): Promise<Suite> {
  const extension = extname(file).toLowerCase();
  if (extension === ".mcp") throw new Error(`MCP-CONFIG-006 The .mcp extension is reserved by other tools. Rename this file to ${file.slice(0, -4)}.mcpr.`);
  if (extension === ".mcpr") {
    const rawSource = await readFile(file, "utf8");
    const resolved = await resolveFlowImports(rawSource, file);
    const document = lexLanguage(resolved.source, file);
    validateLanguageDocument(document);
    const suite = await compileAdvancedQaLanguage(resolved.source, file, options);
    validateSuite(suite);
    return suite;
  }
  return loadSuite(file);
}
