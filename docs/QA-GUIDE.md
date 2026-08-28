# QA guide

Use this page as a short everyday checklist. For examples, open the [plain-language cookbook](PLAIN-LANGUAGE-COOKBOOK.md).

## Everyday workflow

```bash
mcprigor check tests/acceptance.mcpr
mcprigor test tests/acceptance.mcpr
mcprigor test tests/acceptance.mcpr --html report.html
```

Or use the browser:

```bash
mcprigor workspace .
```

## Test structure

```text
MCP Test 1
Suite: "Customer service"
Server: node dist/server.js

Test: "An active customer can be found"
  Call tool "find_customer" with:
    customerId: "C-100"

  Expect "structuredContent.status" equals "active"
```

A file needs:

1. A suite name
2. A `Server` command or `MCP URL`
3. One or more named tests
4. At least one action in each test

## Actions

```text
Call tool "name" with:
  input: value

Read resource "scheme://resource"

Get prompt "name" with:
  argument: value

Send "ping"
```

## Expectations

```text
Expect it succeeds
Expect an error
Expect "field" equals value
Expect "field" does not equal value
Expect "field" contains value
Expect "field" exists
Expect "items" has 3 items
Expect "field" is a string
Expect "field" matches "pattern"
```

Arrays use indexes such as `items[0].name`.

## Variables

```text
Save "structuredContent.id" as "createdId"
```

Use it later:

```text
Call tool "get_item" with:
  id: "${createdId}"
```

## Setup and cleanup

```text
Setup:
Call tool "create_fixture"

Steps:
Call tool "verify_fixture"

Cleanup:
Call tool "delete_fixture"
```

Cleanup is attempted even after a failed step. Keep it safe to repeat.

## Data tables

```text
For each row:
  | caseId | input | expected |
  | first  | 2     | 4        |
  | second | 3     | 6        |
```

Use values as `${row.input}` and `${row.expected}`.

## Good QA practices

- Assert stable business fields, not entire responses.
- Use `exists` for generated IDs.
- Avoid exact timestamp and token assertions.
- Give tests behavior-focused names.
- Keep each test independently repeatable.
- Add cleanup for created data.
- Validate with `check` before running.
- Review snapshots and contract updates in pull requests.
- Keep credentials in environment variables.

## Where to go next

- [Getting started](GETTING-STARTED.md)
- [Plain-language cookbook](PLAIN-LANGUAGE-COOKBOOK.md)
- [Guided authoring](GUIDED-AUTHORING.md)
- [Data and reusable flows](DATA-AND-REUSE.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Complete language reference](LANGUAGE-SPEC.md)
