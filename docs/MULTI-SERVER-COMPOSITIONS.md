# Multi-server compositions

> Available on `main`; included in the next npm release after 1.4.0.

Real MCP clients mount several servers together. MCP Rigor compositions test each named server and govern the combined tool, resource, and prompt namespace as one fleet.

## Declare named servers

```text
MCP Test 1
Suite: "Checkout fleet"

Named server "catalog": node services/catalog.js
Named server "billing": https://qa.example.com/billing/mcp

Server options for "billing":
  Token from: node scripts/get-qa-token.mjs

Test: "catalog search works"
  On server "catalog"
  Call tool "search" with:
    query: "widget"
  Expect "structuredContent.total" is a number

Test: "billing responds"
  On server "billing"
  Send "ping"
  Expect it succeeds
```

`On server` routes every action in that test to the selected server. Tests without `On server` continue to use the legacy/default `Server:` or `MCP URL:` target. Cross-test dependencies and exported values continue to work across named servers.

YAML parity:

```yaml
version: 1
name: Checkout fleet
target:
  transport: stdio
  command: node
  args: [services/gateway.js]
servers:
  catalog:
    transport: stdio
    command: node
    args: [services/catalog.js]
  billing:
    transport: streamable-http
    url: https://qa.example.com/billing/mcp
tests:
  - name: catalog search works
    server: catalog
    steps:
      - tool:
          name: search
          arguments: { query: widget }
```

Unknown server names fail validation before a test starts.

## Check the live composition

```bash
mcprigor composition-check tests/fleet.mcpr
```

The check discovers all named servers and reports:

- `MCP-COMP-001`: duplicate tool name;
- `MCP-COMP-002`: conflicting input/output schemas for the same tool (breaking);
- `MCP-COMP-003`: duplicate resource URI or URI template (breaking);
- `MCP-COMP-004`: duplicate prompt name.

MCP Rigor reports collisions; it never silently renames or chooses a winning server.

## Create a combined fleet lock

```bash
mcprigor composition-discover tests/fleet.mcpr \
  --out contracts/checkout.composition.lock.yaml
```

The lock embeds each named server's ordinary discovery contract, the cross-server issue set, and a stable fleet fingerprint. Volatile discovery timestamps and diagnostics do not change the combined fingerprint. Writes are atomic: all servers must be discovered successfully before the previous lock is replaced.

## Gate fleet drift in CI

```bash
mcprigor composition-drift tests/fleet.mcpr \
  --against contracts/checkout.composition.lock.yaml \
  --fail-on breaking
```

The drift report combines:

- server additions and removals;
- each server's tool/resource/prompt contract changes;
- newly introduced or resolved cross-server conflicts.

`--fail-on` accepts `breaking` (default), `potentially-breaking`, `any`, or `none`, matching the single-server drift gate. Add `--json report.json` for machine-readable CI evidence.

## Composition versus parity

Use a **composition** when several servers are mounted together and their namespaces interact. Use **transport parity** when the same logical server is exposed through alternate targets such as local stdio and deployed HTTP. The `servers` and `targets` fields remain intentionally separate.
