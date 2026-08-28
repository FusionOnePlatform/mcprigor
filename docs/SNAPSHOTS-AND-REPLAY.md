# Semantic Snapshots, Diffs, and Replay

## Snapshots

Add a plain-language snapshot assertion to the latest action:

```text
Call tool "get_customer" with:
  id: "123"

Expect "structuredContent" matches snapshot "customer"
```

Create or explicitly update snapshots:

```bash
mcprigor test customer.mcpr --snapshot customer.snap.json --update-snapshots
```

Verify without modifying the file:

```bash
mcprigor test customer.mcpr --snapshot customer.snap.json
```

Missing or changed snapshots fail unless `--update-snapshots` is present. Snapshot names are namespaced by test ID.

YAML/JSON suites may ignore volatile paths:

```yaml
snapshots:
  file: customer.snap.json
  ignore:
    - $.generatedAt
```

Or on one assertion:

```yaml
snapshot:
  name: customer
  ignore: [$.id, $.createdAt]
```

Ignored array positions are removed from the owned snapshot copy; application fields are never ignored automatically.

## Semantic diffs

Snapshot failures report path-level additions, removals, and replacements:

```text
- $.status: "created"
+ $.status: "pending"
+ $.metadata.region: "us-east"
```

Compare two JSON artifacts directly:

```bash
mcprigor snapshot-diff expected.json actual.json
```

Objects are compared by sorted keys and arrays by index. Equality remains type-sensitive.

## Replay

Replay request events from an MCP Rigor trace against a trusted target configuration:

```bash
mcprigor replay .mcprigor/run-1/trace.normalized.jsonl --target server.mcpr
```

Replay always creates a fresh MCP connection and initialization handshake. It never executes commands or URLs from the trace.

Safe read/list methods are allowed by default. Tool calls are denied unless each exact tool is approved:

```bash
mcprigor replay trace.normalized.jsonl \
  --target server.mcpr \
  --allow-tool get_customer
```

Requests execute sequentially. Responses are compared semantically with their recorded correlated response. Changed responses return a path-level diff and exit status `1`.

Replay is an API-boundary semantic check, not a simulation of original timing, concurrency, transport bytes, notifications, or external system state.
