# CLI reference

Use `npx mcprigor` when installed locally. Examples below use `mcprigor` for brevity.

## Create and author tests

### `init`

```bash
mcprigor init tests/acceptance.mcpr
mcprigor init tests/acceptance.mcpr --force
```

Creates an editable plain-language example. Existing files are protected unless `--force` is supplied.

### `author`

```bash
mcprigor author server.mcpr --out tests/customer.mcpr
```

Connects to the target in `server.mcpr` and guides you through creating a test.

## Validate and run

### `check`

```bash
mcprigor check tests/acceptance.mcpr
```

Validates language and configuration without connecting to the server. Alias: `validate`.

### `test`

```bash
mcprigor test tests/acceptance.mcpr
```

Aliases: `run`, for YAML/JSON compatibility.

Common options:

```text
--test "pattern*"          Run matching tests
--command "node server.js" Override the suite's declared server target
--url https://qa.example.com/mcp
                           Override with a Streamable HTTP endpoint
--watch                    Rerun automatically when files change
--github-annotations       Emit ::error/::notice workflow commands
                           (automatic when GITHUB_ACTIONS=true;
                           disable with --no-github-annotations)
--html report.html         Write a readable HTML report
--json result.json         Write structured JSON
--junit result.xml         Write JUnit XML
--evidence DIRECTORY       Save a sanitized evidence bundle
--snapshot FILE            Verify semantic snapshots
--update-snapshots         Explicitly create/update snapshots
--state-in FILE            Load persisted successful outputs
--state-out FILE           Save successful exported outputs
--max-rows NUMBER          Limit expanded data rows
--allow-remote-data        Enable REST and Google Sheets data
--allow-custom-code        Enable reviewed isolated extensions
```

Example CI run:

```bash
mcprigor test tests/acceptance.mcpr \
  --junit reports/mcp.xml \
  --evidence .mcprigor/ci-run
```

## Browser workspace

```bash
mcprigor workspace
mcprigor workspace ./acceptance-tests
mcprigor workspace ./acceptance-tests --port 4173
```

Starts a loopback-only QA interface. Alias: `web`.

## Transport parity

```bash
mcprigor parity tests/parity.mcpr
mcprigor parity tests/parity.mcpr --markdown
mcprigor parity tests/parity.mcpr --markdown --out parity.md
```

The suite must contain at least two `Compare target` declarations.

## Discovery and contracts

### Discover

```bash
mcprigor discover server.mcpr --out mcp.lock.yaml
```

Saves the server identity, capabilities, tools, resources, prompts, and fingerprint.

### Generate contract tests

```bash
mcprigor generate mcp.lock.yaml --target server.mcpr --out generated.yaml
```

### Check drift

```bash
mcprigor contract-check mcp.lock.yaml --target server.mcpr
mcprigor contract-check mcp.lock.yaml --target server.mcpr --markdown --out drift.md
```

Returns `1` when breaking drift exists.

### Compare locks

```bash
mcprigor contract-diff old.lock.yaml new.lock.yaml
mcprigor contract-diff old.lock.yaml new.lock.yaml --markdown
```

### Update a lock

```bash
mcprigor contract-update mcp.lock.yaml --target server.mcpr
```

Review the printed changes before committing the updated lock.

## Record a session

```bash
mcprigor record --out draft.mcpr -- node dist/server.js
```

Proxies a live MCP stdio session: your client (an agent, MCP Inspector's CLI mode, or any harness) talks to `mcprigor record` on stdin/stdout, and Rigor forwards everything to the real server while logging each `tools/call` exchange. When the session ends it writes a reviewable `.mcpr` draft — one test per call, with deterministic assertions picked from the actual responses (up to three scalar `structuredContent` leaves, falling back to short text content). No AI: the draft is a literal transcription. Review it, prune it, and run it.

## Project environments

Define shared targets once in `mcprigor.config.yaml` (found in the working directory or any parent):

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

Then select one per run:

```bash
mcprigor test suite.mcpr --env qa
mcprigor drift suite.mcpr --against mcp.lock.yaml --env prod
```

The selected environment replaces the suite's declared target and is announced in the output. With a `default:` set, plain `mcprigor test suite.mcpr` uses it automatically. `--command`/`--url` overrides still win over the environment when both are given. An environment value can be a command string, a URL string, or a mapping with `server`/`cwd`/`env` (stdio) or `url`/`headers`/`token from` (HTTP).

## Drift gate and flakiness

CI gate for contract drift:

```bash
mcprigor drift suite.mcpr --against mcp.lock.yaml --fail-on breaking
```

Compares the lock file against the live server the suite declares and classifies every change as breaking, potentially breaking, or non-breaking. `--fail-on` controls the gate: `breaking` (default), `potentially-breaking`, `any`, or `none` (report only). `--json out.json` writes the structured diff; `--markdown` renders for PR comments. In GitHub Actions each change becomes an `::error`/`::warning`/`::notice` annotation automatically.

Detect flaky tests from recorded run history:

```bash
mcprigor flaky [DIRECTORY] [--window 200] [--json out.json]
```

A test is flaky when its pass/fail outcome flips between runs of the same suite. CLI runs, the QA workspace, and `mcprigor serve` all record history under `.mcprigor/workspace-history.jsonl`. Exit code 1 when flaky tests are found. Pair with:

```bash
mcprigor test suite.mcpr --retries 2      # retry failures up to 2 times
mcprigor test suite.mcpr --quarantine     # skip tests listed in .mcprigor/quarantine.txt
```

Quarantine file format: one `suite.mcpr :: test name` per line, `#` comments allowed. Tests that pass only on retry are marked `retried` in JSON reports so hidden flakiness stays visible.

## Evidence

```bash
mcprigor evidence-show .mcprigor/run-001
mcprigor evidence-compare .mcprigor/run-001 .mcprigor/run-002
```

## Snapshots and replay

```bash
mcprigor snapshot-diff old.json new.json
```

```bash
mcprigor replay .mcprigor/run-001/trace.normalized.jsonl \
  --target server.mcpr
```

Tool calls are denied during replay unless explicitly approved:

```bash
mcprigor replay trace.normalized.jsonl \
  --target server.mcpr \
  --allow-tool find_customer
```

`--allow-tool` may be repeated.

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | Success |
| `1` | Test, snapshot, parity, replay, or breaking-drift failure |
| `2` | Invalid usage, language, or configuration |
| `3` | Server, transport, extension, or internal failure |
| `130` | Interrupted by the user |

## Safety flags

`--allow-remote-data` and `--allow-custom-code` are intentionally explicit. Do not add them automatically in shared scripts. Review the source and required permissions first.
