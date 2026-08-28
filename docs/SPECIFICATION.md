# MCP Rigor runtime and product specification

> Normative runtime behavior and product requirements. For `.mcpr` syntax, use the [language reference](LANGUAGE-SPEC.md). Everyday users should start with [Getting started](GETTING-STARTED.md).

## 1. Product definition

MCP Rigor is an open-source, deterministic, black-box application test framework for Model Context Protocol servers. Its core promise is:

> Author a behavioral MCP scenario once, then run it repeatably against local subprocesses and deployed HTTP servers in CI.

MCP Rigor complements interactive debuggers and protocol conformance tooling. It does not claim MCP certification.

## 2. Users and jobs

- **MCP server authors:** prevent regressions in tools, resources, prompts, errors, and side effects.
- **Platform teams:** validate third-party servers before promotion or deployment.
- **SDK maintainers:** run common behavioral scenarios across transports and versions.
- **Security and QA teams:** build deterministic negative, authorization, and abuse cases.

Primary job: turn manually verified MCP interactions into reviewable, version-controlled tests with reliable CI outcomes.

## 3. Principles

1. Deterministic checks are hard gates; probabilistic evaluation is optional and separate.
2. Real transport boundaries matter.
3. Test files contain data, not arbitrary executable code.
4. Every wait has a deadline; notification tests use events rather than sleeps.
5. Reports identify protocol version, transport, capability, skips, and evidence.
6. Secrets are redacted before any result reaches a reporter.
7. “Conformance” always names an exact versioned profile and never implies certification.

## 4. MVP scope

### Included

- Node.js 20+, TypeScript, ESM
- YAML and JSON suites
- stdio subprocess and Streamable HTTP targets
- one isolated MCP session per test
- generic MCP requests
- captures and variable substitution
- exact, negative, existence, type, subset, length, and regex assertions
- expected MCP errors
- per-step deadlines
- terminal, JSON, and JUnit output
- CLI filtering and deterministic exit codes
- TypeScript library API

### Deferred

- notification queues and progress assertions
- JSON Schema output matcher
- snapshots and record/replay
- setup/teardown fixtures and shared sessions
- official-conformance adapter and versioned packs
- OAuth browser flows
- plugin API, custom reporters, and custom transports
- fuzzing and security packs
- retries, parallel/distributed execution, GUI, and LLM judges

## 5. Suite model

A suite has `version`, optional `name`, one target, defaults, and tests. A test contains sequential steps. Each step sends one request, applies assertions, then captures response leaves.

Variables:

- `${captureName}` references a test-local captured value.
- `${env.NAME}` references an environment value.
- An exact placeholder preserves its JSON type; interpolation into a larger string converts to text.
- Variables are resolved only in request parameters in the MVP. Target interpolation and centralized secret redaction are required next.

Session isolation is the default because order-independent tests are easier to reproduce. Shared sessions may be added only as an explicit opt-in.

## 6. Architecture

```text
CLI
 ├─ suite loader and validator
 ├─ protocol-neutral runner
 │   ├─ variable resolver
 │   ├─ matcher engine
 │   └─ normalized result model
 ├─ MCP SDK session
 │   ├─ stdio adapter
 │   └─ Streamable HTTP adapter
 └─ reporters
     ├─ terminal
     ├─ JSON
     └─ JUnit XML
```

The runner depends on a small `TestSession` interface so fixture sessions and future raw-wire transports can be substituted. The official TypeScript SDK currently performs initialization, protocol validation, framing, and transport lifecycle management.

A future monorepo can split stable boundaries into `core`, `cli`, `transport-stdio`, `transport-http`, `conformance`, `reporters`, and `plugin-api` packages. Keeping one package until those boundaries stabilize reduces premature API commitments.

## 7. Result and failure semantics

Each run records suite status, UTC start time, duration, observed protocol versions, tests, steps, and summary counts. Failures stop the current test after the first failed step but do not stop later tests.

Exit codes:

- `0`: all selected tests passed
- `1`: one or more behavioral assertions failed
- `2`: usage, parsing, or configuration invalid
- `3`: unexpected infrastructure failure

A later version should explicitly distinguish test failure, transport failure, cleanup failure, skipped capability, not applicable, and inconclusive.

## 8. Conformance roadmap

Versioned profiles should be independently released, for example:

```text
profiles/2025-03-26/lifecycle
profiles/2025-03-26/tools
profiles/2025-03-26/resources
profiles/2025-03-26/prompts
profiles/2025-03-26/streamable-http
```

Checks should include initialization/version negotiation, declared capability behavior, required response/error shapes, ping, cancellation, pagination, progress, logging, subscriptions, unknown methods, invalid parameters, HTTP session IDs, media types, reconnect, and termination.

Report statuses must include pass, fail, capability-skipped, not-applicable, and inconclusive. Integrate official MCP Conformance as a separately pinned run and merge evidence rather than duplicating or rebranding it.

## 9. Security requirements

Before a public beta:

- interpolate target environment and headers without writing secrets into results
- centralize recursive key/value redaction before reporters
- cap response, stderr, and report sizes
- guard regex complexity or document trust assumptions
- avoid shell command strings; continue using command plus argument arrays
- ensure bounded graceful subprocess shutdown with force-kill fallback
- sanitize JUnit and terminal control characters
- provide opt-in environment inheritance and document its threat model

Security scanners should be integrations. MCP Rigor’s core identity remains functional and protocol-aware testing.

## 10. Release roadmap

### 0.1 — executable MVP

Core runner, YAML/JSON suites, stdio/HTTP through official SDK, deterministic matchers, captures, CLI, JSON/JUnit, tests, and docs.

### 0.2 — CI reliability

Published JSON Schema, complete config validation with Ajv, secret redaction, richer diffs, target interpolation, robust transport classification, GitHub Action, Windows/macOS/Linux CI, and deterministic fixture servers.

### 0.3 — MCP-native behavior

Notification/event queues, progress and cancellation, pagination helpers, capability requirements, resource subscriptions, logging assertions, JSON Schema matcher, traces, snapshots, and record/sanitize/replay.

### 0.4 — ecosystem

Versioned conformance profiles, official conformance aggregation, plugin API, reusable fixture packs, security/fuzz hooks, and adapters for common MCP frameworks.

### 1.0 criteria

Stable suite schema and TypeScript API, two supported protocol revisions, robust process cleanup on three operating systems, transport/auth documentation, migration policy, plugin compatibility policy, reproducible fixture matrix, and no high-severity secret leakage paths.

## 11. Open-source operating model

- Apache-2.0 for broad individual and enterprise use.
- Public RFCs for schema or plugin-breaking changes.
- Conventional changesets and a compatibility table per release.
- `good first issue` fixtures and matcher additions.
- Governance should clearly document project ownership, maintainership, and vendor neutrality.
- Reserve project, npm, GitHub organization, and domain names only after registry and trademark checks.

## 12. Success metrics

- time from install to first passing stdio test under ten minutes
- less than 1% flaky failures in deterministic project fixtures
- clean teardown across Linux, macOS, and Windows
- projects running MCP Rigor in CI weekly
- community-contributed reusable suites and transport fixtures
- issue resolution time and repeat contributor rate
