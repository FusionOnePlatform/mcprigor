# Shareable hosted reports

> Available on `main`; included in the next npm release after 1.4.0.

Turn a test run into a URL anyone can open — no repository access, no CI login:

```bash
export NETLIFY_AUTH_TOKEN=...   # personal or CI token
mcprigor publish tests/catalog.mcpr --site your-netlify-site
```

`publish` runs the suite, builds the readable HTML report **with the clickable request/response session timeline**, deploys it to your Netlify site with the dependency-free digest API, waits until the deploy is live, and prints the shareable URL:

```
Published report: https://68b1c2--your-site.netlify.app
```

Each publish is a normal Netlify deploy of your own site, so access control, custom domains, deploy previews, and retention follow your existing hosting configuration. Unchanged files are skipped automatically via content digests.

## Options

```bash
mcprigor publish suite.mcpr --site SITE [--include-json] [--test NAME] [--env qa]
mcprigor publish suite.mcpr --out reports/latest
```

- `--site` — Netlify site ID or name. The token comes only from `NETLIFY_AUTH_TOKEN` (or `MCPRIGOR_PUBLISH_TOKEN`); tokens are never accepted as command-line flags.
- `--out DIR` — write the same bundle to a local directory instead of (or in addition to) hosting it. Serve it from any static host: S3, GitHub Pages, nginx, an artifact store.
- `--include-json` — also publish `result.json` for dashboards and programmatic consumers.
- `--test`, `--env`, `--command`, `--url` — the same run-selection options as `mcprigor test`.

The exit code still reflects the run (`0` passed, `1` failed), so `publish` can replace `test` in a pipeline step that both gates and shares.

## Security

- The report is produced by the same pipeline as `--html`: secrets and configured redaction patterns are removed **before** the report exists.
- Publishing makes the report as public as the target site. Use a password-protected or team-restricted Netlify site for internal results.
- The hosting token is read from the environment at the last moment and is never echoed, logged, or stored.
