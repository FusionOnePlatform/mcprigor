# Compatibility Policy

## Required release matrix

| Axis | Supported |
|---|---|
| Node.js | 20, 22 |
| Operating systems | Linux, macOS, Windows |
| MCP revisions | `2024-11-05`, `2025-03-26`, `2025-06-18` |
| Transports | stdio, Streamable HTTP |
| Fixtures | known-good server and intentionally broken startup servers |

Pull requests run the full test suite on Node 20/22 across Ubuntu, macOS, and Windows. A dedicated Linux compatibility job runs each advertised protocol revision against both transport models. Security and lifecycle fixtures run separately and production dependencies are audited.

The protocol matrix verifies gating, capability handling, and normalized runtime behavior. Real transport integration is covered by the known-good stdio fixture and existing Streamable HTTP SDK tests; parity behavior is tested independently.

## Broken fixture coverage

- missing executable;
- process exits before initialization;
- initialization timeout/error classification;
- idempotent cleanup and parallel session registry;
- invalid/hostile YAML and CSV;
- remote private-network URLs;
- encoded credentials and terminal control sequences.

## Third-party servers

Third-party compatibility should be pinned and reproducible, never a required CI dependency on a live public endpoint. Recommended release candidates:

1. Pin a tagged server revision in a container or fixture lock.
2. Run discovery, generated contract smoke tests, one domain scenario, and shutdown.
3. Record the server name/version, SDK version, transport, protocol revision, and expected fingerprint.
4. Keep “latest” dependency/server jobs advisory until triaged; supported pinned failures block release.

No third-party server is currently claimed as certified. Compatibility results demonstrate tested behavior only.

## Process lifecycle guarantees

MCP Rigor tracks active sessions, installs SIGINT/SIGTERM cleanup in the CLI, closes clients/transports on initialization errors, and makes global shutdown idempotent. The pinned SDK escalates direct stdio children from stdin close to TERM and KILL.

Strict grandchild containment is platform-specific: POSIX process groups and Windows Job Objects are the desired final guarantee. The current SDK owns the direct child, so servers that spawn descendants must also implement responsible descendant shutdown. Release tests should continue to treat surviving descendants as a blocker.
