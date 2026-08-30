# GitHub Action and pull-request reports

> Available on `main`; publish by pinning the next MCP Rigor release tag.

The MCP Rigor Action runs deterministic suites, optionally gates contract drift, includes flaky-history warnings, writes a rich job summary, and creates or updates one pull-request comment.

## Workflow

```yaml
name: MCP Rigor
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  rigor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: FusionOnePlatform/mcprigor@v1
        with:
          suites: |
            tests/**/*.mcpr
          lock: mcp.lock.yaml
          fail-on: breaking
```

The comment contains a suite table with pass/fail/skipped totals and durations, the classified contract drift report, flaky-test warnings when history exists, and collapsed failure detail. A stable HTML marker makes subsequent runs update the same comment rather than spamming the PR.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `suites` | `tests/**/*.mcpr` | Newline-separated paths or glob patterns |
| `lock` | empty | Optional contract lock checked against the first matched suite |
| `fail-on` | `breaking` | `breaking`, `potentially-breaking`, `any`, or `none` |
| `node-version` | `22` | Node.js version used by the Action |
| `version` | `latest` | MCP Rigor npm version installed for the run |
| `comment` | `true` | Post/update a pull-request comment |
| `flaky` | `true` | Add warnings when `.mcprigor/workspace-history.jsonl` exists |

Outputs are `status` (`passed` or `failed`) and `report` (the generated Markdown path).

## Fork safety

The Action does not run arbitrary PR comment content. Test targets still come from repository suites, so use normal GitHub approval controls for workflows from untrusted forks. Pull-request comments require `pull-requests: write`; when the token cannot write (common for forks), set `comment: false` and rely on the job summary.

Pin a full release tag for the strongest supply-chain reproducibility:

```yaml
- uses: FusionOnePlatform/mcprigor@v1.5.0
```
