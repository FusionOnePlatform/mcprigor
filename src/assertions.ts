import { isDeepStrictEqual } from "node:util";
import AjvModule from "ajv";
import type { ErrorObject } from "ajv";

const Ajv = AjvModule as unknown as typeof import("ajv").default;
import { readPath } from "./path.js";

const ajv = new Ajv({ allErrors: true, strict: false });
import type { JsonAssertion, StepAssertion } from "./types.js";

export function assertResponse(response: unknown, assertion: StepAssertion | undefined): void {
  if (!assertion) return;
  if (assertion.status === "error") throw new Error("Expected an MCP error, but the request succeeded");

  const assertions = assertion.json
    ? Array.isArray(assertion.json)
      ? assertion.json
      : [assertion.json]
    : [];
  for (const item of assertions) assertJson(response, item);
}

export function assertError(error: unknown, assertion: StepAssertion | undefined): void {
  if (assertion?.status !== "error") throw error;
  const candidate = error as { code?: unknown; message?: unknown };
  const expected = assertion.error;
  if (!expected) return;

  if (expected.code !== undefined && candidate.code !== expected.code) {
    throw new Error(`Expected error code ${expected.code}, received ${String(candidate.code)}`);
  }
  const message = String(candidate.message ?? error);
  if (expected.message !== undefined && message !== expected.message) {
    throw new Error(`Expected error message ${JSON.stringify(expected.message)}, received ${JSON.stringify(message)}`);
  }
  if (expected.matches !== undefined && !new RegExp(expected.matches).test(message)) {
    throw new Error(`Expected error message to match /${expected.matches}/, received ${JSON.stringify(message)}`);
  }
}

function assertJson(response: unknown, assertion: JsonAssertion): void {
  const actual = readPath(response, assertion.path);
  const label = assertion.path ?? "$";

  if (assertion.exists !== undefined) {
    const exists = actual !== undefined;
    if (exists !== assertion.exists) fail(label, `existence ${assertion.exists}`, actual);
  }
  if ("equals" in assertion && !isDeepStrictEqual(actual, assertion.equals)) {
    fail(label, JSON.stringify(assertion.equals), actual);
  }
  if ("notEquals" in assertion && isDeepStrictEqual(actual, assertion.notEquals)) {
    throw new Error(`${label}: expected value not to equal ${JSON.stringify(assertion.notEquals)}`);
  }
  if (assertion.type !== undefined && typeOf(actual) !== assertion.type) {
    fail(label, `type ${assertion.type}`, typeOf(actual));
  }
  if (assertion.length !== undefined) {
    const length = typeof actual === "string" || Array.isArray(actual) ? actual.length : undefined;
    if (length !== assertion.length) fail(label, `length ${assertion.length}`, length);
  }
  if ("contains" in assertion && !contains(actual, assertion.contains)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual)} to contain ${JSON.stringify(assertion.contains)}`);
  }
  if (assertion.matches !== undefined) {
    if (typeof actual !== "string" || !new RegExp(assertion.matches).test(actual)) {
      fail(label, `a string matching /${assertion.matches}/`, actual);
    }
  }
  if (assertion.schema !== undefined) {
    const validate = ajv.compile(assertion.schema);
    if (!validate(actual)) {
      const detail = (validate.errors ?? []).map((error: ErrorObject) => `${error.instancePath || "$"} ${error.message}`).join("; ");
      throw new Error(`${label}: MCP-SCHEMA-001 response does not match schema: ${detail}`);
    }
  }
}

function contains(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string" && typeof expected === "string") return actual.includes(expected);
  if (Array.isArray(actual)) {
    return actual.some((item) => isDeepStrictEqual(item, expected) || isSubset(item, expected));
  }
  return isSubset(actual, expected);
}

function isSubset(actual: unknown, expected: unknown): boolean {
  if (isDeepStrictEqual(actual, expected)) return true;
  if (typeof actual !== "object" || actual === null || typeof expected !== "object" || expected === null) {
    return false;
  }
  return Object.entries(expected).every(([key, value]) =>
    isSubset((actual as Record<string, unknown>)[key], value),
  );
}

function typeOf(value: unknown): JsonAssertion["type"] | "undefined" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as JsonAssertion["type"] | "undefined";
}

function fail(path: string, expected: unknown, actual: unknown): never {
  throw new Error(`${path}: expected ${String(expected)}, received ${JSON.stringify(actual)}`);
}
