# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.0-rc.x | ✅ |
| < 1.0.0-rc.1 | ❌ |

## Reporting a vulnerability

Please report security issues privately via [GitHub Security Advisories](https://github.com/FusionOnePlatform/mcprigor/security/advisories/new) — do not open a public issue for exploitable vulnerabilities.

Include: MCP Rigor version, Node.js version, OS, a minimal reproduction, and impact assessment. You can expect an acknowledgment within 72 hours.

## Security posture

- `npm audit`: 0 known vulnerabilities in production and development dependencies (verified per release).
- Centralized secret redaction (raw, percent-encoded, and base64 variants) in reports and evidence.
- ANSI/OSC/DCS terminal-sequence sanitization of server output.
- SSRF protection for remote data sources: DNS resolution checks, private-IP rejection, redirect caps, body-size limits.
- Hostile-input limits for YAML (safe schema, depth and node caps), CSV (field/column/row caps), and XLSX (size and signature preflight).
- Remote data (`--allow-remote-data`) and custom code (`--allow-custom-code`) are disabled by default.
- Custom extensions run in worker isolation with manifest-declared permissions, JSON-only boundaries, memory limits, and timeouts. Worker isolation reduces risk but is not a hard sandbox for hostile code — review and allowlist extensions before CI use.
- The QA workspace binds only to loopback, uses CSRF tokens and strict CSP, and never accepts arbitrary commands from the browser.

Details: [docs/SECURITY-AND-RETENTION.md](docs/SECURITY-AND-RETENTION.md)
