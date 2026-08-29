# MCP Rigor for VS Code

Syntax highlighting and inline validation for `.mcpr` files — natural-language acceptance tests for MCP servers, compiled deterministically (no AI interprets the wording).

## Features

- Syntax highlighting for the full MCP Rigor language, including data engineering, flows, snapshots, parity targets, and scripted elicitation/sampling responses
- Inline diagnostics on open and save, powered by `mcprigor check` — the same compiler CI runs, so the editor never disagrees with the pipeline
- Comment toggling, bracket/quote auto-closing

## Requirements

`mcprigor` available via `npx` (default) or configure `mcprigor.command` to point at a global install.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mcprigor.validateOnSave` | `true` | Run `mcprigor check` on save |
| `mcprigor.command` | `npx mcprigor` | How to invoke the CLI |

## Learn more

- [MCP Rigor documentation](https://mcprigor.com)
- [GitHub](https://github.com/FusionOnePlatform/mcprigor)
