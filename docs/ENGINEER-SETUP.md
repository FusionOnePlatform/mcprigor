# Engineer setup and CI

This guide covers the configuration engineers normally prepare once so QA authors can focus on scenarios.

## Install and pin

MCP Rigor is published on npm as [`mcprigor`](https://www.npmjs.com/package/mcprigor) and ships compiled code — teams and CI never build it from source.

```bash
npm install --save-dev mcprigor
```

For reproducible CI runs, pin an exact version in `package.json` and update it deliberately:

```json
{ "devDependencies": { "mcprigor": "1.1.0" } }
```

Release notes and tarball checksums for each version are on the [GitHub releases page](https://github.com/FusionOnePlatform/mcprigor/releases).

## Recommended repository layout

```text
acceptance-tests/
  package.json
  tests/
    smoke.mcpr
    regression.mcpr
    parity.mcpr
    shared-flows.mcpr
    data/
  reports/
  .mcprigor/
```

Add generated evidence and local reports to `.gitignore` unless your policy requires versioning them:

```gitignore
.mcprigor/
reports/
*.snap.actual.json
```

Commit contract locks and approved snapshot expectations when they are part of review.

## Configure a stdio target

```text
MCP Test 1
Suite: "Customer acceptance tests"
Server: node ../customer-server/dist/server.js

Server options:
  cwd: ../customer-server
  env:
    NODE_ENV: test
```

MCP Rigor starts the command without a shell. Keep server shutdown deterministic and ensure descendants exit when stdin closes or the parent terminates.

## Configure Streamable HTTP

```text
MCP URL: https://qa.example.com/mcp

Server options:
  headers:
    Authorization: "Bearer ${env.MCP_TOKEN}"
```

Provide secrets through CI variables:

```bash
MCP_TOKEN="$QA_MCP_TOKEN" npx mcprigor test tests/smoke.mcpr
```

## Give QA authors stable operations

Prefer:

- clear tool and argument descriptions;
- structured output for business assertions;
- stable resource URIs;
- deterministic fixture data;
- test-only cleanup operations;
- generated IDs returned in explicit fields;
- server errors with actionable MCP messages.

Avoid requiring QA users to assert entire text blobs or volatile metadata.

## Add package scripts

```json
{
  "scripts": {
    "mcp:check": "mcprigor check tests/smoke.mcpr",
    "mcp:test": "mcprigor test tests/smoke.mcpr",
    "mcp:report": "mcprigor test tests/regression.mcpr --html reports/mcp.html",
    "mcp:parity": "mcprigor parity tests/parity.mcpr"
  }
}
```

## GitHub Actions

```yaml
name: MCP acceptance tests

on:
  pull_request:
  push:
    branches: [main]

jobs:
  mcp-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run mcp:check
      - run: >-
          npx mcprigor test tests/regression.mcpr
          --junit reports/mcp.xml
          --evidence .mcprigor/ci-${{ github.run_id }}
        env:
          MCP_TOKEN: ${{ secrets.QA_MCP_TOKEN }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: mcp-evidence
          path: |
            reports/
            .mcprigor/
          retention-days: 7
```

## Contract drift in pull requests

Create a baseline once:

```bash
mcprigor discover tests/server.mcpr --out mcp.lock.yaml
```

Then check it in CI:

```bash
mcprigor contract-check mcp.lock.yaml \
  --target tests/server.mcpr \
  --markdown \
  --out reports/contract-drift.md
```

Update a baseline only after review:

```bash
mcprigor contract-update mcp.lock.yaml --target tests/server.mcpr
```

## Transport parity

Engineers configure connections once:

```text
Compare target "Local": node ../server/dist/server.js
Compare target "QA": https://qa.example.com/mcp
```

QA authors then add ordinary tests. CI runs:

```bash
mcprigor parity tests/parity.mcpr --markdown --out reports/parity.md
```

## Production adoption checklist

- Pin MCP Rigor and the MCP SDK through the lockfile.
- Run `check` before server execution.
- Use dedicated nonproduction accounts and data.
- Set explicit CI timeouts and row limits.
- Keep remote data and extensions disabled unless required.
- Define contract-drift approval ownership.
- Set evidence access, retention, and deletion rules.
- Verify each required Node, OS, protocol, and transport combination.
- Test one intentional failure and server-shutdown path.

See [compatibility](COMPATIBILITY.md) and [security and retention](SECURITY-AND-RETENTION.md).
