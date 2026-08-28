# Stable Error Model

MCP Rigor failures carry a stable code, category, sanitized message, and QA-facing action.

| Category | Baseline code | QA action |
|---|---|---|
| configuration | `MCP-CONFIG-000` | Check suite target and settings. |
| language compilation | `MCP-LANG-000` | Correct the highlighted statement. |
| data loading | `MCP-DATA-000` | Check the named source, row, and column. |
| extension | `MCP-EXT-000` | Review manifest, permission, and export. |
| server spawn | `MCP-SPAWN-000` | Check command and working directory. |
| initialization | `MCP-INIT-000` | Inspect why MCP initialization did not finish. |
| transport | `MCP-TRANSPORT-000` | Check process/HTTP connection and server logs. |
| MCP error | `MCP-REMOTE-000` | Review the server's MCP code and message. |
| schema | `MCP-SCHEMA-000` | Compare the result with the required schema. |
| assertion | `MCP-ASSERT-000` | Compare expected path/value with response. |
| timeout | `MCP-TIMEOUT-000` | Inspect server performance or explicit timeout. |
| cancellation | `MCP-CANCEL-000` | The operation was stopped before completion. |
| cleanup | `MCP-CLEANUP-000` | Inspect cleanup steps and server shutdown. |
| internal | `MCP-INTERNAL-000` | Preserve sanitized evidence and report the bug. |

Specific existing codes remain stable within these categories. APIs expose `classifyFailure()`, `formatFailure()`, `RigorError`, and `FAILURE_CODES`. New codes may be added, but released codes are not repurposed.

Terminal formatting removes control sequences before display. Private causes and stacks are not part of the stable user-facing contract.
