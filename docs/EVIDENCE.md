# Protocol Traces and Failure Evidence

MCP Rigor can retain a sanitized, correlated account of a test run:

```bash
mcprigor test tests.mcpr --evidence .mcprigor/run-001
```

This is currently an **MCP SDK/API-boundary trace**, not a raw byte capture. It records what MCP Rigor sends to and receives from the official SDK transport boundary.

## Bundle contents

```text
.mcprigor/run-001/
  manifest.json
  result.json
  trace.jsonl
  trace.normalized.jsonl
```

`trace.jsonl` contains ordered lifecycle, request, response, error, close, and bounded diagnostic events. Each event includes a toolkit-owned sequence, request correlation ID, test ID, step name, method, and sanitized data.

`trace.normalized.jsonl` removes elapsed timing and known volatile values while preserving semantic ordering. Its SHA-256 fingerprint appears in `manifest.json`.

## Inspect and compare

```bash
mcprigor evidence-show .mcprigor/run-001
mcprigor evidence-compare .mcprigor/run-001 .mcprigor/run-002
```

Comparison checks the result and normalized trace fingerprints. Matching fingerprints indicate semantically identical evidence under the current normalization policy.

## Events

- `session.connect.start`
- `session.connect.success`
- `request`
- `response`
- `error`
- `session.close`
- `diagnostic`

Request and terminal response/error events share `requestId`. Test and step fields tie protocol activity back to readable acceptance tests.

## Security

Redaction happens before events enter the recorder. MCP Rigor removes configured secrets, values under credential-shaped keys, and bearer tokens. Reports should still be handled as potentially sensitive because ordinary business data may remain.

Recommended practices:

- store evidence as short-lived CI artifacts;
- do not put tokens or regulated data in assertions/test names;
- review custom function and provider output;
- limit artifact access;
- delete bundles after the investigation or retention period.

The evidence hash is an integrity aid, not a digital signature or legal attestation.
