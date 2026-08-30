# MCP surface and schema coverage

> Available on `main`; included in the next npm release after 1.4.0.

`mcprigor coverage` answers which parts of a live MCP contract have no test evidence.

```bash
mcprigor coverage tests/catalog.mcpr
mcprigor coverage tests/catalog.mcpr --fail-under 80 --json reports/coverage.json
```

MCP Rigor discovers the suite target, compares the live contract with static test steps, and measures these deterministic coverage units:

- every advertised tool called at least once;
- every fixed resource URI read at least once;
- every resource template matched by a resource read;
- every prompt requested at least once;
- input-schema properties supplied by at least one call;
- each `enum`, `oneOf`, and `anyOf` branch exercised by at least one tool argument set.

The score is covered units divided by all discovered units. Surfaces with no discovered items report 100% and do not penalize servers that do not expose that capability.

## CI gate

```bash
mcprigor coverage tests/catalog.mcpr --fail-under 80
```

The command exits nonzero when the score is below the threshold. Valid thresholds range from 0 to 100.

Use `--markdown` for a pull-request-friendly table and `--json` for dashboards or historical retention.

## What coverage proves

Coverage proves that a test suite references observed contract surfaces and supplies arguments that reach structural schema branches. It does not claim semantic correctness, authorization coverage, or execution-path coverage inside the server. Pair it with assertions, contract drift, the security audit, and performance budgets.

Coverage is calculated against the live discovered contract so newly added tools or schema options immediately appear as uncovered—even before they break an existing test.
