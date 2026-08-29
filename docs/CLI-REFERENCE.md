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
