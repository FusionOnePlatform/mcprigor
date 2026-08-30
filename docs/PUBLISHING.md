# Shareable hosted reports

> Available since `1.5.0`.

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

## Publishing from the QA workspace UI

The visual workspace (`mcprigor workspace`) exposes the same features without the command line:

- **HTML report** — every finished test run has an `HTML report` button that opens the full report, including the clickable session timeline, in a new tab.
- **Publish** — start the workspace with hosting configured and a `Publish` button appears next to the export buttons:

  ```bash
  export MCPRIGOR_PUBLISH_SITE=your-netlify-site
  export NETLIFY_AUTH_TOKEN=...
  mcprigor workspace
  ```

  Clicking it deploys the selected run's report and opens the shareable URL; a `View published ↗` link stays on the run for re-opening or copying. Without both variables the button is hidden and the API answers with a clear configuration message — the token itself never reaches the browser.

## Security

- The report is produced by the same pipeline as `--html`: secrets and configured redaction patterns are removed **before** the report exists.
- Publishing makes the report as public as the target site. Use a password-protected or team-restricted Netlify site for internal results.
- The hosting token is read from the environment at the last moment and is never echoed, logged, or stored.
