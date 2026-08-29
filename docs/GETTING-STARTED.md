# Getting started

This guide takes you from installation to one passing MCP test.

## 1. Install MCP Rigor

You need Node.js 20 or 22. MCP Rigor is published on npm as [`mcprigor`](https://www.npmjs.com/package/mcprigor) — the package ships ready-to-run compiled code, so there is nothing to build from source.

```bash
mkdir mcp-acceptance-tests
cd mcp-acceptance-tests
npm init -y
npm install mcprigor
```

To check the installation:

```bash
npx mcprigor --help
```

## 2. Create a test file

Create `calculator.mcpr`:

```text
MCP Test 1

Suite: "Calculator acceptance tests"
Server: node ../calculator-server/dist/server.js

Test: "Adding 20 and 22 gives 42"
  Call tool "add" with:
    a: 20
    b: 22

  Expect "structuredContent.sum" equals 42
```

Change the `Server` command to the command that starts your MCP server.

For a deployed Streamable HTTP server, use:

```text
MCP URL: https://qa.example.com/mcp
```

## 3. Check the wording

```bash
npx mcprigor check calculator.mcpr
```

A valid file prints:

```text
✓ calculator.mcpr looks good and is ready to run
```

`check` does not connect to the server.

## 4. Run the test

```bash
npx mcprigor test calculator.mcpr
```

A passing result looks like:

```text
MCP Rigor — Calculator acceptance tests
✓ Adding 20 and 22 gives 42

1 passed, 0 failed, 0 skipped, 0 blocked
```

## 5. Create a shareable report

```bash
npx mcprigor test calculator.mcpr --html report.html
```

Open `report.html` or attach it to a ticket.

## 6. Try the browser workspace

```bash
npx mcprigor workspace .
```

Open the printed local URL. Select `calculator.mcpr`, edit it, choose **Validate**, then **Run tests**.

## If you do not know tool names

Create a small target file such as `server.mcpr`:

```text
MCP Test 1
Suite: "Server target"
Server: node ../calculator-server/dist/server.js
Test: "Connection"
  Send "ping"
```

Start guided authoring:

```bash
npx mcprigor author server.mcpr --out calculator.mcpr
```

MCP Rigor discovers tools, resources, and prompts and asks what you want to verify.

## Recommended project layout

```text
mcp-acceptance-tests/
  package.json
  tests/
    smoke.mcpr
    regression.mcpr
    data/
      customers.csv
  .mcprigor/
    # generated evidence; normally ignored or stored as CI artifacts
```

## Next steps

- [Plain-language cookbook](PLAIN-LANGUAGE-COOKBOOK.md)
- [QA workspace](QA-WORKSPACE.md)
- [Engineer setup and CI](ENGINEER-SETUP.md)
- [Troubleshooting](TROUBLESHOOTING.md)
