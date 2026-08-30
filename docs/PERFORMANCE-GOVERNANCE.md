# Performance governance

> Available since `1.5.0`.

MCP Rigor turns MCP latency into a deterministic release gate. It supports immediate per-call limits, percentile budgets over recorded history, and automatic regression detection against each test's historical baseline.

## Limit one call

Add a latency assertion after an action:

```text
Test: "order lookup stays interactive"
  Call tool "find_order" with:
    orderId: "A-1001"
  Expect the call to finish within 800ms
```

The measured duration covers the live MCP request and response. A call over the limit fails with `MCP-PERF-001` and reports the measured and allowed duration.

YAML parity:

```yaml
- tool:
    name: find_order
    arguments:
      orderId: A-1001
  assert:
    maxDurationMs: 800
```

## Set percentile budgets

A percentile budget uses successful durations from recent recorded runs plus the current run:

```text
Budget: p95 500ms over 20 calls
Budget for "order lookup stays interactive": p50 300ms over 20 calls
```

- A suite-wide budget applies independently to every test.
- A named budget applies only to that test.
- MCP Rigor uses the deterministic nearest-rank percentile.
- Fewer than three usable samples reports the budget as pending instead of guessing.
- A measured percentile over budget fails the CLI run.

YAML parity:

```yaml
budgets:
  - test: "*"
    percentile: 95
    maxMs: 500
    window: 20
  - test: order lookup stays interactive
    percentile: 50
    maxMs: 300
    window: 20
```

## Fail on regression without maintaining thresholds

```bash
mcprigor test tests/orders.mcpr --fail-on-regression
```

For every successful test, MCP Rigor compares the current duration with the median of its latest successful history. The gate requires at least five samples and reports a regression when the current run exceeds both:

- 1.5× the historical median; and
- the historical median plus 50 ms.

The absolute floor prevents very small tests from failing because of ordinary scheduler jitter.

## CI example

```yaml
- run: npx mcprigor test tests/orders.mcpr --fail-on-regression --junit reports/orders.xml
```

Explicit budgets answer “is this fast enough?” The regression gate answers “did this release make it materially slower?” Teams commonly use both.

## History source

CLI, QA workspace, and MCP-server-driven test runs append to `.mcprigor/workspace-history.jsonl`. The same data powers `mcprigor trends`, CSV/PDF trend exports, flaky detection, percentile budgets, and regression baselines.

Commit the test and its budget declarations. Treat history as a CI artifact or retained workspace file according to your evidence policy.
