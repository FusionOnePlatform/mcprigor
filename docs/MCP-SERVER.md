# MCP Rigor as an MCP server

Expose MCP Rigor itself over the Model Context Protocol so AI agents — Claude Code, Cursor, or any MCP client — can write, validate, and run natural-language acceptance tests for the MCP server they are building. The agent gets a deterministic feedback loop: it writes a `.mcpr` file, runs it, reads structured pass/fail results, fixes the server, and repeats. No AI interprets the test wording at runtime.

## Start it

From your project directory:

```bash
mcprigor serve
```

Or with an explicit root:

```bash
mcprigor serve path/to/project
```

The server speaks MCP over stdio. Typical client configuration:

```json
{
  "mcpServers": {
    "mcprigor": {
      "command": "npx",
      "args": ["mcprigor", "serve", "/absolute/path/to/project"]
    }
  }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `list_suites` | List test files under the root (`.mcpr`, YAML, JSON). |
| `read_suite` | Read one test file. |
| `write_suite` | Create or overwrite one `.mcpr` file (omit `text` for a starter template). |
| `validate_suite` | Compile without running; returns test names or a diagnostic with line/column and a fix hint. |
| `run_tests` | Run 1–20 suites; returns per-test status, duration, and failure messages. Failing runs set `isError`. |
| `run_parity` | Run a suite's declared parity targets and compare transports. |
| `get_history` | Read recorded run history, filterable by suite or test name. |

Results are returned both as JSON text and as `structuredContent`, and test runs append to `.mcprigor/workspace-history.jsonl` — the same history the [QA workspace](QA-WORKSPACE.md) shows as trends.

## The agent loop

1. `write_suite` — the agent drafts acceptance tests in natural language.
2. `validate_suite` — deterministic wording check; diagnostics carry exact line and column.
3. `run_tests` — starts the server declared by each suite's `Server:` line, runs the tests, returns structured results.
4. The agent fixes its MCP server (or the test) and repeats.
5. `get_history` — spot regressions across iterations.

## Trust model

`run_tests` and `run_parity` start whatever command each suite's `Server:` line declares, with the workspace root as working directory — exactly like running `mcprigor test` yourself. This is the same trust model as `npm test`: point the root at a project you trust, because test suites in that project can execute code.

Additional guards:

- file access is confined to the workspace root, with the same path and type restrictions as the QA workspace;
- `write_suite` only writes `.mcpr` files, capped at 1 MiB;
- batches are capped at 20 suites per call;
- a recursion guard refuses to start when a suite under test spawns `mcprigor serve` itself more than two levels deep.

## Limits

The MCP server exposes the create/validate/run loop. Renaming files, deleting files, snapshot acceptance, contract updates, and evidence comparison remain CLI (or workspace) operations by design — an agent should not silently rewrite baselines that exist to catch its own regressions.
