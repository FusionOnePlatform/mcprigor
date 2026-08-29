# MCP Rigor documentation

Choose the path that matches your role.

## QA authors

1. [Getting started](GETTING-STARTED.md) — install, connect, and run your first test.
2. [Plain-language cookbook](PLAIN-LANGUAGE-COOKBOOK.md) — copy-ready scenarios and assertions.
3. [QA workspace](QA-WORKSPACE.md) — edit and run tests in a browser.
4. [Data and reusable flows](DATA-AND-REUSE.md) — tables, files, functions, and shared flows.
5. [Troubleshooting](TROUBLESHOOTING.md) — understand errors and fix common failures.

## Test and platform engineers

- [Engineer setup](ENGINEER-SETUP.md) — targets, credentials, project layout, and CI.
- [CLI reference](CLI-REFERENCE.md) — commands, options, outputs, and exit codes.
- [Language reference](LANGUAGE-SPEC.md) — complete deterministic `.mcpr` syntax.
- [File extension and migration](FILE-EXTENSION.md) — why MCP Rigor uses `.mcpr`.
- [State and dependencies](STATE-AND-DEPENDENCIES.md) — share outputs across tests and runs.
- [Data engineering](DATA-ENGINEERING.md) — types, filters, joins, samples, and caches.
- [Transport parity](TRANSPORT-PARITY.md) — compare stdio and Streamable HTTP.

## Contracts and evidence

- [Contract drift](CONTRACT-DRIFT.md)
- [Protocol evidence](EVIDENCE.md)
- [Snapshots and replay](SNAPSHOTS-AND-REPLAY.md)
- [MCP-native behavior](MCP-NATIVE.md)

## Extensions and operations

- [Extension SDK](EXTENSION-SDK.md)
- [Stable error model](ERROR-MODEL.md)
- [Security and retention](SECURITY-AND-RETENTION.md)
- [Compatibility policy](COMPATIBILITY.md)

## Project background

These documents explain product design and research rather than everyday usage:

- [Specification](SPECIFICATION.md)
- [Competitive landscape](LANDSCAPE.md)

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
