# MCP-Native Behavior Testing

MCP Rigor 0.10 extends deterministic request/response testing to asynchronous and client-side MCP behavior.

## Notifications

```text
Wait for notification "notifications/resources/updated" within 5 seconds
Expect "params.uri" equals "fixture://status"
```

Supported official notification handlers include:

- progress
- resource updated and resource list changed
- tool and prompt list changed
- logging messages
- task status

Events receive deterministic session-local sequence numbers and are available to the evidence recorder.

## Resource subscriptions

```text
Subscribe to resource "fixture://status"
Call tool "change_status"
Wait for notification "notifications/resources/updated" within 5 seconds

Cleanup:
Unsubscribe from resource "fixture://status"
```

The server must declare resource subscription capability.

## Progress and cancellation

```text
Call tool "import_catalog" with progress with:
  file: "catalog.csv"

Expect "progress" has 2 items
```

Cancellation can be configured in YAML/JSON native steps with `cancelAfterMs`. Cancellation uses `AbortSignal`, distinguishing it from request timeout.

## Pagination

```text
List all tools
Expect "items" has 20 items
```

Equivalent statements exist for resources, prompts, and resource templates. MCP Rigor follows `nextCursor` until absent and fails on repeated cursors.

## Logging

```text
Set log level to "debug"
Wait for notification "notifications/message" within 5 seconds
```

## Roots, sampling, and elicitation

YAML/JSON suites can configure deterministic client behavior:

```yaml
client:
  roots:
    - uri: file:///workspace
      name: Workspace
  sampling:
    model: fixture-model
    text: deterministic response
  elicitation:
    action: accept
    content:
      approved: true
```

The SDK client advertises roots, sampling, and elicitation capabilities and installs handlers using official schemas. No real model is called and no human UI is invoked during deterministic runs.

## Experimental tasks

Native requests can stream task-aware tool calls through the SDK experimental task API. Generic task operations are also available:

- `tasks/get`
- `tasks/list`
- `tasks/cancel`

Task support remains explicitly experimental and SDK-version-sensitive. MCP Rigor records intermediate task events but does not claim to validate persistence or recovery across separate server processes.

## Boundary of coverage

Fully testable at the SDK boundary:

- notification registration and delivery
- progress callbacks
- AbortSignal cancellation
- subscriptions
- logging level and messages
- roots requests
- deterministic sampling responses
- form elicitation responses
- cursor pagination

Not claimed:

- actual LLM response quality
- human elicitation UI behavior
- task durability across infrastructure failures
- raw transport framing or reconnect behavior
