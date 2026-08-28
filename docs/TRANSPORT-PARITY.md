# Transport Parity Testing

MCP Rigor can execute the same acceptance suite against named stdio and Streamable HTTP targets, then compare normalized behavior test by test.

## Plain-language parity for QA teams

Create `calculator-parity.mcpr`:

```text
MCP Test 1

Suite: "Calculator behaves the same everywhere"

Compare target "Local": node server.js
Compare target "QA environment": https://qa.example.com/mcp

Test: "Adding 20 and 22 gives 42"
  Id: adding-numbers

  Call tool "add" with:
    a: 20
    b: 22

  Expect "structuredContent.sum" equals 42

Test: "The service status is ready"
  Id: service-status

  Read resource "service://status"
  Expect "contents[0].text" contains "ready"
```

Run it exactly like a YAML parity suite:

```bash
mcprigor parity calculator-parity.mcpr
```

The `Compare target` lines are usually configured once by an engineer. QA authors only add ordinary `Test`, `Call tool`, `Read resource`, and `Expect` statements. Each test automatically runs against every named target.

A target value beginning with `http://` or `https://` is Streamable HTTP. Any other value is parsed as a stdio command.

## YAML alternative

Automation engineers may also use the structured YAML representation:

```yaml
version: 1
name: Calculator parity

target: &default
  transport: stdio
  command: node
  args: [server.js]

targets:
  stdio:
    transport: stdio
    command: node
    args: [server.js]
  deployed:
    transport: streamable-http
    url: https://staging.example.com/mcp

tests:
  - id: add
    name: Addition is consistent
    steps:
      - tool:
          name: add
          arguments: { a: 20, b: 22 }
        assert:
          json:
            path: $.structuredContent.sum
            equals: 42
```

Run the matrix:

```bash
mcprigor parity parity.yaml
mcprigor parity parity.yaml --markdown --out parity.md
```

The first named target is the baseline. Every target runs independently with a fresh MCP session. MCP Rigor compares:

- test status;
- step status and MCP method;
- normalized response structures;
- captured/exported outputs.

It excludes durations, elapsed times, timestamps, session IDs, and `_meta` transport details. Application response fields are not ignored.

A divergent test includes a deterministic path-level semantic diff. The command exits `1` when any target differs.

## Scope

Parity means equivalent observable behavior under the selected tests. It does not prove byte-level transport equivalence, identical concurrency behavior, network reliability, authentication parity, or production infrastructure correctness.
