# QA workspace

Use MCP Rigor in a browser to edit, validate, and run saved tests.

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

## Daily workflow

1. Select a `.mcpr` suite in the left panel.
2. Edit the plain-language scenario.
3. Choose **Validate**.
4. Fix any diagnostic shown below the editor.
5. Choose **Run tests** or **Run parity**.
6. Review the result panel.
7. Save the file.

The editor marks unsaved changes. If the file changed elsewhere after you opened it, the workspace refuses to overwrite it and asks you to reload.

## What is available

- Saved `.mcpr`, YAML, and JSON suites
- Plain-language editing
- Validation without server execution
- Test execution
- Transport parity execution
- Terminal-style results
- Local evidence indexing

## Current candidate limits

The browser currently focuses on the core edit/validate/run/parity loop. Use the CLI for:

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
- it is not inside `node_modules`, `.git`, or `dist`.

For server and test failures, see [troubleshooting](TROUBLESHOOTING.md).
