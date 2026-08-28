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
