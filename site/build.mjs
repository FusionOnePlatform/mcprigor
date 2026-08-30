// MCP Rigor website generator.
// Builds site-dist/ from site/ assets + docs/*.md. Run: node site/build.mjs
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site-dist");
const VERSION = "1.4.0";
const SITE = "https://mcprigor.com";

// Per-page SEO descriptions (fallback: first paragraph of the doc).
const DESCRIPTIONS = {
  "getting-started": "Install MCP Rigor and run your first natural-language MCP server test in five minutes. Step-by-step setup for QA teams and developers.",
  "natural-language-cookbook": "Copy-ready natural-language test examples for MCP servers: tool calls, assertions, errors, variables, cleanup, flows, CSV data, snapshots, and parity.",
  "qa-guide": "Everyday MCP Rigor checklist for QA authors: test structure, actions, expectations, variables, setup and cleanup, and good practices.",
  "qa-workspace": "Run MCP Rigor in a local browser workspace: create, edit, validate, and batch-run natural-language MCP test suites with autocomplete, run history, and trends.",
  "mcp-server": "Expose MCP Rigor over the Model Context Protocol so AI coding agents can write, validate, and run deterministic natural-language tests for the MCP servers they build.",
  "guided-authoring": "Generate MCP tests without writing them: MCP Rigor's guided author discovers a live server's tools and builds a reviewable natural-language test.",
  "troubleshooting": "Fix common MCP Rigor failures: server spawn errors, initialization timeouts, missing fields, skipped tests, data loading, and snapshot changes.",
  "engineer-setup": "Configure MCP Rigor targets, credentials, repository layout, GitHub Actions CI, contract drift checks, and transport parity for your team.",
  "cli-reference": "Complete MCP Rigor CLI reference: init, check, test, author, parity, discover, contract-check, evidence, snapshots, replay, options, and exit codes.",
  "language-spec": "The complete deterministic MCP Rigor natural-language (.mcpr) syntax reference: every statement, assertion, and rule.",
  "data-and-reuse": "Data-driven MCP testing with reusable flows, built-in utilities, CSV, JSON, Excel, REST, and Google Sheets data sources.",
  "data-engineering": "Advanced MCP Rigor test data: typed columns, filters, joins, derived values, seeded sampling, and caching.",
  "state-and-dependencies": "Share outputs between MCP Rigor tests and runs with dependencies, exports, and persisted state.",
  "transport-parity": "Compare MCP server behavior across stdio and Streamable HTTP transports and detect semantic differences automatically.",
  "performance-governance": "Set deterministic MCP latency assertions, percentile performance budgets, and CI regression gates backed by recorded history.",
  "github-action": "Run MCP Rigor tests and contract drift in GitHub Actions with rich job summaries, flaky warnings, and update-in-place pull-request comments.",
  "coverage": "Measure deterministic MCP contract coverage across tools, resources, prompts, templates, and input-schema branches with CI thresholds.",
  "monitoring": "Continuously monitor production Streamable HTTP MCP endpoints, record trend history, and notify webhooks on failures and recoveries.",
  "publishing": "Publish an MCP Rigor test run as a shareable static report URL with an interactive request/response session timeline.",
  "multi-server-compositions": "Test multiple MCP servers as one mounted fleet, detect tool and schema collisions, and gate combined contract drift in CI.",
  "security-audit": "Run deterministic MCP security probes for malformed requests, spoofing, oversized payloads, traversal, prompt injection, and secret exposure with scored reports.",
  "contract-drift": "Lock an MCP server's contract with SHA-256 fingerprints and detect breaking, potentially breaking, and non-breaking drift in CI.",
  "evidence": "MCP Rigor evidence bundles: sanitized traces, negotiated metadata, and content fingerprints proving what was tested and when.",
  "snapshots-and-replay": "Semantic snapshots with path-level diffs and safe trace replay for MCP server responses.",
  "mcp-native": "Test MCP-native behavior: notifications, subscriptions, progress, cancellation, log levels, pagination, and tasks.",
  "extension-sdk": "Extend MCP Rigor with worker-isolated custom functions and data providers using the extension SDK.",
  "error-model": "MCP Rigor's stable error taxonomy: categorized failure codes with actionable explanations for QA and CI triage.",
  "security-and-retention": "MCP Rigor security model: secret redaction, parser and network limits, extension isolation, and evidence retention policy.",
  "compatibility": "MCP Rigor compatibility: Node 20/22, Linux/macOS/Windows, MCP protocol revisions, and transport matrix.",
};

