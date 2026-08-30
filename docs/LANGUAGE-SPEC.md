# MCP Test Language 1

Status: compatibility-stable frontend for MCP Rigor 1.x.

The `.mcpr` language and YAML compile to the same `Suite` runtime model. Every user-authored YAML capability has a deterministic plain-language equivalent; YAML remains available for generated files and programmatic integrations rather than being a more powerful test format.

Parity is enforced, not aspirational: every `.mcpr` construct compiles to a suite that also validates against the YAML/JSON schema, and `mcprigor convert my-tests.mcpr --out my-tests.yaml` (or `--format json`) emits that equivalent file. The converted suite reloads to the identical suite model and produces the same run results — the regression suite converts each shipped example, reloads it from YAML, and compares runs.

## Design goals

- Readable by QA professionals without programming experience
- Deterministic: no LLM or fuzzy interpretation
- Two-space indentation and precise file/line/column diagnostics
- Safe data blocks delegated to YAML after the outer statement is recognized
- Backward-compatible with MCP Rigor 0.5 `.mcpr` files

A file may begin with:

```text
MCP Test 1
```

Unknown language versions are rejected.

## Lexical rules

- UTF-8 text; LF and CRLF accepted
- Tabs are rejected
- Indentation must be a multiple of two spaces
- `#` starts a comment on a standalone line
- Declaration keywords are case-insensitive for compatibility
- Tool, flow, test, variable, and ID values retain their case
- Strings may use single or double quotes
- Indented `with:` blocks use safe YAML values

The formal frontend emits located nodes with UTF-16 offsets, line, column, semantic span, indentation, and declaration kind. Compilation currently lowers this document through the compatibility compiler so runtime behavior remains stable.

## Document declarations

```text
MCP Test 1
Suite: "Customer tests"
Server: node dist/server.js
```

HTTP:

```text
MCP URL: https://qa.example.com/mcp
```

Target options use a readable settings block:

```text
Server options:
  cwd: ./server
  env:
    MODE: test
```

```text
Server options:
  headers:
    Authorization: "Bearer ${env.QA_TOKEN}"
```

An HTTP target may fetch a bearer token at run time with `Token from` (a command whose single-line stdout becomes the `Authorization` header), or drive an interactive browser login with `OAuth`:

```text
Server options:
  OAuth: oauth
```

`OAuth: oauth` performs an authorization-code + PKCE browser login once at the start of the run and carries the in-memory session (with automatic refresh) into every test. The block form takes optional `clientId`, `clientSecret` (use `${env.NAME}`), and `scope`. Tokens are never written to disk and are always redacted. See the [Authentication guide](AUTHENTICATION.md).

### Environment variables and secrets

Any string value in a target block — a header, a URL, a `cwd`, an `env` entry, a `Server options` field — may contain `${env.NAME}` placeholders. Before the suite connects, each placeholder is replaced with the value of the operating-system environment variable `NAME`:

```text
MCP URL: ${env.MCP_URL}

Server options:
  headers:
    Authorization: "Bearer ${env.MCP_TOKEN}"
    X-Api-Key: "${env.API_KEY}"
```

```bash
MCP_URL=https://qa.example.com/mcp MCP_TOKEN=... API_KEY=... mcprigor test suite.mcpr
```

Rules:

- The syntax is exactly `${env.NAME}`. `NAME` is a literal environment-variable name; there is no shell, no command substitution, and no default-value syntax.
- A placeholder may be embedded in a larger string (`"Bearer ${env.MCP_TOKEN}"`) or be the whole value (`"${env.API_KEY}"`), and a value may contain several placeholders.
- If `NAME` is not set, the run stops immediately with `Environment variable not found: NAME` — it never sends an empty header or a half-substituted URL.
- Never write a literal secret into a suite. Keep tokens and keys in the environment (locally) or in CI secrets, and reference them with `${env.NAME}` so the committed `.mcpr` file carries no credentials.
- Header values are registered with the redactor automatically, so a resolved token never appears in reports, evidence bundles, or published URLs.

The same `${env.NAME}` placeholders work in every target surface: single-server `Server options`, per-server `Server options for "name"` in compositions, and `Target options for "name"` in parity comparisons.

Multi-server compositions use named server declarations and per-test routing:

```text
Named server "catalog": node services/catalog.js
Named server "billing": https://qa.example.com/billing/mcp

Server options for "billing":
  headers:
    X-Tenant: qa

Test: "catalog lookup"
  On server "catalog"
  Call tool "search"
```

The YAML equivalent is a top-level `servers` mapping plus `server` on a test. A composition requires at least two named servers, and an unknown `On server` name is rejected during compilation.

Parity targets use the same connection grammar:

```text
Compare target "Local": node server.js
Compare target "QA": https://qa.example.com/mcp

Target options for "QA":
  headers:
    Authorization: "Bearer ${env.QA_TOKEN}"
```

Suite-level YAML fields have direct equivalents:

```text
Default timeout: 10 seconds
Budget: p95 500ms over 20 calls
Budget for "order lookup": p50 300ms over 20 calls
Redact: "secret-value", "token-value"
Snapshots: snapshots.json
Ignore snapshot paths: "$.createdAt", "$.requestId"

Client behavior:
  roots:
    - uri: file:///workspace
      name: Workspace
  sampling:
    model: fixture
    text: deterministic response
  elicitation:
    action: accept
    content:
      approved: true
```

Per-test scripted responses override `Client behavior:` for one test:

```text
When the server asks for input, respond "accept" with:
  field: value
When the server asks for input, respond "decline"
When the server requests sampling, respond "scripted text"
```

