# Troubleshooting

Start with:

```bash
mcprigor check your-tests.mcpr
```

This catches wording and configuration problems without starting the MCP server.

## The server does not start

Typical category:

```text
MCP-SPAWN-* [server-spawn]
```

Check:

1. Run the `Server:` command directly in the same terminal.
2. Confirm the executable is installed and on `PATH`.
3. Check `Server options` → `cwd`.
4. Build the server before running tests.
5. Confirm required environment variables exist.

## Initialization times out

Typical categories:

```text
MCP-INIT-* [initialization]
MCP-TIMEOUT-* [timeout]
```

Check that the stdio server:

- writes MCP messages only to stdout;
- writes diagnostics to stderr;
- does not wait for interactive input;
- completes MCP initialization;
- stays running after startup.

For HTTP, verify the URL, authentication, and server logs.

For token-protected endpoints:

- `Environment variable not found: QA_TOKEN` — export the variable before running, or set it in the CI step's `env:` block.
- `MCP-INIT-001 Streamable HTTP error … unauthorized` — the token was sent but rejected; check its value, expiry, and audience. The server's own response body is included in the message.
- Tokens and header values are redacted from reports and evidence automatically; do not paste them into test files to "make them visible".

## A field was not found

Example:

```text
MCP-ASSERT-001 [assertion] $.structuredContent.id expected to exist
```

Actions:

- inspect the actual response in JSON or evidence;
- check capitalization and array indexes;
- use `content[0].text` for text results;
- use `structuredContent.field` for structured tool output;
- avoid adding `result.` because paths begin at the returned result.

## Expected number, received text

Equality is type-sensitive:

```text
Expect "structuredContent.total" equals 2
```

is different from:

```text
Expect "structuredContent.total" equals "2"
```

Match the server's actual JSON type.

## The test was skipped

`Require` gates a test on server capability or protocol revision:

```text
Require: tools
Require protocol: "2025-06-18"
```

A skip means the server did not advertise the requirement. It is not a test failure.

## The test was blocked

A dependent test is blocked when its producer did not pass:

```text
Depends on: create-customer
```

Fix the producer first. MCP Rigor does not open a server session for a blocked consumer.

## Data loading failed

Typical category:

```text
MCP-DATA-* [data-loading]
```

Check:

- file path relative to the `.mcpr` file;
- required column names;
- number, boolean, date, or JSON values;
- selected Excel sheet;
- configured row limit;
- remote-data permission;
- remote endpoint returns a JSON array of row objects.

Remote data requires:

```bash
mcprigor test FILE --allow-remote-data
```

Private and local network destinations are rejected.

## An extension failed

Typical category:

```text
MCP-EXT-* [extension]
```

Check:

- `--allow-custom-code` was supplied;
- module path is in `extensions.allowlist` when configured;
- manifest declares the function/provider;
- requested permissions are granted;
- input and output are JSON-compatible;
- extension finishes before its timeout.

## Snapshot changed

Review the path-level diff. If the change is expected:

```bash
mcprigor test FILE --snapshot snapshots.json --update-snapshots
```

Never update snapshots automatically in CI. Commit and review changed expectations.

## Transport parity differs

A parity failure can mean:

- different server versions;
- different fixture data;
- missing capabilities;
- a real stdio/HTTP implementation difference;
- volatile application fields that need an explicit snapshot policy.

Compare the path-level difference and verify both environments use equivalent test data.

## Cleanup failed

Typical category:

```text
MCP-CLEANUP-* [cleanup]
```

Make cleanup operations idempotent. A delete should safely handle an item that is already absent. Check that server child processes stop when stdin closes and do not leave descendants running.

## Ctrl+C does not return immediately

MCP Rigor first closes active MCP clients and transports. The pinned SDK gives stdio servers a graceful shutdown window before escalation. If a server creates child processes, the server must also shut them down.

## Collect useful evidence

```bash
mcprigor test FILE --evidence .mcprigor/debug-run --json result.json
mcprigor evidence-show .mcprigor/debug-run
```

Before sharing evidence, review it for sensitive business data. Secret redaction does not remove all possible customer content.

## Reporting a framework bug

Include:

- MCP Rigor version;
- Node and operating-system version;
- transport type;
- protocol revision if known;
- stable error code/category;
- smallest sanitized `.mcpr` test;
- sanitized evidence or result JSON.

Do not include credentials or regulated data.

## `MCP-AUTH-002 Token from command failed`

The `Token from:` command exited non-zero, timed out (15 s cap), printed nothing, or printed more than a single token. Run the command by hand and confirm it prints exactly one token on stdout with no extra logging. Send diagnostics to stderr instead — Rigor only reads stdout.
