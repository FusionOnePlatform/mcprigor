import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import AjvModule, { type ErrorObject } from "ajv";

const Ajv = AjvModule as unknown as typeof import("ajv").default;
import YAML from "yaml";
import { suiteSchema } from "./schema.js";
import type { Suite } from "./types.js";

const MAX_SUITE_BYTES = 1024 * 1024;
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(suiteSchema);

export async function loadSuite(file: string): Promise<Suite> {
  const source = await readFile(file, "utf8");
  if (Buffer.byteLength(source) > MAX_SUITE_BYTES) throw new Error("MCP-CONFIG-002 Suite exceeds the 1 MiB limit");
  const extension = extname(file).toLowerCase();
  let value: unknown;

  try {
    if (extension === ".json") value = JSON.parse(source);
    else {
      const document = YAML.parseDocument(source, { uniqueKeys: true });
      if (document.errors.length) throw document.errors[0];
      value = document.toJS({ maxAliasCount: 0 });
    }
  } catch (error) {
    throw new Error(`MCP-CONFIG-001 Unable to parse ${file}: ${messageOf(error)}`);
  }

  validateSuite(value);
  return value;
}

export function validateSuite(value: unknown): asserts value is Suite {
  if (!validate(value)) {
    const detail = (validate.errors ?? []).map(formatError).join("; ");
    throw new Error(`MCP-CONFIG-003 Invalid suite: ${detail}`);
  }
  const names = new Set<string>();
  for (const test of (value as Suite).tests) {
    if (names.has(test.name)) throw new Error(`MCP-CONFIG-004 Duplicate test name: ${test.name}`);
    names.add(test.name);
  }
}

function formatError(error: ErrorObject): string {
  const path = error.instancePath || "$";
  return `${path} ${error.message ?? "is invalid"}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