// Answer-engine FAQ used for on-page content and FAQPage JSON-LD.
const FAQ = [
  ["What is MCP Rigor?", "MCP Rigor is an open-source, deterministic, black-box test framework for Model Context Protocol (MCP) servers. QA teams write tests in natural language (.mcpr files); developers get contract locks, drift detection, evidence bundles, and transport parity. It is funded by LoopIQ."],
  ["How do I test an MCP server?", "Install with `npm install mcprigor`, create a test with `npx mcprigor init tests/acceptance.mcpr`, validate it with `npx mcprigor check`, and run it with `npx mcprigor test`. Tests call tools, read resources, and get prompts, then assert on response fields."],
  ["Does MCP Rigor use AI to interpret tests?", "No. The natural-language wording compiles deterministically — the same sentence always produces the same test. No AI model interprets the wording, which keeps runs repeatable in CI."],
  ["What transports does MCP Rigor support?", "Local stdio subprocesses and deployed Streamable HTTP servers. Transport parity mode runs the same scenario against both and reports semantic differences."],
  ["What is the .mcpr file extension?", "MCP Rigor natural-language tests use the .mcpr extension — short for MCP Rigor. A .mcpr file contains readable test scenarios that compile deterministically to the same runtime model as YAML."],
  ["Is MCP Rigor free?", "Yes. MCP Rigor is open source under the Apache-2.0 license, funded and supported by LoopIQ, the AI-Native governance platform for software releases."],
  ["Who is MCP Rigor for?", "QA engineers who want natural-language MCP tests, developers who need contract drift detection and debugging evidence, and product owners who want readable acceptance criteria with auditable proof."],
  ["Can MCP Rigor enforce MCP performance budgets?", "Yes. Tests can set per-call latency limits, suite-level percentile budgets such as p95 over 20 calls, and a CI regression gate that compares current latency with recorded history."],
  ["Can MCP Rigor audit MCP server security?", "Yes. The deterministic audit pack probes malformed requests, tool-name spoofing, oversized payloads, resource path traversal, prompt injection, and secret-canary exposure. Tool execution requires an explicit allowlist."],
  ["Can MCP Rigor test multiple MCP servers together?", "Yes. Named-server compositions route tests to individual servers, detect tool and schema collisions across the mounted fleet, and create combined contract locks for fleet drift gates."],
  ["Does MCP Rigor have a GitHub Action?", "Yes. The composite Action runs suites and contract drift, adds flaky-history warnings, writes a rich job summary, and creates or updates one pull-request comment."],
  ["How does MCP Rigor measure test coverage?", "Coverage compares test references with the live discovered MCP contract: tools, resources, resource templates, prompts, input properties, enums, and union branches. CI can enforce a minimum score."],
  ["Can MCP Rigor continuously monitor a production MCP server?", "Yes. Monitoring repeatedly runs a Streamable HTTP suite, appends results to trend history, and sends JSON webhooks on failures, recoveries, changes, or every run."],
  ["Can MCP Rigor show the raw requests and responses of a test run?", "Yes. HTML reports embed a clickable HAR-style session timeline: every JSON-RPC call with its duration, request parameters, and response body, redacted before rendering."],
  ["Can MCP Rigor share test reports outside CI?", "Yes. mcprigor publish deploys the HTML report to your own static hosting and prints a shareable URL, or writes a local bundle for any static host."],
];

