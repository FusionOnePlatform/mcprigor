# MCP Rigor documentation

Choose the path that matches your role.

## QA authors

1. [Getting started](GETTING-STARTED.md) — install, connect, and run your first test.
2. [Natural-language cookbook](NATURAL-LANGUAGE-COOKBOOK.md) — copy-ready scenarios and assertions.
3. [QA workspace](QA-WORKSPACE.md) — edit and run tests in a browser.
4. [Data and reusable flows](DATA-AND-REUSE.md) — tables, files, functions, and shared flows.
5. [Troubleshooting](TROUBLESHOOTING.md) — understand errors and fix common failures.

## Test and platform engineers

- [Engineer setup](ENGINEER-SETUP.md) — targets, credentials, project layout, and CI.
- [Authentication and secrets](AUTHENTICATION.md) — test protected servers with bearer tokens, API keys, OAuth, and `${env.NAME}` placeholders.
- [CLI reference](CLI-REFERENCE.md) — commands, options, outputs, and exit codes.
- [Language reference](LANGUAGE-SPEC.md) — complete deterministic `.mcpr` syntax, in enforced parity with YAML via `mcprigor convert`.
- [State and dependencies](STATE-AND-DEPENDENCIES.md) — share outputs across tests and runs.
- [Data engineering](DATA-ENGINEERING.md) — types, filters, joins, samples, and caches.
- [Transport parity](TRANSPORT-PARITY.md) — compare stdio and Streamable HTTP.
- [Performance governance](PERFORMANCE-GOVERNANCE.md) — call limits, percentile budgets, and regression gates.
- [Multi-server compositions](MULTI-SERVER-COMPOSITIONS.md) — route tests across a fleet and gate combined drift.
- [Coverage](COVERAGE.md) — find untested MCP surfaces and input-schema branches.
- [Scheduled monitoring](MONITORING.md) — continuously test production HTTP endpoints and notify webhooks.
- [GitHub Action](GITHUB-ACTION.md) — test, drift, flaky warnings, and rich pull-request comments.
- [Shareable hosted reports](PUBLISHING.md) — `mcprigor publish` turns a run into a static report URL.

## Contracts and evidence

- [Contract drift](CONTRACT-DRIFT.md)
- [Protocol evidence](EVIDENCE.md)
- [Snapshots and replay](SNAPSHOTS-AND-REPLAY.md)
- [MCP-native behavior](MCP-NATIVE.md)

## Extensions and operations

- [Extension SDK](EXTENSION-SDK.md)
- [Stable error model](ERROR-MODEL.md)
- [Deterministic security audit](SECURITY-AUDIT.md) — built-in probe pack, severity gate, and rich reports.
- [Security and retention](SECURITY-AND-RETENTION.md)
- [Compatibility policy](COMPATIBILITY.md)

## Project background

These documents explain product design and research rather than everyday usage:


## Fastest adoption path

```text
install → create .mcpr test → check → test → add CI → enable evidence
```

```bash
npm install mcprigor
npx mcprigor init tests/acceptance.mcpr
npx mcprigor check tests/acceptance.mcpr
npx mcprigor test tests/acceptance.mcpr --html report.html
```
- [MCP server for AI agents](MCP-SERVER.md) — let coding agents write, validate, and run tests over MCP.
