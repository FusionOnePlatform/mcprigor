# Security and evidence retention

> Production required: review this page before enabling remote data, custom extensions, or persistent CI evidence.

## Implemented controls

- URI userinfo and sensitive query/fragment fields are redacted.
- Known secrets are redacted in raw, percent-encoded, double-encoded, base64, and base64url forms.
- Terminal reports remove ANSI/CSI/OSC/DCS/APC/PM and unsafe C0/C1 controls.
- Remote data requires explicit opt-in, credential-free HTTP(S), public DNS/IP destinations, at most three manually checked redirects, ten-second deadlines, and 10 MiB bodies.
- Remote redirects are revalidated and private/link-local/loopback destinations are rejected.
- YAML data uses the core schema, duplicate-key detection, alias limits, depth/node limits, and unsafe-key rejection.
- CSV input caps fields at 1 MiB, rows at 1,000 columns, and total rows at one million; source files remain capped at 10 MiB.
- XLSX input is capped at 25 MiB compressed and signature-checked before ExcelJS parsing.
- Extension paths can be restricted with exact `extensions.allowlist` entries.
- Server stderr is capped per chunk and per session.

## Residual risks

DNS validation followed by the platform `fetch` still has a rebinding window because the current implementation does not yet pin the resolved address through a custom dispatcher. ExcelJS preflight does not fully inspect ZIP central-directory expansion ratios. Use trusted QA data endpoints and files until strict broker/container backends are available.

Worker threads are not a hard sandbox for hostile plugins.

## Retention recommendation

By default, do not retain raw authorization headers, environment variables, URI queries, downloaded data files, or full sensitive MCP payloads.

Suggested policy:

- run metadata and sanitized reports: 7–30 days;
- contract baselines: for the supported release lifetime;
- normalized traces: 7–14 days unless needed for audit;
- raw trace payloads: opt-in, restricted, and 24–72 hours;
- malicious parser samples: encrypted quarantine, audited access, and 24–72 hours;
- debug logging: time-bounded with automatic expiry.

Deletion procedures should cover CI artifacts, object storage, developer workstations, backups, caches, and third-party telemetry. Incident holds need an owner, reason, scope, and expiry.