const NAV = [
  { section: "Start here", pages: [
    ["GETTING-STARTED", "Getting started"],
    ["PLAIN-LANGUAGE-COOKBOOK", "Natural-language cookbook"],
    ["QA-GUIDE", "QA guide"],
    ["QA-WORKSPACE", "QA workspace"],
    ["MCP-SERVER", "MCP server for AI agents"],
    ["GUIDED-AUTHORING", "Guided authoring"],
    ["TROUBLESHOOTING", "Troubleshooting"],
  ]},
  { section: "Engineering", pages: [
    ["ENGINEER-SETUP", "Engineer setup & CI"],
    ["CLI-REFERENCE", "CLI reference"],
    ["LANGUAGE-SPEC", "Language reference"],
    ["DATA-AND-REUSE", "Data & reusable flows"],
    ["DATA-ENGINEERING", "Data engineering"],
    ["STATE-AND-DEPENDENCIES", "State & dependencies"],
    ["TRANSPORT-PARITY", "Transport parity"],
    ["PERFORMANCE-GOVERNANCE", "Performance governance"],
    ["MULTI-SERVER-COMPOSITIONS", "Multi-server compositions"],
    ["COVERAGE", "Coverage"],
    ["GITHUB-ACTION", "GitHub Action"],
    ["PUBLISHING", "Shareable hosted reports"],
  ]},
  { section: "Contracts & evidence", pages: [
    ["CONTRACT-DRIFT", "Contract drift"],
    ["EVIDENCE", "Evidence"],
    ["SNAPSHOTS-AND-REPLAY", "Snapshots & replay"],
    ["MCP-NATIVE", "MCP-native behavior"],
  ]},
  { section: "Operations", pages: [
    ["EXTENSION-SDK", "Extension SDK"],
    ["ERROR-MODEL", "Error model"],
    ["SECURITY-AUDIT", "Deterministic security audit"],
    ["MONITORING", "Scheduled monitoring"],
    ["SECURITY-AND-RETENTION", "Security & retention"],
    ["COMPATIBILITY", "Compatibility"],
  ]},
];

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugFor = (doc) => doc.toLowerCase();

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    let target = href;
    if (/^[A-Z0-9-]+\.md(#.*)?$/i.test(href) && !/^https?:/.test(href)) {
      const [file, hash] = href.split("#");
      target = `./${slugFor(basename(file, ".md"))}.html${hash ? `#${hash}` : ""}`;
    }
    const external = /^https?:/.test(target) ? ` target="_blank" rel="noopener"` : "";
    return `<a href="${target}"${external}>${label}</a>`;
  });
  return s;
}

