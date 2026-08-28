# Passing Outputs Between Tests and Runs

MCP Rigor keeps tests isolated by default. Sharing must be explicit, so test ordering remains understandable.

## Export an output

```text
Test: "Create customer"
  Id: create-customer

  Call tool "create_customer" with:
    name: "Alice"

  Export "structuredContent.id" as "customerId"
```

An export is captured only after the action and its expectations pass. A missing exported field fails the producer test.

## Depend on the producer

```text
Test: "Retrieve customer"
  Id: retrieve-customer
  Depends on: create-customer

  Call tool "get_customer" with:
    id: "${deps.create-customer.customerId}"

  Expect "structuredContent.name" equals "Alice"
```

MCP Rigor builds a dependency graph and runs producers first, regardless of file order.

Rules:

- IDs must be unique.
- Unknown and circular dependencies fail before any server session opens.
- All dependencies must pass.
- If one fails, skips, or is blocked, the consumer is marked **blocked** and its MCP session is never opened.
- Outputs remain namespaced under the producer ID.
- Tests without dependencies remain isolated.

## Data-driven producers

Each row has an ID such as `create-customers.us`. Depending on `create-customers` waits for all rows. The consumer receives each exported output as a list in row order:

```text
Test: "Count all customers"
  Depends on: create-customers

  Call tool "verify_ids" with:
    ids: "${deps.create-customers.customerId}"
```

A failed row blocks the consumer. Depending on one exact row ID is also supported.

## Persist across separate CLI runs

First run:

```bash
mcprigor test create.mcpr --state-out customer-state.json
```

A state file is written only when the entire run passes. It contains:

- format version
- creation time
- target fingerprint
- suite fingerprint
- exported outputs
- integrity fingerprint

The file is written atomically with owner-only permissions where supported.

Later run:

```bash
mcprigor test retrieve.mcpr --state-in customer-state.json
```

Use values through the read-only `state` namespace:

```text
Call tool "get_customer" with:
  id: "${state.create-customer.customerId}"
```

MCP Rigor rejects state created for a different target. After careful review, it can be overridden:

```bash
mcprigor test retrieve.mcpr \
  --state-in customer-state.json \
  --allow-state-target-mismatch
```

## Security guidance

State files can contain real business data. They are not encrypted.

- Never export passwords, access tokens, private keys, or regulated data.
- Do not commit state files to source control.
- Keep state short-lived.
- Prefer a secret manager for credentials.
- Treat target-mismatch override as an exceptional migration tool.
- Redaction protects reports, but internal dependency values remain unredacted so tests can use them correctly.
