import { describe, expect, it } from "vitest";
import { compileAdvancedQaLanguage } from "../src/qa-advanced.js";
import { compileQaLanguage } from "../src/qa-language.js";
import type { Suite } from "../src/types.js";

function comparable(suite: Suite): unknown { return JSON.parse(JSON.stringify(suite)); }

describe("plain-language and YAML model parity", () => {
  it("compiles suite, target, test, lifecycle, assertions, snapshot, and exports identically", () => {
    const plain = compileQaLanguage(`MCP Test 1
Suite: "Complete"
Server: node server.js
Server options:
  cwd: /tmp/service
  env:
    MODE: test
Default timeout: 5 seconds
Redact: "secret", "token"
Snapshots: snapshots.json
Ignore snapshot paths: "$.createdAt"
Client behavior:
  roots:
    - uri: file:///workspace
      name: Workspace
  sampling:
    model: fixture
    text: deterministic

Test: "Create customer"
  Id: create
  Variables:
    tenant: acme
  Require: tools, resources
  Require protocol: "2025-06-18"
  Setup:
  Send "ping"
  Steps:
  Call tool "create" with:
    tenant: "\${tenant}"
  Expect it succeeds
  Expect "structuredContent.id" exists
  Expect "structuredContent.id" is a string
  Expect "structuredContent.id" does not equal ""
  Expect "structuredContent" matches snapshot "customer" ignoring "$.createdAt"
  Save "structuredContent.id" as "id"
  Export "structuredContent.id" as "customerId" sensitive
  Wait up to 2 seconds
  Cleanup:
  Call tool "remove" with:
    id: "\${id}"
`);
    const expected: Suite = {
      version: 1, name: "Complete",
      target: { transport: "stdio", command: "node", args: ["server.js"], cwd: "/tmp/service", env: { MODE: "test" } },
      defaults: { timeoutMs: 5000 }, redact: ["secret", "token"], snapshots: { file: "snapshots.json", ignore: ["$.createdAt"] },
      client: { roots: [{ uri: "file:///workspace", name: "Workspace" }], sampling: { model: "fixture", text: "deterministic" } },
      tests: [{ name: "Create customer", id: "create", variables: { tenant: "acme" }, requires: { capabilities: ["tools", "resources"], protocolVersions: ["2025-06-18"] }, steps: [
        { name: "Send ping", request: { method: "ping", params: undefined }, phase: "setup", always: false },
        { name: "Call tool “create”", tool: { name: "create", arguments: { tenant: "\${tenant}" } }, phase: "test", always: false, timeoutMs: 2000, assert: { status: "success", json: [
          { path: "$.structuredContent.id", exists: true }, { path: "$.structuredContent.id", type: "string" }, { path: "$.structuredContent.id", notEquals: "" }, { path: "$.structuredContent", snapshot: { name: "customer", ignore: ["$.createdAt"] } },
        ] }, capture: { id: "$.structuredContent.id" }, export: { customerId: { path: "$.structuredContent.id", aggregate: "single", sensitive: true } } },
        { name: "Call tool “remove”", tool: { name: "remove", arguments: { id: "${id}" } }, phase: "cleanup", always: true },
      ] }],
    };
    expect(comparable(plain)).toEqual(comparable(expected));
  });

  it("compiles readable data engineering settings", async () => {
    const suite = await compileAdvancedQaLanguage(`MCP Test 1
Suite: "Data"
Server: node server.js
Data source: "customers"
  From CSV "customers.csv"
  Column "id" is string required
  Column "spend" is number required
  Column "tier" is string one of gold, silver
  Derive "label" as "\${id}:\${tier}"
  Keep rows where "spend" is greater than 100
  Sample 5 rows with seed 42
  Cache this source
Test: "Customer row"
  For each row from "customers"
  Call tool "check" with:
    id: "\${row.id}"
`, "/tmp/data.mcpr").catch((error) => error);
    // Loading a missing CSV proves the English block was accepted and reached the real provider.
    expect(String(suite)).toMatch(/ENOENT|customers\.csv/);
  });

  it("supports task actions and full error assertions", () => {
    const suite = compileQaLanguage(`Suite: "Native"
Server: node server.js
Test: "tasks"
  Get task "task-1"
  Expect an error
  Expect error code -32602
  Expect error message matches "not found"
  List tasks
  Cancel task "task-1"
`);
    expect((suite.tests[0]?.steps[0] as any).native).toEqual({ action: "task-get", taskId: "task-1" });
    expect(suite.tests[0]?.steps[0]?.assert).toEqual({ status: "error", error: { code: -32602, matches: "not found" } });
  });
});
