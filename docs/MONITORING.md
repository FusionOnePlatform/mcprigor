# Scheduled production monitoring

> Available since `1.5.0`.

Turn an HTTP MCP suite into a continuous production check:

```bash
mcprigor monitor tests/prod.mcpr \
  --every 15m \
  --notify https://alerts.example.com/hooks/mcprigor
```

The monitor runs immediately, then at the fixed interval until stopped. Durations accept `ms`, `s`, `m`, or `h`, with a minimum interval of one second.

For operational safety, monitoring requires a Streamable HTTP target. It refuses stdio suites so a long-running process cannot repeatedly spawn local commands by accident.

## Notification policies

```bash
mcprigor monitor tests/prod.mcpr --every 5m --notify URL --notify-on change
```

`--notify-on` supports:

- `change` (default): first failure, then failure/recovery transitions;
- `failure`: every failed run;
- `recovery`: transitions from failed to passed;
- `always`: every run.

Webhook requests are JSON POSTs with a 15-second timeout:

```json
{
  "source": "mcprigor",
  "event": "monitor.failure",
  "suite": "tests/prod.mcpr",
  "run": 12,
  "status": "failed",
  "startedAt": "2026-08-30T12:00:00.000Z",
  "durationMs": 842,
  "summary": { "passed": 7, "failed": 1, "skipped": 0, "blocked": 0 },
  "failures": [{ "name": "order lookup", "error": "..." }]
}
```

A non-2xx webhook response fails the monitor with `MCP-MONITOR-003`; notification loss is never silently ignored.

## History and trends

Every monitoring run appends to `.mcprigor/workspace-history.jsonl`, so existing `mcprigor trends`, PDF/CSV exports, flaky detection, latency budgets, and regression analysis include production monitoring evidence.

## Bounded runs

For smoke tests, cron jobs, and CI validation:

```bash
mcprigor monitor tests/prod.mcpr --every 1m --max-runs 1
```

`SIGINT` and `SIGTERM` stop the interval cleanly after active MCP sessions shut down.

Use an authenticated suite target (`headers` or `Token from:`), retain history according to your evidence policy, and send webhooks only to reviewed HTTPS endpoints.
