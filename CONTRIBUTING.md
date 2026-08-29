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

## Pull request strategy

Direct pushes to `main` are disabled — **all changes land through pull requests**, including from maintainers and admins.

### Branch protection on `main`

- Pull request required; **at least 1 approving review from a code owner** (repository maintainers, per [`.github/CODEOWNERS`](.github/CODEOWNERS))
- Stale approvals are dismissed when new commits are pushed
- **Required status checks** must pass and the branch must be up to date: `test (ubuntu/macos/windows × Node 20/22)` and `security`
- All review conversations must be resolved before merging
- Linear history enforced; force pushes and branch deletion blocked
- Repository administrators may bypass in exceptional cases (releases, emergency fixes); routine maintainer changes still go through PRs

### Workflow

1. Fork the repository (or create a branch if you have write access) — use a descriptive name such as `fix/windows-worker-paths` or `feat/graphql-data-source`.
2. Keep PRs focused: one logical change per PR. Split refactors from behavior changes.
3. Run `npm run check` locally before opening the PR (build + all 78 tests).
4. In the PR description, explain the **user problem**, compatibility impact, tests added, and any suite-schema changes. Breaking schema/API changes require a specification update and migration notes.
5. CI runs the full matrix (3 OS × 2 Node versions, security suite, protocol-revision × transport compatibility). All required checks must be green.
6. Address review comments; every conversation must be resolved.
7. **Merges are squash-only** — the PR title becomes the commit title, so write it in imperative mood (e.g. "Fix worker path resolution on Windows"). Branches are deleted automatically after merge.

### Releases

Versions are tagged (`vX.Y.Z[-rc.N]`) from `main` by maintainers, published to npm with provenance from a green CI state, and documented in [GitHub Releases](https://github.com/FusionOnePlatform/mcprigor/releases) with tarball checksums.

## Code of conduct

Participation in this project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). Security issues should be reported privately per [SECURITY.md](SECURITY.md).
