# Contributing to MCP Rigor

Thank you for helping build deterministic, vendor-neutral MCP testing.

## Local setup

```bash
npm ci
npm run check
```

Node.js 20 or 22 is recommended. The test suite launches a real MCP server over stdio; tests must clean up every session they create.

## Design rules

- Keep deterministic checks separate from optional model-based evaluation.
- Preserve the safety of declarative suites: no embedded JavaScript evaluation.
- Add a stable `MCP-<AREA>-NNN` diagnostic code for user-facing failure categories.
- Redact data before it reaches any reporter.
- Pin claims about MCP behavior to a protocol or official SDK version.
- Do not describe MCP Rigor results as certification.
- Add unit tests and, for transport behavior, black-box fixture tests.

## Pull requests

Explain the user problem, compatibility impact, tests, and any suite-schema changes. Breaking schema/API changes require a specification update and migration notes.
