# Contract Drift Analysis

MCP Rigor explains how a live MCP surface changed instead of only reporting a different fingerprint.

## Check a lock against a live server

```bash
mcprigor contract-check mcp.lock.yaml --target server.mcpr
```

This is read-only. It discovers the server, compares it with the lock, and exits with status `1` when breaking changes exist.

Markdown for a pull-request comment:

```bash
mcprigor contract-check mcp.lock.yaml --target server.mcpr --markdown --out contract-drift.md
```

## Offline comparison

```bash
mcprigor contract-diff old.lock.yaml new.lock.yaml
mcprigor contract-diff old.lock.yaml new.lock.yaml --markdown
```

## Explicit update

```bash
mcprigor contract-update mcp.lock.yaml --target server.mcpr
```

The diff is displayed before the newly discovered contract replaces the lock. Review breaking changes before committing it.

## Classifications

**Breaking:** an operation or capability was removed; a required input was added; a known property was removed; a type changed; an enum option was removed; or a required prompt argument was added.

**Potentially breaking:** protocol version, description, or ambiguous output/schema behavior changed.

**Non-breaking:** an operation/capability was added; an optional input was added; a required input became optional; or an enum option was added.

Findings use stable `MCP-DRIFT-*` codes and deterministic ordering. Complex JSON Schema implication is classified conservatively rather than overstating compatibility. Contract drift is application compatibility evidence, not formal MCP certification.
