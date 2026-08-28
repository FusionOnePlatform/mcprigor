# Background: MCP testing landscape

> Non-normative research. This page explains product positioning; it is not needed to use MCP Rigor.

## Executive summary

MCP testing tools currently fall into five categories: interactive inspectors, scriptable probes, official protocol conformance, SDK/framework-local tests, and semantic or security evaluators. The strongest opening for MCP Rigor is a transport-neutral, deterministic, black-box application test runner: **“Playwright for MCP.”**

MCP Rigor should complement the Inspector and official Conformance project rather than suggest it replaces either.

## Landscape

| Tool | Primary role | What it does well | Gap relative to MCP Rigor |
|---|---|---|---|
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) | Official interactive debugger | Explore connections, capabilities, tools, resources, prompts, notifications, and logs | Primarily manual exploration rather than a scenario/assertion/reporting framework |
| [MCP Inspector CLI](https://github.com/modelcontextprotocol/inspector#cli-mode) | Scriptable probe | Programmatic one-shot MCP interactions | Tests, fixtures, captures, deterministic assertion semantics, and CI reports remain limited or external |
| [Official MCP Conformance](https://github.com/modelcontextprotocol/conformance) | Protocol compliance/interoperability | Repeatable client/server protocol checks | Evolving protocol suite rather than application-domain regression testing |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | SDK and in-memory testing | Typed clients and in-process transport testing | Language/repository coupled; in-memory tests do not cover deployed transport boundaries |
| [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk) | SDK and in-memory testing | Python integration tests and memory helpers | Language/repository coupled rather than a universal black-box suite |
| [FastMCP testing](https://gofastmcp.com/patterns/testing) | Python framework testing | Convenient deterministic pytest/in-process testing | Framework-specific and can bypass subprocess, HTTP, auth, proxy, and deployment behavior |
| [mcptools](https://github.com/f/mcptools) | CLI probing | Shell-friendly list/call/read operations | Assertion model, scenarios, reports, fixtures, and coverage are external |
| [Promptfoo MCP provider](https://www.promptfoo.dev/docs/providers/mcp/) | Behavioral/agentic evaluation | Tool selection and response-quality evaluation with reports | LLM/model behavior can be probabilistic; not wire or deterministic application testing |
| [mcp-vibetest](https://github.com/ComposioHQ/mcp-vibetest) | Agentic semantic evaluation | Realistic task-completion checks | Probabilistic and complementary to hard deterministic gates |
| [mcp-scan](https://github.com/invariantlabs-ai/mcp-scan) | Security scanning | Tool-poisoning and prompt/config risk detection | Specialized security gate, not functional regression testing |
| [Cisco MCP Scanner](https://github.com/cisco-ai-defense/mcp-scanner) | Security scanning | MCP-focused security analysis | Specialized scanner rather than behavior/protocol test runner |
| [MCPJam Inspector](https://github.com/MCPJam/inspector) | Interactive workbench | Friendly exploratory MCP development | Primarily interactive; deterministic CI should not be assumed without specific current support |

Project details and release status change quickly. Pin versions and verify current primary documentation before making compatibility claims.

## Positioning

### Category

**Deterministic MCP application testing.**

### One-line message

> MCP Rigor is the open-source test runner for repeatable MCP server behavior across stdio and Streamable HTTP.

### Memorable message

> Playwright for MCP: author once, run the same scenarios locally and in CI.

### Naming rationale

“MCP Rigor” uses established developer-tool terminology, clearly describes the project’s scope, and remains independent from any specific MCP server or vendor brand. Registry and trademark availability should still be verified before publication.

## Durable differentiation

1. **Application workflows, not only probes:** multi-step scenarios, captures, fixtures, setup/teardown, and side-effect verification.
2. **Real boundaries:** subprocess lifecycle, stdio framing, Streamable HTTP, auth, TLS/proxy, reconnect, and cleanup.
3. **Stable CI contract:** deterministic exit codes, JSON/JUnit/SARIF, traces, artifacts, filtering, and policy-controlled retries.
4. **MCP-aware assertions:** tools/resources/prompts, errors, notifications, progress, pagination, cancellation, capability/version matrices, and subscriptions.
5. **Declarative and programmable:** safe YAML/JSON for most cases plus a typed API and explicit plugin model for advanced projects.
6. **Layered oracles:** deterministic assertions as hard gates; optional semantic/LLM evaluation as a clearly labeled soft layer.
7. **Record to regression:** capture an exploratory interaction, sanitize secrets/dynamic values, and generate a checked-in test.
8. **Evidence, not certification:** run or aggregate exact official conformance profiles without making blanket compliance claims.

## What not to become

- another generic MCP chat client
- another Inspector UI as the first product
- an unofficial certification authority
- a Python- or TypeScript-framework-specific helper
- an LLM evaluation platform whose core results are nondeterministic
- a broad security scanner that dilutes functional testing

## Launch wedge

Target teams that have one or more MCP servers in CI and currently use shell scripts, Inspector screenshots, ad hoc SDK tests, or manual checks. The first compelling demo should:

1. run the same calculator test against stdio and HTTP targets;
2. show a clear structural diff for a broken tool response;
3. capture a value and reuse it in a later step;
4. verify a protocol error and timeout;
5. export JUnit in GitHub Actions;
6. prove the child process is cleaned up after failure.

## Suggested public narrative

“The MCP ecosystem already has excellent tools to inspect a server and increasingly strong official protocol conformance checks. MCP Rigor addresses a different question: does your server still perform the domain behaviors your users depend on? It turns those behaviors into deterministic scenarios that run over real transports on every pull request.”
