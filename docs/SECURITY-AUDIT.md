# Deterministic security audit

> Available on `main`; included in the next npm release after 1.4.0.

`mcprigor audit` runs a fixed security and permissions probe pack against an MCP server and produces an auditable score. No AI chooses payloads or interprets outcomes.

## Run the safe default pack

Use a suite's configured target:

```bash
mcprigor audit tests/server.mcpr
```

Or supply a target directly:

```bash
mcprigor audit --url https://qa.example.com/mcp
mcprigor audit --command "node dist/server.js"
```

The non-destructive default probes:

| Probe | What MCP Rigor verifies |
|---|---|
| Malformed parameters | Invalid `tools/call` parameters are rejected |
| Tool-name spoofing | An unknown administrative-looking tool cannot be invoked |
| Oversized payload | A deterministic 1 MiB payload is rejected |
| Path traversal | Resource reads reject Unix, Windows, and relative traversal URIs |
| Tool inventory | Advertised tools are listed for opt-in injection/canary testing |

## Opt into reviewed tool calls

MCP Rigor never guesses that a tool is safe. Tool execution is disabled unless you allow an exact name:

```bash
mcprigor audit tests/server.mcpr \
  --allow-tool search \
  --allow-tool summarize
```

Only allow read-only, non-destructive tools in a disposable test environment. An allowed tool receives a fixed prompt-injection payload containing a deterministic canary. MCP Rigor checks whether the response follows or reflects the payload and whether it exposes the canary. Report evidence replaces the canary with `[CANARY REDACTED]`.

## CI severity gate

```bash
mcprigor audit tests/server.mcpr --fail-on high
```

Values are `critical`, `high`, `medium`, `low`, and `none`; the default is `high`. The command exits nonzero when a failed finding meets or exceeds the selected severity.

Scoring starts at 100:

- critical: −35
- high: −20
- medium: −10
- low: −4
- skipped: no deduction

Skipped probes remain visible with the exact `--allow-tool` needed. They are not represented as passes.

## Reports

```bash
mcprigor audit tests/server.mcpr \
  --pdf reports/security.pdf \
  --json reports/security.json \
  --csv reports/security.csv
```

The rich PDF includes score, grade, severity cards, per-finding status, explanations, and bounded evidence. Markdown output is available with `--markdown`.

## Interpreting results

The audit is deterministic black-box evidence, not a certification or a replacement for threat modeling. A passing probe proves the observed server rejected that exact payload under that exact configuration. Review skipped probes, environment permissions, downstream model behavior, and business authorization separately.

Run intrusive tool probes only in an isolated environment. Do not expose production mutation tools through `--allow-tool`.
