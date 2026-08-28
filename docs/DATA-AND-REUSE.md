# Reuse, Utility Functions, and Data-Driven Testing

This guide is for QA authors first and extension developers second.

## Reusable flows

A flow is a named group of ordinary test actions:

```text
Flow: "Verify addition"
  Inputs: a, b, expected

  Call tool "add" with:
    a: "${a}"
    b: "${b}"

  Expect "structuredContent.sum" equals "${expected}"
```

Use it from any test:

```text
Use flow "Verify addition" with:
  a: 2
  b: 3
  expected: 5
```

Flows can use other flows. Recursive flow calls are rejected before execution. Each invocation has its own prefixed variables, so reused actions do not overwrite another invocation's inputs.

Flows may contain section markers:

```text
Flow: "Create and remove customer"
  Inputs: email

  Setup:
  Call tool "prepare_tenant"

  Steps:
  Call tool "create_customer" with:
    email: "${email}"

  Cleanup:
  Call tool "remove_customer" with:
    email: "${email}"
```

Cleanup actions are marked as guaranteed and are attempted after a preceding action fails. Keep cleanup idempotent.

## Deterministic built-in utilities

```text
Set "email" using "lowercase" with:
  value: "${row.Email}"
```

Built-ins:

- `lowercase`, `uppercase`, `trim`
- `join`, `replace`, `length`
- `number`, `text`, `json`, `round`
- `urlEncode`, `base64`, `hash`

They have no network or file access and do not use random values or the current time.

## Custom utility functions

Declare a reviewed module:

```text
Functions: tests/qa-functions.mjs
```

```javascript
export function calculateTax({ amount, rate }) {
  return Math.round(amount * rate * 100) / 100;
}
```

Use it exactly like a built-in:

```text
Set "expectedTax" using "calculateTax" with:
  amount: "${row.amount}"
  rate: 0.08
```

Custom code is disabled by default:

```bash
mcprigor test tax.mcpr --allow-custom-code
```

Enabled modules run in constrained workers by default, with manifest checks, explicit permissions, JSON-only boundaries, memory limits, and timeouts. Worker isolation reduces risk but is not a hard sandbox for hostile code. Review, pin, and allowlist every extension before CI use. See [Extension SDK](EXTENSION-SDK.md).

## Inline examples

```text
Test: "Calculator examples"
  For each row:
    | caseId  | a  | b  | expected |
    | basic   | 2  | 3  | 5        |
    | larger  | 20 | 22 | 42       |

  Use flow "Verify addition" with:
    a: "${row.a}"
    b: "${row.b}"
    expected: "${row.expected}"
```

Each row becomes an isolated test and report entry. `caseId` or `id` provides its display ID.

## Files

```text
For each row in "data/cases.csv"
For each row in "data/cases.json"
For each row in "data/cases.yaml"
For each row in "data/cases.xlsx" from sheet "Regression"
```

JSON/YAML files must contain an array of objects. Named source configuration can select a nested `path`.

## Named data sources

```text
Data source: "regression cases"
  provider: json
  file: data/cases.json
  path: cases

Test: "Regression matrix"
  For each row from "regression cases"
  # actions using ${row.column}
```

Providers:

- `inline`
- `csv`
- `json`
- `yaml`
- `excel`
- `rest`
- `google-sheets`
- `sql` through a reviewed provider module
- `plugin` for other systems

## REST

```text
Data source: "API cases"
  provider: rest
  url: https://qa.example.com/cases
  path: cases
  headers:
    Authorization: "Bearer ${env.CASES_TOKEN}"
```

Remote sources require explicit permission:

```bash
mcprigor test api.mcpr --allow-remote-data
```

Requests have a ten-second deadline. Responses must be JSON row arrays. Credential-shaped fields are redacted from reports.

## Google Sheets

```text
Data source: "Sheet cases"
  provider: google-sheets
  spreadsheetId: "${env.SHEET_ID}"
  range: Regression!A1:F100
  accessToken: "${env.GOOGLE_ACCESS_TOKEN}"
```

Or provide `apiKey` for a public sheet. Google Sheets is fetched through the Values REST API and requires `--allow-remote-data`.

## SQL and custom providers

Database drivers are intentionally not bundled. Register a reviewed provider module:

```text
Data source: "Database cases"
  provider: sql
  module: test/providers/postgres-cases.mjs
  query: SELECT case_id, input, expected FROM qa_cases
```

The module implements:

```javascript
export default {
  async load(config, context) {
    // Use parameterized, read-only queries and return object rows.
    return rows;
  }
}
```

Run with `--allow-custom-code`. The same plugin interface can connect Jira, Xray, TestRail, or internal systems.

## Safety and reproducibility

- Default maximum: 1,000 rows; set a lower ceiling with `--max-rows`.
- Local data files have a 10 MiB limit.
- Every source gets a SHA-256 fingerprint.
- Every expanded row stores its source, row number, row ID, and source fingerprint.
- One MCP session is created per row by default.
- Remote and executable providers are off by default.
- Data values can contain sensitive business information; avoid placing secrets in `caseId` because IDs appear in reports.
