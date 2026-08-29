# Plain-language cookbook

Copy a pattern, replace the names and values, then run `mcprigor check FILE`.

## Basic file

```text
MCP Test 1
Suite: "Customer service"
Server: node dist/server.js

Test: "The server responds"
  Send "ping"
  Expect it succeeds
```

## Call a tool

```text
Test: "An active customer can be found"
  Call tool "find_customer" with:
    customerId: "C-100"

  Expect "structuredContent.customerId" equals "C-100"
  Expect "structuredContent.status" equals "active"
```

## Read a resource

```text
Test: "The catalog is ready"
  Read resource "catalog://status"
  Expect "contents[0].text" contains "ready"
```

## Get a prompt

```text
Test: "A review prompt can be created"
  Get prompt "review_release" with:
    release: "1.2.0"

  Expect "messages" has 1 item
```

## Check result types and patterns

```text
Expect "structuredContent.total" is a number
Expect "structuredContent.customerId" matches "^C-[0-9]+$"
Expect "structuredContent.status" does not equal "deleted"
Expect "structuredContent.items" exists
Expect "structuredContent.items" has 3 items
```

## Expect an MCP error

```text
Test: "A missing customer returns an error"
  Call tool "find_customer" with:
    customerId: "DOES-NOT-EXIST"

  Expect an error
  Expect error code -32602
  Expect error message matches "not found"
```

## Save and reuse a value

```text
Test: "Create and retrieve a customer"
  Call tool "create_customer" with:
    email: "qa@example.com"

  Save "structuredContent.customerId" as "customerId"

  Call tool "find_customer" with:
    customerId: "${customerId}"

  Expect "structuredContent.customerId" equals "${customerId}"
```

## Always clean up

```text
Test: "A temporary customer can be used"
  Setup:
  Call tool "create_customer" with:
    email: "temporary@example.com"
  Save "structuredContent.customerId" as "customerId"

  Steps:
  Call tool "find_customer" with:
    customerId: "${customerId}"
  Expect it succeeds

  Cleanup:
  Call tool "delete_customer" with:
    customerId: "${customerId}"
```

Cleanup runs even if an earlier test action fails. Make cleanup actions safe to repeat.

## Reuse a flow

```text
Flow: "Verify addition"
  Inputs: a, b, expected

  Call tool "add" with:
    a: "${a}"
    b: "${b}"

  Expect "structuredContent.sum" equals "${expected}"

Test: "Common addition cases"
  Use flow "Verify addition" with:
    a: 20
    b: 22
    expected: 42
```

## Run a table of examples

```text
Test: "Calculator examples"
  For each row:
    | caseId | a  | b  | expected |
    | zero   | 0  | 0  | 0        |
    | basic  | 2  | 3  | 5        |
    | larger | 20 | 22 | 42       |

  Call tool "add" with:
    a: "${row.a}"
    b: "${row.b}"

  Expect "structuredContent.sum" equals "${row.expected}"
```

## Use CSV data

```text
Data source: "customers"
  From CSV "data/customers.csv"
  Column "customerId" is string required
  Column "active" is boolean
  Keep rows where "active" equals true
  Sample 25 rows with seed 2025

Test: "Active customers are available"
  For each row from "customers"
  Call tool "find_customer" with:
    customerId: "${row.customerId}"
  Expect it succeeds
```

## Share an output with another test

```text
Test: "Create a customer"
  Id: create-customer
  Call tool "create_customer" with:
    email: "qa@example.com"
  Export "structuredContent.customerId" as "customerId"

Test: "Retrieve the created customer"
  Id: retrieve-customer
  Depends on: create-customer
  Call tool "find_customer" with:
    customerId: "${deps.create-customer.customerId}"
  Expect it succeeds
```

## Compare two transports

```text
Compare target "Local": node dist/server.js
Compare target "QA": https://qa.example.com/mcp

Test: "Search behaves the same"
  Call tool "search" with:
    query: "red shoes"
  Expect "structuredContent.total" equals 2
```

