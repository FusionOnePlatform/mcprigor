# Authentication and secrets

MCP Rigor connects to two kinds of targets. **Local stdio** servers are launched by MCP Rigor as a subprocess, so they are not "protected" in the network sense — you control the process and its environment. **Streamable HTTP** servers are deployed endpoints that usually sit behind authentication: a bearer token, an API key, or a short-lived OAuth token.

This page covers how to test an authenticated Streamable HTTP server. One rule underpins everything here:

> Secrets never live in a test file. They come from the environment or a fetch command, and they are redacted before any report or evidence bundle exists.

## The `${env.NAME}` placeholder

Any string value in a target block — the URL, a header, an `env` entry, any `Server options` field — may contain `${env.NAME}` placeholders. Before the suite connects, each placeholder is replaced with the value of the operating-system environment variable `NAME`.

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

Rules:

- The syntax is exactly `${env.NAME}`. `NAME` is a literal environment-variable name. There is no shell, no command substitution, and no default-value syntax.
- A placeholder may sit inside a larger string (`"Bearer ${env.QA_TOKEN}"`) or be the whole value (`"${env.API_KEY}"`), and one value may contain several placeholders.
- If `NAME` is not set, the run stops immediately with `Environment variable not found: NAME`. It never sends an empty header or a half-substituted URL.
- Header values are registered with the redactor automatically, so a resolved token never appears in reports, evidence bundles, or published URLs.

## 1. Static bearer token

The most common case — a fixed token issued for the test environment:

```text
MCP URL: https://qa.example.com/mcp

Server options:
  headers:
    Authorization: "Bearer ${env.QA_TOKEN}"
```

```bash
QA_TOKEN=$QA_MCP_TOKEN mcprigor test tests/smoke.mcpr
```

## 2. API keys and custom headers

Any header works the same way. Static values need no placeholder; secret values use one:

```text
MCP URL: https://qa.example.com/mcp

Server options:
  headers:
    X-Api-Key: "${env.API_KEY}"
    X-Tenant: "acme"
```

## 3. Short-lived and OAuth tokens (`Token from`)

When the token is short-lived — an OAuth client-credentials exchange, a cloud CLI, a vault read — let the suite fetch it at run time with `Token from`. The command runs once before the suite connects; its stdout (a single token) becomes the `Authorization: Bearer …` header.

```text
MCP URL: https://qa.example.com/mcp
Server options:
  Token from: node scripts/get-token.mjs
```

The command can do anything — call your identity provider, read a keychain, exchange client credentials — as long as it prints exactly one whitespace-free token. If it fails or prints nothing, the run stops with `MCP-AUTH-002` before any test executes. The fetched token is auto-redacted from every report and evidence bundle.

You can also do the exchange yourself in the step before the run and pass the result through the environment:

```bash
QA_TOKEN=$(curl -s -X POST https://auth.example.com/oauth/token \
  -d grant_type=client_credentials \
  -d client_id="$CLIENT_ID" -d client_secret="$CLIENT_SECRET" | jq -r .access_token)
QA_TOKEN=$QA_TOKEN mcprigor test orders.mcpr
```

## 4. Define auth once with project environments

So QA authors never handle credentials, engineers usually define targets once in `mcprigor.config.yaml` (found in the working directory or any parent). Headers and `token from` are supported per environment:

```yaml
default: dev
environments:
  dev: node dist/server.js
  qa:
    url: https://qa.example.com/mcp
    token from: node scripts/get-token.mjs
  prod:
    url: https://api.example.com/mcp
    headers:
      Authorization: "Bearer ${env.PROD_TOKEN}"
```

QA authors then write ordinary tests and select a target per run:

```bash
mcprigor test suite.mcpr --env qa
```

## Auth on other target surfaces

The same `headers` and `Token from` grammar applies wherever a target is declared:

- **Multi-server compositions** — `Server options for "billing"` sets per-server headers across a mounted fleet.
- **Transport parity** — `Target options for "QA"` lets an open local build and a protected deployment run the same scenario:

```text
Compare target "Local": node dist/server.js
Compare target "QA": https://qa.example.com/mcp

Target options for "QA":
  headers:
    Authorization: "Bearer ${env.QA_TOKEN}"
```

## Continuous integration

Inject secrets through the CI provider's secret store — nothing about auth changes between local, CI, and monitoring runs:

```yaml
- name: Acceptance tests
  env:
    QA_TOKEN: ${{ secrets.QA_MCP_TOKEN }}
  run: npx mcprigor test tests/*.mcpr
```

## What is out of scope

MCP Rigor does not run an interactive browser-redirect OAuth authorization-code flow itself. An acceptance run must be repeatable without a human in the loop, so the expected pattern is to obtain the token non-interactively — a client-credentials exchange, a service account, or a `Token from` helper — and let MCP Rigor consume the result.

## Troubleshooting

- `Environment variable not found: NAME` — the referenced variable is unset in the process that ran MCP Rigor. Export it or pass it inline.
- `MCP-AUTH-001` — the `Token from` command was empty.
- `MCP-AUTH-002 Token from command failed` — the fetch command errored, printed nothing, or printed more than a single token. See [Troubleshooting](TROUBLESHOOTING.md).
- A `401`/`unauthorized` body in a failure message means the request reached the server but the token was rejected — check its value and expiry.

## Related

- [Language reference](LANGUAGE-SPEC.md) — full target grammar and the `${env.NAME}` rules.
- [Engineer setup & CI](ENGINEER-SETUP.md) — configuring targets and CI secrets for a team.
- [Natural-language cookbook](NATURAL-LANGUAGE-COOKBOOK.md) — copy-ready authenticated-server recipes.
