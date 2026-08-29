# MCP Rigor

[![npm version](https://img.shields.io/npm/v/mcprigor?logo=npm&color=C026D3)](https://www.npmjs.com/package/mcprigor)
[![CI](https://github.com/FusionOnePlatform/mcprigor/actions/workflows/ci.yml/badge.svg)](https://github.com/FusionOnePlatform/mcprigor/actions/workflows/ci.yml)
[![npm audit: 0 vulnerabilities](https://img.shields.io/badge/npm%20audit-0%20vulnerabilities-14B8A6)](https://github.com/FusionOnePlatform/mcprigor/blob/main/docs/SECURITY-AND-RETENTION.md)
[![Node 20 | 22](https://img.shields.io/node/v/mcprigor?color=7C3AED)](https://www.npmjs.com/package/mcprigor)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Website](https://img.shields.io/badge/docs-mcprigor.com-E879F9)](https://mcprigor.com)

**Natural-language testing for Model Context Protocol servers.**

![MCP Rigor demo: a natural-language test file, then mcprigor check and mcprigor test with passing results](.github/assets/demo.gif)

MCP Rigor lets QA teams test MCP tools, resources, prompts, contracts, and transports without writing test code. Tests are deterministic: no AI model interprets the wording.

> Status: `1.0.0-rc.4` release candidate. Node.js 20 or 22 is required.

## Install

MCP Rigor is published on npm as [`mcprigor`](https://www.npmjs.com/package/mcprigor). The package ships compiled code, ready to run:

```bash
npm install mcprigor
```

Or try it instantly without installing:

```bash
npx mcprigor@latest init tests/acceptance.mcpr
```

Use `npx mcprigor` in commands below, or install globally (`npm install -g mcprigor`) to use `mcprigor` directly. In a project where tests run only during development or CI, `npm install --save-dev mcprigor` keeps it out of production dependencies.

## Install from source

Only needed if you want to modify MCP Rigor itself:

```bash
git clone https://github.com/FusionOnePlatform/mcprigor.git
cd mcprigor
npm ci
npm run check   # build + full test suite
npm link        # optional: use your local build as the global `mcprigor`
```

## Write your first test

Create `calculator.mcpr`:

```text
MCP Test 1

Suite: "Calculator acceptance tests"
Server: node dist/server.js

Test: "Adding 20 and 22 gives 42"
  Call tool "add" with:
    a: 20
    b: 22

  Expect "structuredContent.sum" equals 42
```

Check the wording, then run it:

```bash
npx mcprigor check calculator.mcpr
npx mcprigor test calculator.mcpr
```

Create a browser report:

```bash
npx mcprigor test calculator.mcpr --html report.html
```

Expected summary:

```text
✓ Adding 20 and 22 gives 42

1 passed, 0 failed, 0 skipped, 0 blocked
```

## Use the QA workspace

Start the local browser interface:

```bash
npx mcprigor workspace .
```

Open the printed `http://127.0.0.1:...` URL. You can select a suite, edit it, validate the wording, run tests, run transport parity, and review results.

The workspace is loopback-only and does not accept arbitrary commands from the browser.

## Connect to an MCP server

Local stdio server:

```text
Server: node dist/server.js
```

Python server:

```text
Server: python -m my_mcp_server
```

Streamable HTTP server:

```text
MCP URL: https://qa.example.com/mcp

Server options:
  headers:
    Authorization: "Bearer ${env.MCP_TOKEN}"
```

Run with an environment variable:

```bash
MCP_TOKEN="your-token" npx mcprigor test customer.mcpr
```

Do not place reusable credentials directly in test files.

## Common test actions

```text
Call tool "search" with:
  query: "red shoes"

Read resource "catalog://status"

Get prompt "write_summary" with:
  topic: "Release quality"

Expect it succeeds
Expect an error
Expect "structuredContent.total" equals 2
Expect "content[0].text" contains "complete"
Expect "items" has 3 items
```

See the [natural-language cookbook](docs/PLAIN-LANGUAGE-COOKBOOK.md) for copy-ready examples.

## Compare local and deployed behavior

```text
MCP Test 1
Suite: "Calculator parity"

Compare target "Local": node dist/server.js
Compare target "QA": https://qa.example.com/mcp

Test: "Addition is consistent"
  Call tool "add" with:
    a: 20
    b: 22
  Expect "structuredContent.sum" equals 42
```

```bash
npx mcprigor parity calculator-parity.mcpr
```

MCP Rigor runs every scenario against both targets and reports semantic differences.

## Create a test from a live server

Provide a small `.mcpr` file containing the target, then run:

```bash
npx mcprigor author server.mcpr --out search-customer.mcpr
```

The guided author discovers operations, asks for inputs, previews a response, and writes a reviewable natural-language test.

## Use data-driven tests

```text
Test: "Calculator examples"
  For each row:
    | caseId | a  | b  | expected |
    | basic  | 2  | 3  | 5        |
    | larger | 20 | 22 | 42       |

  Call tool "add" with:
    a: "${row.a}"
    b: "${row.b}"

  Expect "structuredContent.sum" equals "${row.expected}"
```

CSV, JSON, YAML, Excel, REST, Google Sheets, SQL adapters, typed columns, filters, joins, and deterministic sampling are also supported.

## Use in CI

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npm ci
- run: npx mcprigor check tests/acceptance.mcpr
- run: npx mcprigor test tests/acceptance.mcpr --junit reports/mcp.xml --evidence .mcprigor/ci-run
```

Exit codes:

| Code | Meaning |
|---:|---|
| `0` | Tests passed |
| `1` | A test or comparison failed |
| `2` | Usage, language, or configuration problem |
| `3` | Server, transport, or internal failure |

## Main commands

```text
mcprigor workspace [DIRECTORY]        Start the local QA interface
mcprigor init FILE                    Create an example test
mcprigor check FILE                   Validate without connecting
mcprigor test FILE                    Run natural-language or YAML tests
mcprigor author TARGET --out FILE     Build a test interactively
mcprigor parity FILE                  Compare named targets
mcprigor discover FILE                Save the live MCP contract
mcprigor contract-check LOCK --target FILE
mcprigor evidence-show DIRECTORY
```

See the [complete CLI reference](docs/CLI-REFERENCE.md).

## Choose your next guide

- **New QA user:** [Getting started](docs/GETTING-STARTED.md)
- **Writing scenarios:** [Natural-language cookbook](docs/PLAIN-LANGUAGE-COOKBOOK.md)
- **Using the browser UI:** [QA workspace](docs/QA-WORKSPACE.md)
- **Setting up targets and CI:** [Engineer setup](docs/ENGINEER-SETUP.md)
- **Fixing failures:** [Troubleshooting](docs/TROUBLESHOOTING.md)
- **All documentation:** [Documentation index](docs/README.md)
- **Renaming old files:** [`.mcpr` extension and migration](docs/FILE-EXTENSION.md)

## Scope and safety

MCP Rigor performs black-box behavior and contract testing. It complements MCP Inspector and official MCP Conformance; it does not provide certification.

Remote data and custom extensions are disabled unless explicitly enabled. Reports and evidence are sanitized, but business response data may still be sensitive. Review [security and retention](docs/SECURITY-AND-RETENTION.md) before storing CI artifacts.

## Contributing

See `CONTRIBUTING.md`, then run:

```bash
npm ci
npm run check
```

Apache-2.0 licensed.