Run with `mcprigor parity FILE`.

## Test a server that needs a bearer token

Point the suite at the deployed endpoint and pass the token through an environment variable. Never paste a real token into a test file.

```text
MCP Test 1
Suite: "Deployed order service"
MCP URL: https://qa.example.com/mcp

Server options:
  headers:
    Authorization: "Bearer ${env.QA_TOKEN}"

Test: "an authenticated call succeeds"
  Call tool "find_order" with:
    orderId: "A-1001"
  Expect "structuredContent.status" equals "shipped"
```

Run it with the token in the environment:

```bash
QA_TOKEN=... mcprigor test orders.mcpr
```

Three guarantees come with this pattern:

- if `QA_TOKEN` is not set, the run stops with `Environment variable not found: QA_TOKEN` instead of sending an empty header;
- header values are registered with the redactor automatically, so the token never appears in reports or evidence bundles;
- a wrong or expired token surfaces the server's own response (for example `{"error":"unauthorized"}`) in the failure message.

Any header works the same way — `X-Api-Key`, custom tenant headers, and so on.

## Compare an open local server with a protected deployment

Parity targets accept per-target options, so the local build can run without auth while the deployed target sends the token:

```text
Compare target "Local": node dist/server.js
Compare target "QA": https://qa.example.com/mcp

Target options for "QA":
  headers:
    Authorization: "Bearer ${env.QA_TOKEN}"

Test: "Search behaves the same"
  Call tool "search" with:
    query: "red shoes"
  Expect "structuredContent.total" equals 2
```

## When the token must be fetched first

MCP Rigor does not perform OAuth login flows or token exchanges itself; tests stay deterministic and secrets stay outside test files. When a short-lived token must be acquired (client-credentials exchange, cloud CLI, vault), fetch it in the step before the run:

```bash
QA_TOKEN=$(curl -s -X POST https://auth.example.com/oauth/token \
  -d grant_type=client_credentials \
  -d client_id="$CLIENT_ID" -d client_secret="$CLIENT_SECRET" | jq -r .access_token)
QA_TOKEN=$QA_TOKEN mcprigor test orders.mcpr
```

In CI, do the same in the workflow:

```yaml
- name: Acceptance tests
  env:
    QA_TOKEN: ${{ secrets.QA_TOKEN }}
  run: npx mcprigor test tests/*.mcpr
```

Interactive browser-redirect OAuth is out of scope by design: an acceptance run must be repeatable without a human in the loop.

## Fetch an OAuth token before connecting

When the token is short-lived (OAuth client credentials), let the suite fetch it at run time instead of storing it anywhere:

```text
MCP URL: https://qa.example.com/mcp
Server options:
  Token from: node scripts/get-token.mjs
```

The command runs once before the suite connects; its output (a single token on stdout) becomes the `Authorization: Bearer …` header. The fetched token is auto-redacted from every report and evidence bundle. The command can do anything — call your identity provider, read a keychain, exchange client credentials — as long as it prints exactly one token. If it fails or prints nothing, the run stops with `MCP-AUTH-002` before any test executes.

## Match a snapshot

```text
Expect "structuredContent" matches snapshot "customer" ignoring "$.generatedAt"
```

Create or approve the snapshot explicitly:

```bash
mcprigor test customer.mcpr --snapshot customer.snap.json --update-snapshots
```

## Notifications and progress

```text
Subscribe to resource "catalog://updates"
Wait for notification "notifications/resources/updated" within 5 seconds
Unsubscribe from resource "catalog://updates"
```

```text
Call tool "import_catalog" with progress and cancel after 500 ms with:
  file: "catalog.csv"
```

## Validate before running

```bash
mcprigor check tests/acceptance.mcpr
```

For every supported statement and rule, see the [language reference](LANGUAGE-SPEC.md).