## Imports

```text
Import flows from "./shared/customer-flows.mcpr"
```

Only `Flow:` declarations are imported. Imported tests, server declarations, data sources, and top-level configuration never execute. Paths resolve relative to the importer. Canonical path cycles are rejected.

## Flows

```text
Flow: "Verify addition"
  Inputs: a, b=1, expected

  Call tool "add" with:
    a: "${a}"
    b: "${b}"

  Expect "structuredContent.sum" equals "${expected}"
```

Inputs without `=` are required. Inputs with defaults are optional. Unknown supplied inputs and missing required inputs are compilation errors. Recursive flows are rejected.

Use a flow:

```text
Use flow "Verify addition" with:
  a: 4
  expected: 5
```

Flow invocations receive isolated prefixed variables. Caller values are available only when passed through declared inputs.

## Tests and dependencies

```text
Test: "Create customer"
  Id: create-customer
  Require: tools
```

```text
Test: "Retrieve customer"
  Depends on: create-customer
```

Additional test settings:

```text
Skip: "Not enabled in this environment"

Variables:
  tenant: acme
  retryCount: 3

Require protocol: "2025-06-18"
```

`Skip` without a reason maps to `skip: true`. IDs are unique. Dependencies form an acyclic graph and must pass before the consumer opens a session.

## Actions

```text
Call tool "search" with:
  query: "red shoes"

Read resource "catalog://status"

Get prompt "review" with:
  topic: "release"

Send "ping"
```

## Expectations and values

```text
Expect it succeeds
Expect an error
Expect the call to finish within 800ms
Expect "structuredContent.total" equals 2
Expect "content[0].text" contains "complete"
Expect "items" exists
Expect "items" has 3 items
```

Full assertion vocabulary:

```text
Expect "status" does not equal "deleted"
Expect "count" is a number
Expect "customerId" matches "^C-[0-9]+$"
Expect error code -32602
Expect error message matches "invalid input"
Expect "structuredContent" matches schema:
  type: object
  required: [customerId]
Expect "structuredContent" matches snapshot "customer" ignoring "$.createdAt"
```

Equality is type-sensitive. No implicit text/number coercion occurs. Schema blocks use safe YAML only after the deterministic outer statement is recognized.

## Variables, exports, and utilities

```text
Save "structuredContent.id" as "localId"
Export "structuredContent.id" as "customerId"
```

Local values use `${localId}`. Dependency outputs use `${deps.create-customer.customerId}`. Persisted state uses `${state.create-customer.customerId}`.

```text
Set "normalized" using "lowercase" with:
  value: "${row.Email}"
```

## Data iteration

```text
For each row:
  | caseId | input | expected |
  | first  | 2     | 4        |
```

Plain-language engineered sources:

```text
Data source: "customers"
  From CSV "customers.csv"
  Column "customerId" is string required
  Column "spend" is number required
  Column "tier" is string one of gold, silver, bronze
  Derive "label" as "${customerId}:${tier}"
  Keep rows where "spend" is greater than 100
  Sample 25 rows with seed 2025
  Cache this source

Test: "Active customer"
  For each row from "customers"
  Call tool "find_customer" with:
    customerId: "${row.customerId}"
```

File forms are `From CSV`, `From JSON`, `From YAML`, and `From Excel ... sheet ...`. Remote sources use `From REST`. Existing structured settings remain accepted inside a `Data source` block for Google Sheets, SQL, custom plugins, joins, and uncommon provider-specific options, so there is no capability gap with YAML. Remote and custom-code safety flags remain mandatory.

See `DATA-AND-REUSE.md` and `DATA-ENGINEERING.md`.

## Setup and cleanup

```text
Setup:
Call tool "prepare"

Steps:
Call tool "execute"

Cleanup:
Call tool "remove"
```

Cleanup actions are attempted even after an earlier failure. Cleanup should be idempotent.

## MCP-native actions

```text
Subscribe to resource "customer://updates"
Wait for notification "notifications/resources/updated" within 5 seconds
Unsubscribe from resource "customer://updates"
Set log level to "debug"
List all tools
List all resources
List all prompts
List all resource templates
Get task "task-1"
List tasks
Cancel task "task-1"
```

Progress and cancellation:

```text
Call tool "import" with progress and cancel after 500 ms with:
  source: catalog.csv
```

These compile to the same `native` step objects accepted by YAML.

## Diagnostics

A diagnostic includes a stable code, source location, original line, caret, explanation, and correction:

```text
MCPLANG102 tests/customer.mcpr:8:1

   Call tool "create"
^

Indentation must use multiples of two spaces.
Try: use 0, 2, 4, or 6 leading spaces
```

Current namespaces:

- `MCPLANG1xx`: lexical/version errors
- `MCPLANG2xx`: structural errors
- `MCPLANG3xx`: import errors
- `MCPLANG4xx`: symbol, flow, and reference errors
- `MCP-DEP-*`: dependency graph errors
- `QA-DATA-*` / `MCP-DATA-*`: data compilation/provider errors

## Grammar summary

```ebnf
document   = version? declaration* ;
declaration = suite | server | import | flow | dataSource | test ;
flow       = "Flow:" name flowProperty* statement* ;
test       = "Test:" name testProperty* statement* ;
statement  = callTool | readResource | getPrompt | send | expect
           | save | export | wait | set | useFlow | forEach | section ;
```

The vocabulary is closed. New behavior requires a documented language-version-compatible statement rather than fuzzy natural-language interpretation.