function markdownToHtml(md) {
  const lines = md.split("\n");
  const html = [];
  let inCode = false, codeLines = [], list = null, inQuote = false, para = [], table = [];
  const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  const flushQuote = () => { if (inQuote) { html.push("</blockquote>"); inQuote = false; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.map((row) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    const body = rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
    const [head, ...rest] = body;
    html.push("<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
      rest.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
    table = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("```")) {
      flushPara(); flushList(); flushQuote(); flushTable();
      if (inCode) { html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`); codeLines = []; }
      inCode = !inCode; continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (/^\|.*\|\s*$/.test(line)) { flushPara(); flushList(); flushQuote(); table.push(line); continue; }
    flushTable();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara(); flushList(); flushQuote();
      const level = heading[1].length;
      const text = heading[2];
      const id = text.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");
      html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }
    if (/^>\s?/.test(line)) { flushPara(); flushList(); if (!inQuote) { html.push("<blockquote>"); inQuote = true; } html.push(`<p>${inline(line.replace(/^>\s?/, ""))}</p>`); continue; }
    flushQuote();
    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (ordered || bullet) {
      flushPara();
      const kind = ordered ? "ol" : "ul";
      if (list !== kind) { flushList(); html.push(`<${kind}>`); list = kind; }
      html.push(`<li>${inline((ordered ?? bullet)[1])}</li>`);
      continue;
    }
    flushList();
    if (!line.trim()) { flushPara(); continue; }
    para.push(line.trim());
  }
  flushPara(); flushList(); flushQuote(); flushTable();
  if (inCode && codeLines.length) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return html.join("\n");
}

const FUNDING = `<a class="funding" href="https://www.loopiq.com" target="_blank" rel="noopener" title="MCP Rigor is funded by LoopIQ">Funded by <strong>LoopIQ</strong></a>`;

function jsonLd(objects) {
  return objects.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n");
}

const ORG_LD = {
  "@context": "https://schema.org", "@type": "Organization",
  "@id": "https://www.loopiq.com/#org", name: "LoopIQ", url: "https://www.loopiq.com",
  description: "The AI-Native governance platform for software releases. Funder of the open-source MCP Rigor project.",
};

const APP_LD = {
  "@context": "https://schema.org", "@type": "SoftwareApplication",
  "@id": `${SITE}/#software`, name: "MCP Rigor",
  applicationCategory: "DeveloperApplication", operatingSystem: "Linux, macOS, Windows",
  softwareVersion: VERSION, url: SITE, image: `${SITE}/assets/og.png`, logo: `${SITE}/assets/logo.svg`,
  description: "Open-source, deterministic, natural-language test framework for Model Context Protocol (MCP) servers over stdio and Streamable HTTP.",
  license: "https://www.apache.org/licenses/LICENSE-2.0",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  funder: { "@id": "https://www.loopiq.com/#org" },
  keywords: "MCP testing, Model Context Protocol, MCP server testing, natural language tests, QA automation, contract testing, transport parity",
  installUrl: "https://www.npmjs.com/package/mcprigor",
  softwareRequirements: "Node.js 20 or 22",
};

function layout({ title, description, content, docsNav = "", isDocs = false, slug = "", extraLd = [] }) {
  const prefix = isDocs ? ".." : ".";
  const canonical = isDocs ? `${SITE}/docs/${slug}.html` : `${SITE}/`;
  const desc = description ?? "MCP Rigor — deterministic natural-language testing for Model Context Protocol servers. An open-source project funded by LoopIQ.";
  const breadcrumb = isDocs ? [{
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "MCP Rigor", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Documentation", item: `${SITE}/docs/getting-started.html` },
      { "@type": "ListItem", position: 3, name: title.replace(/ — MCP Rigor$/, ""), item: canonical },
    ],
  }] : [];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#010101">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MCP Rigor">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="MCP Rigor — natural-language testing for Model Context Protocol servers, funded by LoopIQ">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${SITE}/assets/og.png">
<link rel="icon" type="image/svg+xml" href="${prefix}/assets/logo.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap">
<link rel="stylesheet" href="${prefix}/assets/site.css">
${jsonLd([APP_LD, ORG_LD, ...breadcrumb, ...extraLd])}
</head>
<body class="${isDocs ? "docs" : "landing"}">
<header class="top">
  <a class="brand" href="${prefix}/index.html">
    <img src="${prefix}/assets/logo.svg" alt="MCP Rigor logo" width="34" height="34">
    <span>MCP&nbsp;Rigor</span>
  </a>
  <nav class="topnav">
    <a href="${prefix}/docs/getting-started.html">Docs</a>
    <a href="${prefix}/docs/cli-reference.html">CLI</a>
    <a href="${prefix}/docs/plain-language-cookbook.html">Cookbook</a>
    <a href="https://www.npmjs.com/package/mcprigor" target="_blank" rel="noopener">npm</a>
    <a href="https://github.com/FusionOnePlatform/mcprigor" target="_blank" rel="noopener">GitHub</a>
    ${FUNDING}
  </nav>
</header>
${docsNav}
<main class="content">
${content}
</main>
<footer class="foot">
  <div>
    <img src="${prefix}/assets/logo.svg" alt="" width="20" height="20">
    <span>MCP Rigor ${VERSION} · Apache-2.0</span>
  </div>
  <div class="foot-funding">Funded and supported by <a href="https://www.loopiq.com" target="_blank" rel="noopener"><strong>LoopIQ</strong></a> — the AI-Native governance platform for software releases</div>
</footer>
</body>
</html>`;
}

function docsSidebar(activeSlug) {
  const groups = NAV.map(({ section, pages }) =>
    `<div class="navgroup"><h4>${section}</h4>` +
    pages.map(([doc, label]) => {
      const slug = slugFor(doc);
      return `<a class="${slug === activeSlug ? "active" : ""}" href="./${slug}.html">${label}</a>`;
    }).join("") + "</div>").join("");
  return `<aside class="sidebar"><nav>${groups}</nav></aside>`;
}

const LANDING = `
<section class="hero">
  <img class="hero-logo" src="./assets/logo.svg" alt="MCP Rigor logo" width="120" height="120">
  <h1>Test MCP servers in natural language.</h1>
  <p class="tagline">MCP Rigor is an open-source, deterministic, black-box test framework for Model Context Protocol servers — built for QA teams, developers, and product owners.</p>
  <p class="funded-hero">An open-source project proudly <strong>funded by <a href="https://www.loopiq.com" target="_blank" rel="noopener">LoopIQ</a></strong>.</p>
  <div class="cta">
    <a class="button primary" href="./docs/getting-started.html">Get started</a>
    <a class="button" href="./docs/plain-language-cookbook.html">See examples</a>
  </div>
  <pre class="hero-code"><code>Test: "An active customer can be found"
  Call tool "find_customer" with:
    customerId: "C-100"

  Expect "structuredContent.status" equals "active"</code></pre>
  <p class="hero-note">No test code. No AI interpretation. The same sentence always compiles into the same test.</p>
</section>
<section class="demos">
  <h2>See it run</h2>
  <p class="demo-intro">From visual QA to agent-driven testing — every path uses the same deterministic runtime.</p>
  <div class="demo-grid">
    <article class="demo-card demo-featured">
      <h3>Visual QA workspace</h3>
      <p>Author with autocomplete, select multiple suites, run a batch, then inspect results, history, and trends.</p>
      <video class="demo-video" autoplay loop muted playsinline preload="metadata" aria-label="MCP Rigor visual QA workspace demo">
        <source src="./assets/workspace-demo.mp4" type="video/mp4">
        <img src="./assets/workspace-demo.gif" alt="MCP Rigor visual QA workspace demo" loading="lazy">
      </video>
    </article>
    <article class="demo-card">
      <h3>MCP server for AI agents</h3>
      <p>An agent connects to <code>mcprigor serve</code>, validates a suite, runs it, and receives structured results.</p>
      <video class="demo-video" autoplay loop muted playsinline preload="metadata" aria-label="MCP Rigor MCP server agent demo">
        <source src="./assets/mcp-server-demo.mp4" type="video/mp4">
        <img src="./assets/mcp-server-demo.gif" alt="MCP Rigor MCP server agent demo" loading="lazy">
      </video>
    </article>
    <article class="demo-card">
      <h3>CLI and CI</h3>
      <p>Check deterministic wording, then run the suite against a live MCP server from any terminal or pipeline.</p>
      <video class="demo-video" autoplay loop muted playsinline preload="metadata" aria-label="MCP Rigor CLI demo">
        <source src="./assets/demo.mp4" type="video/mp4">
        <img src="./assets/demo.gif" alt="MCP Rigor CLI demo" loading="lazy">
      </video>
    </article>
  </div>
</section>
<section class="grid">
  <div class="card"><h3>For QA</h3><p>Write tests that read like acceptance criteria in a local browser workspace with autocomplete, batch runs, run history, and pass-rate trends.</p></div>
  <div class="card"><h3>For AI agents</h3><p>Expose MCP Rigor as an <a href="./docs/mcp-server.html">MCP server</a> with <code>mcprigor serve</code> — coding agents write, validate, and run deterministic tests for the MCP servers they build.</p></div>
  <div class="card"><h3>For developers</h3><p>Contract locks with SHA-256 fingerprints, classified drift reports, sanitized traces, semantic snapshots, and stable error codes.</p></div>
  <div class="card"><h3>Performance governance <span class="tag">Next release</span></h3><p>Fail slow calls immediately, enforce p50/p95 budgets over recorded history, and block latency regressions in CI without maintaining a separate baseline file. <a href="./docs/performance-governance.html">Performance guide →</a></p></div>
  <div class="card"><h3>Deterministic security audit <span class="tag">Next release</span></h3><p>Probe malformed requests, spoofed tools, oversized payloads, path traversal, prompt injection, and secret exposure — then export a scored rich PDF. <a href="./docs/security-audit.html">Audit guide →</a></p></div>
  <div class="card"><h3>Multi-server compositions <span class="tag">Next release</span></h3><p>Route scenarios across a mounted MCP fleet, detect tool/schema collisions, and gate combined contract drift with one stable composition lock. <a href="./docs/multi-server-compositions.html">Composition guide →</a></p></div>
  <div class="card"><h3>GitHub Action <span class="tag">Next release</span></h3><p>Run suites and drift in CI, publish a rich job summary, and update one PR comment with pass tables, drift details, flaky warnings, and failures. <a href="./docs/github-action.html">Action guide →</a></p></div>
  <div class="card"><h3>Coverage gate <span class="tag">Next release</span></h3><p>Find untested tools, prompts, resources, templates, properties, and enum/union branches; enforce <code>--fail-under 80</code>. <a href="./docs/coverage.html">Coverage guide →</a></p></div>
  <div class="card"><h3>Production monitoring <span class="tag">Next release</span></h3><p>Schedule HTTP MCP tests, feed existing trends and performance baselines, and notify webhooks on failures and recoveries. <a href="./docs/monitoring.html">Monitoring guide →</a></p></div>
  <div class="card"><h3>Session timeline <span class="tag">Next release</span></h3><p>Every HTML report embeds a clickable HAR-style timeline: one row per JSON-RPC call with durations, request params, and response bodies. <a href="./docs/evidence.html">Evidence guide →</a></p></div>
  <div class="card"><h3>Shareable hosted reports <span class="tag">Next release</span></h3><p><code>mcprigor publish</code> turns a run into a static report URL on your own Netlify site — redacted first, gated by your hosting access. <a href="./docs/publishing.html">Publishing guide →</a></p></div>
  <div class="card"><h3>For product owners</h3><p>Readable tests double as living acceptance criteria, and evidence bundles prove what was tested, against which server, and when.</p></div>
  <div class="card"><h3>Transport parity</h3><p>Run the same scenario against a local stdio server and a deployed Streamable HTTP endpoint and see exactly where behavior differs.</p></div>
  <div class="card"><h3>Data-driven</h3><p>Tables, CSV, JSON, YAML, Excel, REST, and Google Sheets — with typed columns, filters, joins, and seeded sampling.</p></div>
  <div class="card"><h3>Safe by default</h3><p>Remote data and custom code are opt-in. Reports are sanitized and secrets are redacted centrally.</p></div>
</section>
<section class="quickstart">
  <h2>Install and run in one minute</h2>
  <pre><code>npm install mcprigor
npx mcprigor init tests/acceptance.mcpr
npx mcprigor check tests/acceptance.mcpr
npx mcprigor test tests/acceptance.mcpr --html report.html
npx mcprigor serve .   # expose as an MCP server for AI agents</code></pre>
  <p>Published on <a href="https://www.npmjs.com/package/mcprigor" target="_blank" rel="noopener">npm</a> with compiled code — no build from source. Tests use the <code>.mcpr</code> extension and compile to the same runtime model as YAML.</p>
</section>
<section class="loopiq">
  <h2>Backed by LoopIQ</h2>
  <p>MCP Rigor is funded and supported by <a href="https://www.loopiq.com" target="_blank" rel="noopener"><strong>LoopIQ</strong></a>, the AI-Native governance platform for software releases. LoopIQ connects requirements to runnable tests; MCP Rigor executes them deterministically with auditable evidence — one thread from requirement → test → execution → proof.</p>
</section>
<section class="faq">
  <h2>Frequently asked questions</h2>
  ${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a.replace(/`([^`]+)`/g, "<code>$1</code>")}</p></details>`).join("\n  ")}
</section>`;

async function build() {
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "docs"), { recursive: true });
  await mkdir(join(out, "assets"), { recursive: true });
  await cp(join(root, "site/assets/logo.svg"), join(out, "assets/logo.svg"));
  await cp(join(root, "site/assets/site.css"), join(out, "assets/site.css"));
  await cp(join(root, "site/assets/og.png"), join(out, "assets/og.png"));
  // Root-level static files (search-engine verification, etc.).
  await cp(join(root, "site/static"), out, { recursive: true, force: true }).catch(() => {});

  const faqLd = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: FAQ.map(([q, a]) => ({
      "@type": "Question", name: q,
      acceptedAnswer: { "@type": "Answer", text: a.replace(/`/g, "") },
    })),
  };
  const siteLd = {
    "@context": "https://schema.org", "@type": "WebSite",
    "@id": `${SITE}/#website`, url: `${SITE}/`, name: "MCP Rigor",
    description: "Natural-language testing for Model Context Protocol servers.",
    publisher: { "@id": "https://www.loopiq.com/#org" },
  };
  await writeFile(join(out, "index.html"), layout({
    title: "MCP Rigor — Natural-Language Testing for MCP Servers | Funded by LoopIQ",
    description: "Open-source deterministic MCP testing with natural-language tests, performance budgets, security audits, multi-server fleet drift, evidence, and transport parity. Funded by LoopIQ.",
    content: LANDING, extraLd: [faqLd, siteLd],
  }));

  const urls = [`${SITE}/`];
  const known = new Set(NAV.flatMap(({ pages }) => pages.map(([doc]) => doc + ".md")));
  const today = new Date().toISOString().slice(0, 10);
  for (const file of await readdir(join(root, "docs"))) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    if (!known.has(file)) console.warn(`(unlisted doc, still published: ${file})`);
    const md = await readFile(join(root, "docs", file), "utf8");
    const slug = slugFor(basename(file, ".md"));
    const heading = md.match(/^#\s+(.*)$/m)?.[1] ?? slug;
    const title = `${heading} — MCP Rigor`;
    const description = DESCRIPTIONS[slug] ?? md.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim().slice(0, 158);
    const articleLd = {
      "@context": "https://schema.org", "@type": "TechArticle",
      headline: heading, description,
      url: `${SITE}/docs/${slug}.html`, inLanguage: "en",
      isPartOf: { "@id": `${SITE}/#website` },
      about: { "@id": `${SITE}/#software` },
      publisher: { "@id": "https://www.loopiq.com/#org" },
      dateModified: today,
    };
    await writeFile(join(out, "docs", `${slug}.html`), layout({
      title, description, isDocs: true, slug, docsNav: docsSidebar(slug),
      content: `<article class="doc">${markdownToHtml(md)}</article>`,
      extraLd: [articleLd],
    }));
    urls.push(`${SITE}/docs/${slug}.html`);
  }

  // sitemap.xml
  await writeFile(join(out, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>${u === `${SITE}/` ? "1.0" : "0.8"}</priority></url>`).join("\n") +
    `\n</urlset>\n`);

  // robots.txt — explicitly welcome search and AI answer-engine crawlers.
  await writeFile(join(out, "robots.txt"),
`User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);

  // llms.txt — answer-engine optimization: a curated map for AI assistants.
  await writeFile(join(out, "llms.txt"),
`# MCP Rigor

> MCP Rigor is an open-source, deterministic, black-box test framework for Model Context Protocol (MCP) servers. QA teams write tests in natural language (.mcpr files) with no code and no AI interpretation; developers get contract locks, drift classification, sanitized evidence bundles, semantic snapshots, and stdio↔Streamable-HTTP transport parity. Apache-2.0 licensed, funded and supported by LoopIQ (https://www.loopiq.com), the AI-Native governance platform for software releases. Install: npm install mcprigor (published at https://www.npmjs.com/package/mcprigor, ships compiled code, no source build; Node.js 20/22).

## Docs
${NAV.flatMap(({ section, pages }) => pages.map(([doc, label]) => `- [${label}](${SITE}/docs/${slugFor(doc)}.html): ${DESCRIPTIONS[slugFor(doc)] ?? section}`)).join("\n")}

## Key facts
- Natural-language tests compile deterministically; the same sentence always produces the same test.
- Test files use the .mcpr extension (not .mcp, which conflicts with other software).
- Transports: local stdio subprocess and deployed Streamable HTTP.
- CLI: init, check, test, author, parity, workspace, serve, audit, coverage, monitor, publish, trends, composition-check, composition-discover, composition-drift, discover, generate, contract-check, contract-diff, contract-update, evidence-show, evidence-compare, snapshot-diff, replay.
- GitHub Action: runs suites and drift, adds flaky warnings, writes a job summary, updates one pull-request comment, and uploads report and drift-markdown artifacts.
- Coverage: tools, resources, templates, prompts, input properties, enums, oneOf, and anyOf with --fail-under gating.
- Monitoring: scheduled Streamable HTTP checks, transition webhooks, and shared trend history.
- HTML reports: clickable HAR-style session timeline with per-call durations, request params, and response bodies.
- Publishing: mcprigor publish deploys the redacted HTML report to static hosting and prints a shareable URL.
- Performance governance: per-call latency assertions, percentile budgets over history, and --fail-on-regression CI gating.
- Deterministic security audit: malformed requests, spoofing, oversized payloads, path traversal, prompt injection, and secret-canary exposure; tool execution requires exact --allow-tool opt-in.
- Multi-server compositions: per-test named-server routing, cross-server tool/schema/resource/prompt collision detection, stable combined locks, and fleet drift.
- Safety: remote data, custom extensions, and audit tool calls are opt-in; reports are sanitized and secrets redacted.
- Browser QA workspace (mcprigor workspace): create/rename/edit suites with syntax highlighting and autocomplete, batch-run up to 20 suites, persistent run history with pass-rate trends and full-text search.
- Complements MCP Inspector and official MCP Conformance; not a certification program.
`);

  console.log(`Built site into ${out} (${urls.length} pages + sitemap, robots, llms.txt)`);
}

await build();
