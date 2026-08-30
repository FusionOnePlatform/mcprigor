# QA workspace

Use MCP Rigor in a browser to create, edit, validate, and run saved tests — no terminal needed for the daily loop.

## Start it

From your test directory:

```bash
mcprigor workspace .
```

Choose a port if needed:

```bash
mcprigor workspace . --port 4173
```

Open the printed local URL, for example `http://127.0.0.1:4173`.

Start it from a dedicated project folder rather than your home directory. Hidden directories and unreadable folders are skipped automatically, and suite discovery stops six levels deep.

## First run

An empty folder shows a three-step welcome screen. Choose **＋ New test file** (or press `Ctrl/⌘+N`): the file is created from a working example and opens immediately. Point the `Server:` line at your MCP server command — or replace it with `MCP URL:` for a deployed HTTP endpoint — then **Validate** and **▶ Run tests**.

## Daily workflow

1. Select a `.mcpr` suite in the left panel, or create one with **＋ New test file**.
2. Edit the plain-language scenario. The editor provides syntax highlighting, line numbers, and autocomplete: top-level declarations at the start of a line, actions and assertions when indented, and comparison phrases after `Expect "field"`. Accept with `Tab` or `Enter`; force the list open with `Ctrl+Space`.
3. Choose **Validate** (`Ctrl/⌘+S` saves, `Ctrl/⌘+Enter` runs). A wording problem highlights the offending line and moves the cursor to it.
4. Choose **▶ Run tests** or **Parity**.
5. Review the results panel: per-file pass/fail with durations; select a file for its full report. Drag either panel divider to resize the file list, editor, and results areas; widths persist across reloads, arrow keys resize a focused divider, and double-click resets the layout.

The editor marks unsaved changes; running or validating saves them first. If the file changed elsewhere after you opened it, the workspace refuses to overwrite it and asks you to reload.

## Batch runs

Every file row has a checkbox. Selecting one or more files shows a batch bar with **Validate**, **Parity**, and **▶ Run** for the whole selection (up to 20 files per run). The Run panel lists each file with its outcome and duration.

## Renaming

Rename a file from the pencil icon on its row, the toolbar pencil, or by double-clicking the file name. Run history follows the new name automatically, so History and Trends stay intact. To rename an individual test, edit its `Test: "…"` line — history tracks tests by name within each suite.

## History, trends, and search

Test runs are recorded in `.mcprigor/workspace-history.jsonl` (most recent 2000 entries). The results panel has three tabs:

- **Run** — the current run, with per-file reports.
- **History** — past runs, expandable to per-test status, duration, and error text.
- **Trends** — per-suite pass rate, a duration sparkline over the last 30 runs, and per-test pass-rate bars that make flaky or consistently failing tests stand out.

One search box filters all three tabs. It matches suite names, test names, and error text, and highlights matches, so you can answer questions like "when did `delivered` start failing?" without leaving the browser.

Completed runs expose **PDF**, **CSV**, and **JUnit XML** downloads. The Trends tab exports a rich trends PDF, aggregate CSV, or raw history CSV. PDF reports include summary cards, pass-rate visuals, per-test detail, failures, durations, and evidence identifiers.

An **HTML report** button opens the full report — including the clickable request/response session timeline — in a new tab. When the workspace is started with `MCPRIGOR_PUBLISH_SITE` and `NETLIFY_AUTH_TOKEN` set, a **Publish** button also appears: one click hosts the report at a shareable static URL and keeps a `View published ↗` link on the run. See [Shareable hosted reports](PUBLISHING.md).

## What is available

- Creating, renaming, and editing `.mcpr` suites (YAML and JSON suites are listed and editable too)
- Syntax highlighting and grammar-aware autocomplete
- Validation without server execution, with line-anchored diagnostics
- Test execution, single file or batch
- Transport parity execution
- Persistent run history with trends and search
- Local evidence indexing

## Current limits

The browser focuses on the create/edit/validate/run loop. Use the CLI for:

- guided test generation;
- contract discovery and drift updates;
- detailed evidence comparison;
- snapshot acceptance;
- replay;
- cancellation and streaming run progress.

See the [CLI reference](CLI-REFERENCE.md).

## Security

The workspace:

- listens only on the local machine;
- requires same-origin, CSRF-protected changes;
- reads targets from saved suites;
- does not accept arbitrary commands from browser requests;
- restricts file paths and types;
- uses atomic saves and content fingerprints;
- limits files and requests to 1 MiB.

Do not expose the workspace through a public proxy. Stop it with `Ctrl+C` when finished.

## Problems

If a suite does not appear, confirm that:

- it is under the selected workspace directory;
- its extension is `.mcpr`, `.yaml`, `.yml`, or `.json`;
- it is not inside `node_modules`, `dist`, a hidden directory (such as `.git`), or deeper than six levels;
- the directory containing it is readable.

For server and test failures, see [troubleshooting](TROUBLESHOOTING.md).
