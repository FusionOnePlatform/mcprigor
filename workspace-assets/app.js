const state = { csrf: '', path: '', etag: '', dirty: false, files: [], selected: new Set(), run: null, history: [], tab: 'run', runSel: -1 };
const $ = id => document.getElementById(id);

/* ---------- API ---------- */
async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.method && options.method !== 'GET' ? { 'x-mcp-csrf': state.csrf } : {}) };
  const response = await fetch(path, { ...options, headers: { ...headers, ...options.headers } });
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.error?.message || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return value;
}

/* ---------- boot ---------- */
async function start() {
  const boot = await api('/api/v1/bootstrap');
  state.csrf = boot.csrf;
  $('version').textContent = `v${boot.version}`;
  $('workspace').textContent = `Folder: ${boot.root}`;
  $('connection').classList.add('ok');
  $('connection').innerHTML = '<span class="dot"></span>Local · ready';
  const count = await refreshList();
  if (!count) showWelcome(true);
  loadHistory().catch(() => {});
}

/* ---------- sidebar ---------- */
async function refreshList() {
  const value = await api('/api/v1/suites');
  state.files = value.suites;
  for (const path of [...state.selected]) if (!value.suites.some(f => f.path === path)) state.selected.delete(path);
  renderList();
  return value.suites.length;
}

function renderList() {
  const query = $('filter').value.trim().toLowerCase();
  const nav = $('suites');
  nav.replaceChildren();
  const files = state.files.filter(f => !query || f.path.toLowerCase().includes(query));
  if (!files.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = state.files.length ? 'No files match the filter.' : 'No test files yet. Create one to get started.';
    nav.append(p);
  }
  for (const file of files) {
    const row = document.createElement('div');
    row.className = 'suite-row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = state.selected.has(file.path);
    check.title = 'Select for batch run';
    check.onchange = () => { check.checked ? state.selected.add(file.path) : state.selected.delete(file.path); renderBatchBar(); };
    const button = document.createElement('button');
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = file.path.endsWith('.mcpr') ? '📝' : '⚙️';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.path;
    button.title = file.path;
    const rn = document.createElement('span');
    rn.className = 'rn';
    rn.textContent = '✏️';
    rn.title = 'Rename';
    rn.onclick = event => { event.stopPropagation(); openRename(file.path); };
    button.append(icon, name, rn);
    if (file.path === state.path) button.classList.add('active');
    button.onclick = () => open(file.path).catch(show);
    row.append(check, button);
    nav.append(row);
  }
  renderBatchBar();
}

function renderBatchBar() {
  const n = state.selected.size;
  $('batch-bar').hidden = n === 0;
  $('batch-count').textContent = `${n} file${n === 1 ? '' : 's'} selected`;
}

/* ---------- editor ---------- */
const escapeHtml = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function highlightSrc(text) {
  return text.split('\n').map(line => {
    if (/^\s*#/.test(line)) return `<span class="tok-cmt">${escapeHtml(line)}</span>`;
    let html = escapeHtml(line);
    html = html.replace(/&quot;/g, '"');
    html = html.replace(/"([^"]*)"/g, (m, inner) => `<span class="tok-str">"${inner}"</span>`);
    html = html.replace(/^(\s*)([A-Za-z][A-Za-z0-9 _-]*?)(:)/, (m, sp, word, colon) => `${sp}<span class="tok-key">${word}</span>${colon}`);
    html = html.replace(/^(\s*)(Call tool|Read resource|Get prompt|Expect|Save|Send|Require|Import flows from|Use flow|Keep rows where|Test|Suite|Server|MCP URL)\b/g,
      (m, sp, word) => sp + (m.includes('tok-key') ? word : `<span class="tok-key">${word}</span>`));
    html = html.replace(/\b(-?\d+(?:\.\d+)?)\b(?![^<]*<\/span>)/g, '<span class="tok-num">$1</span>');
    return html;
  }).join('\n');
}
let errorLine = 0;
function markErrorLine(line) { errorLine = line; syncEditor(); }
function jumpToLine(line) {
  const el = $('editor');
  const index = el.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
  el.focus();
  el.setSelectionRange(index, index);
  el.scrollTop = Math.max(0, (line - 4) * 13.5 * 1.65);
  syncScroll();
}
function syncEditor() {
  const text = $('editor').value;
  const lines = highlightSrc(text).split('\n');
  if (errorLine >= 1 && errorLine <= lines.length) lines[errorLine - 1] = `<span class="line-err">${lines[errorLine - 1] || ' '}</span>`;
  $('highlight-code').innerHTML = lines.join('\n') + '\n';
  $('gutter').textContent = Array.from({ length: text.split('\n').length }, (_, i) => i + 1).join('\n');
  syncScroll();
}
function syncScroll() { $('highlight').scrollTop = $('editor').scrollTop; $('gutter').scrollTop = $('editor').scrollTop; }


/* ---------- autocomplete ---------- */
const SUGGESTIONS = [
  { text: 'MCP Test 1', desc: 'Version header — first line of every file', top: true },
  { text: 'Suite: "', desc: 'Name this suite (shown in reports and history)', top: true },
  { text: 'Server: ', desc: 'Command that starts your MCP server, e.g. node dist/server.js', top: true },
  { text: 'MCP URL: ', desc: 'Connect to a deployed HTTP endpoint instead', top: true },
  { text: 'Data source: ', desc: 'CSV or XLSX file for data-driven tests', top: true },
  { text: 'Import flows from ', desc: 'Reuse shared flows from another file', top: true },
  { text: 'Test: "', desc: 'Start a new test with a descriptive name', top: true },
  { text: 'Flow: "', desc: 'Define a reusable sequence of steps', top: true },
  { text: 'Call tool "', desc: 'Invoke an MCP tool (add  with:  for arguments)' },
  { text: 'Read resource "', desc: 'Read an MCP resource by URI' },
  { text: 'Get prompt "', desc: 'Fetch an MCP prompt' },
  { text: 'Send "ping"', desc: 'Protocol-level request' },
  { text: 'Use flow "', desc: 'Run a flow defined or imported in this file' },
  { text: 'Require: tools', desc: 'Skip this test unless the server declares the capability' },
  { text: 'Expect "', desc: 'Assert on a response field, e.g. Expect "structuredContent.sum" equals 5' },
  { text: 'Expect it succeeds', desc: 'Assert the call did not error' },
  { text: 'Expect an error', desc: 'Assert the call fails' },
  { text: 'Expect error code ', desc: 'Assert a specific JSON-RPC error code' },
  { text: 'Expect error message matches "', desc: 'Regex match on the error message' },
  { text: 'Save "', desc: 'Store a response field:  Save "field.path" as "name"' },
  { text: 'Wait for notification "', desc: 'Wait for a server notification within a timeout' },
  { text: 'Subscribe to "', desc: 'Subscribe to resource updates' },
];
const EXPECT_TAILS = [
  { text: 'equals ', desc: 'Exact value match' },
  { text: 'contains "', desc: 'Substring match' },
  { text: 'matches "', desc: 'Regular-expression match' },
  { text: 'exists', desc: 'Field must be present' },
  { text: 'is a number', desc: 'Type check' },
  { text: 'has ', desc: 'Array length, e.g. has 3 items' },
  { text: 'does not equal ', desc: 'Negated match' },
  { text: 'matches snapshot "', desc: 'Compare against a stored snapshot' },
];
let suggest = { open: false, items: [], sel: 0, from: 0 };

function currentLine() {
  const el = $('editor');
  const upTo = el.value.slice(0, el.selectionStart);
  const startIdx = upTo.lastIndexOf('\n') + 1;
  return { text: upTo.slice(startIdx), startIdx, caret: el.selectionStart };
}

function computeSuggestions() {
  const { text, startIdx } = currentLine();
  const stripped = text.replace(/^\s+/, '');
  const indentLen = text.length - stripped.length;
  // After an Expect "field" — offer comparison tails
  const tail = stripped.match(/^Expect\s+"[^"]*"\s+(\w*)$/i);
  if (tail) {
    const prefix = tail[1] || '';
    const items = EXPECT_TAILS.filter(i => i.text.toLowerCase().startsWith(prefix.toLowerCase()));
    return { items, from: startIdx + text.length - prefix.length, prefix };
  }
  if (!stripped.length || /["\d]/.test(stripped[0])) return { items: [], from: 0, prefix: '' };
  const topLevel = indentLen === 0;
  const items = SUGGESTIONS
    .filter(i => i.text.toLowerCase().startsWith(stripped.toLowerCase()) && i.text.length > stripped.length)
    .filter(i => topLevel ? true : !i.top);
  return { items, from: startIdx + indentLen, prefix: stripped };
}

function renderSuggest() {
  const box = $('suggest');
  if (!suggest.open || !suggest.items.length) { box.hidden = true; suggest.open = false; return; }
  box.hidden = false;
  box.replaceChildren();
  suggest.items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === suggest.sel ? 'sel' : '';
    const prefixLen = suggest.prefix.length;
    button.innerHTML = `<b>${escapeHtml(item.text.slice(0, prefixLen))}</b>${escapeHtml(item.text.slice(prefixLen))}<span class="desc">${escapeHtml(item.desc)}</span>`;
    button.onmousedown = event => { event.preventDefault(); acceptSuggestion(index); };
    box.append(button);
  });
  // position under the caret line
  const el = $('editor');
  const lines = el.value.slice(0, el.selectionStart).split('\n');
  const lineHeight = 13.5 * 1.65;
  const top = Math.min((lines.length) * lineHeight - el.scrollTop + 22, el.clientHeight - 40);
  const col = lines[lines.length - 1].length;
  box.style.top = `${Math.max(30, top)}px`;
  box.style.left = `${Math.min(18 + col * 8.1, el.clientWidth - 300)}px`;
}

function openSuggest() {
  const { items, from, prefix } = computeSuggestions();
  suggest = { open: items.length > 0, items: items.slice(0, 9), sel: 0, from, prefix };
  renderSuggest();
}
function closeSuggest() { suggest.open = false; renderSuggest(); }
function acceptSuggestion(index) {
  const item = suggest.items[index ?? suggest.sel];
  if (!item) return;
  const el = $('editor');
  el.setRangeText(item.text, suggest.from, el.selectionStart, 'end');
  closeSuggest();
  state.dirty = true; $('dirty').textContent = '● unsaved';
  syncEditor();
  el.focus();
}

/* ---------- rename ---------- */
let renameTarget = '';
function openRename(path) {
  renameTarget = path;
  const base = path.replace(/\.[^.]+$/, '');
  $('rename-error').hidden = true;
  $('rename-name').value = base;
  $('rename-dialog').showModal();
  $('rename-name').select();
}
async function doRename(to) {
  const value = await api('/api/v1/rename', { method: 'POST', body: JSON.stringify({ from: renameTarget, to }) });
  const wasOpen = state.path === renameTarget;
  if (state.selected.has(renameTarget)) { state.selected.delete(renameTarget); state.selected.add(value.path); }
  await refreshList();
  if (wasOpen) { state.path = value.path; $('filename').textContent = value.path; renderList(); }
  loadHistory().catch(() => {});
  toast(`Renamed to ${value.path}`);
}

/* ---------- states ---------- */
function showWelcome(on) { $('welcome').hidden = !on; setEnabled(!on && !!state.path); }
function setEnabled(on) { for (const id of ['save', 'validate', 'run', 'parity']) $(id).disabled = !on; }

/* ---------- file ops ---------- */
async function open(path) {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const value = await api(`/api/v1/file?path=${encodeURIComponent(path)}`);
  state.path = path; state.etag = value.etag; state.dirty = false;
  $('editor').value = value.text;
  syncEditor();
  $('filename').textContent = path;
  $('filename').classList.add('open');
  $('dirty').textContent = '';
  showWelcome(false); setEnabled(true); renderList(); hideDiag(); markErrorLine(0);
  $('rename').hidden = false;
}

async function createFile(name) {
  const value = await api('/api/v1/file', { method: 'POST', body: JSON.stringify({ name }) });
  await refreshList();
  await open(value.path);
  toast(`Created ${value.path}`);
  diag('Next: set the "Server:" line to your MCP server command (or use MCP URL: for a deployed endpoint), then click Validate and ▶ Run tests.', 'warn');
}

async function save(silent) {
  if (!state.path) return;
  const value = await api('/api/v1/file', { method: 'PUT', body: JSON.stringify({ path: state.path, text: $('editor').value, etag: state.etag }) });
  state.etag = value.etag; state.dirty = false;
  $('dirty').textContent = '';
  if (!silent) toast('Saved');
}

async function validate() {
  if (!state.path) return diag('Open or create a test file first.', 'warn');
  if (state.dirty) await save(true);
  const value = await api('/api/v1/validate', { method: 'POST', body: JSON.stringify({ path: state.path }) });
  if (value.valid) { markErrorLine(0); diag(`✓ Valid — ${value.suite.tests} test${value.suite.tests === 1 ? '' : 's'} ready${value.suite.parityTargets.length ? ` · ${value.suite.parityTargets.length} parity targets` : ''}. Click ▶ Run tests.`, 'ok'); }
  else {
    const first = value.diagnostics[0];
    diag(value.diagnostics.map(x => x.message).join('\n'), 'err');
    if (first?.line) { markErrorLine(first.line); jumpToLine(first.line); }
  }
}

/* ---------- runs ---------- */
function colorize(output, query) {
  return escapeHtml(output).split('\n').map(line => {
    let html = line;
    if (query) html = markMatches(html, query);
    if (/^\s*✓/.test(line)) return `<span class="out-pass">${html}</span>`;
    if (/^\s*✗/.test(line)) return `<span class="out-fail">${html}</span>`;
    if (/^MCP Rigor/.test(line) || /\d+ passed/.test(line)) return `<span class="out-head">${html}</span>`;
    return html;
  }).join('\n');
}
function markMatches(html, query) {
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`(${safe})`, 'gi'), '<span class="mark">$1</span>');
}
function badge(status) {
  const el = $('run-badge');
  if (!status) { el.hidden = true; return; }
  el.hidden = false;
  el.className = `badge ${status}`;
  el.textContent = status === 'running' ? '● Running' : status === 'passed' ? '✓ Passed' : '✗ Failed';
}

async function run(mode, paths) {
  const targets = paths ?? (state.path ? [state.path] : null);
  if (!targets) return diag('Open or create a test file first.', 'warn');
  if (state.dirty) await save(true);
  switchTab('run');
  badge('running');
  state.run = null; state.runSel = -1;
  $('run-list').replaceChildren();
  $('output').textContent = `Running ${targets.length === 1 ? targets[0] : targets.length + ' files'}…`;
  hideDiag();
  try {
    const value = await api('/api/v1/runs', { method: 'POST', body: JSON.stringify({ paths: targets, mode }) });
    const poll = setInterval(async () => {
      try {
        const result = await api(`/api/v1/runs/${value.runId}`);
        state.run = result;
        renderRun();
        if (result.status !== 'running') {
          clearInterval(poll);
          badge(result.status);
          const failed = result.items.filter(i => i.status === 'failed').length;
          if (result.status === 'passed') diag(`✓ ${result.items.length === 1 ? 'All tests passed.' : `All ${result.items.length} files passed.`}`, 'ok');
          else diag(hintFor(result.items.map(i => i.error || i.output).join('\n')) || `✗ ${failed} of ${result.items.length} file${result.items.length === 1 ? '' : 's'} failed — click a file above for its report.`, 'err');
          if (mode === 'test') loadHistory().catch(() => {});
        }
      } catch (error) { clearInterval(poll); badge('failed'); $('output').textContent = error.message; }
    }, 500);
  } catch (error) { badge(null); show(error); }
}

function renderRun() {
  const run = state.run;
  if (!run) return;
  const query = $('results-filter').value.trim();
  const list = $('run-list');
  list.replaceChildren();
  if (run.items.length > 1) {
    run.items.forEach((item, index) => {
      const row = document.createElement('button');
      row.className = 'run-item' + (index === state.runSel ? ' selected' : '');
      row.innerHTML = `<span class="st ${item.status === 'passed' ? 'pass' : item.status === 'failed' ? 'fail' : 'running'}">${item.status === 'passed' ? '✓' : item.status === 'failed' ? '✗' : '●'}</span><span class="nm">${escapeHtml(item.suite)}</span><span class="ms">${item.durationMs != null ? item.durationMs + 'ms' : ''}</span>`;
      row.onclick = () => { state.runSel = index; renderRun(); };
      list.append(row);
    });
  }
  const active = run.items.length === 1 ? run.items[0] : run.items[state.runSel] ?? null;
  if (active) $('output').innerHTML = colorize(active.output, query);
  else {
    const matching = query ? run.items.map(i => i.output).join('\n\n').split('\n').filter(l => l.toLowerCase().includes(query.toLowerCase())).join('\n') : '';
    $('output').innerHTML = query && matching ? colorize(matching, query) : '<span class="muted">Click a file above to see its report' + (query ? ' — or matching lines are shown when you search.' : '.') + '</span>';
  }
}

function hintFor(text) {
  if (!text) return '';
  if (text.includes('MCP-SPAWN-001')) return '✗ The server command was not found. Edit the "Server:" line — it must start your MCP server from this folder.';
  if (text.includes('no targets section')) return '✗ Parity needs a targets section with two named targets. See the cookbook for an example.';
  return '';
}

/* ---------- history ---------- */
async function loadHistory() {
  const value = await api('/api/v1/history');
  state.history = value.entries;
  renderHistory();
  renderTrends();
}

function renderHistory() {
  const query = $('results-filter').value.trim().toLowerCase();
  const list = $('history-list');
  list.replaceChildren();
  const entries = [...state.history].reverse().filter(e =>
    !query || e.suite.toLowerCase().includes(query) || e.tests.some(t => t.name.toLowerCase().includes(query) || (t.error || '').toLowerCase().includes(query)));
  if (!entries.length) {
    list.innerHTML = `<p class="muted pad">${state.history.length ? 'No history matches the search.' : 'No runs recorded yet. History appears after the first ▶ Run.'}</p>`;
    return;
  }
  for (const entry of entries.slice(0, 100)) {
    const el = document.createElement('div');
    el.className = 'h-entry';
    const matchingTests = query ? entry.tests.filter(t => t.name.toLowerCase().includes(query) || (t.error || '').toLowerCase().includes(query)) : entry.tests;
    el.innerHTML = `<div class="h-head"><span class="st ${entry.status === 'passed' ? 'pass' : 'fail'}">${entry.status === 'passed' ? '✓' : '✗'}</span><span class="suite">${escapeHtml(entry.suite)}</span><span class="when">${timeAgo(entry.at)} · ${entry.durationMs}ms</span></div>
      <div class="h-tests">${(query ? matchingTests : entry.tests).map(t => `<div class="h-test"><span class="st ${t.status === 'passed' ? 'pass' : 'fail'}">${t.status === 'passed' ? '✓' : '✗'}</span><span>${query ? markMatches(escapeHtml(t.name), query) : escapeHtml(t.name)} <span class="muted">(${t.durationMs}ms)</span>${t.error ? `<div class="err">${query ? markMatches(escapeHtml(t.error), query) : escapeHtml(t.error)}</div>` : ''}</span></div>`).join('')}</div>`;
    el.querySelector('.h-head').onclick = () => el.classList.toggle('open');
    if (query && matchingTests.length) el.classList.add('open');
    list.append(el);
  }
}

/* ---------- trends ---------- */
function renderTrends() {
  const query = $('results-filter').value.trim().toLowerCase();
  const wrap = $('trends');
  wrap.replaceChildren();
  const bySuite = new Map();
  for (const entry of state.history) {
    if (!bySuite.has(entry.suite)) bySuite.set(entry.suite, []);
    bySuite.get(entry.suite).push(entry);
  }
  const suites = [...bySuite.entries()].filter(([name]) => !query || name.toLowerCase().includes(query));
  if (!suites.length) {
    wrap.innerHTML = `<p class="muted pad">${state.history.length ? 'No suites match the search.' : 'Trends appear after a few runs.'}</p>`;
    return;
  }
  for (const [suite, entries] of suites) {
    const recent = entries.slice(-30);
    const passRate = Math.round(100 * entries.filter(e => e.status === 'passed').length / entries.length);
    const avg = Math.round(entries.reduce((total, e) => total + e.durationMs, 0) / entries.length);
    const maxMs = Math.max(...recent.map(e => e.durationMs), 1);
    const testStats = new Map();
    for (const entry of entries) for (const test of entry.tests) {
      if (!testStats.has(test.name)) testStats.set(test.name, { pass: 0, total: 0 });
      const stat = testStats.get(test.name);
      stat.total++; if (test.status === 'passed') stat.pass++;
    }
    const testRows = [...testStats.entries()]
      .filter(([name]) => !query || suite.toLowerCase().includes(query) || name.toLowerCase().includes(query))
      .map(([name, s]) => {
        const pct = Math.round(100 * s.pass / s.total);
        return `<div class="t-test"><span class="nm">${escapeHtml(name)}</span><span class="bar"><i style="width:${pct}%"></i></span><span class="pct">${pct}%</span></div>`;
      }).join('');
    const el = document.createElement('div');
    el.className = 't-suite';
    el.innerHTML = `<div class="t-name">${escapeHtml(suite)}</div>
      <div class="t-row">
        <span class="spark">${recent.map(e => `<i class="${e.status === 'passed' ? 'pass' : 'fail'}" style="height:${Math.max(13, Math.round(30 * e.durationMs / maxMs))}px" title="${new Date(e.at).toLocaleString()} · ${e.status} · ${e.durationMs}ms"></i>`).join('')}</span>
        <span class="t-stats"><span class="t-rate">${passRate}% pass rate</span><span>${entries.length} run${entries.length === 1 ? '' : 's'} · avg ${avg}ms</span></span>
      </div>
      ${testRows ? `<div class="t-test-list">${testRows}</div>` : ''}`;
    wrap.append(el);
  }
}

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/* ---------- tabs ---------- */
function switchTab(tab) {
  state.tab = tab;
  for (const name of ['run', 'history', 'trends']) {
    $(`tab-${name}`).classList.toggle('active', name === tab);
    $(`tab-${name}`).setAttribute('aria-selected', String(name === tab));
    $(`panel-${name}`).hidden = name !== tab;
  }
}
$('tab-run').onclick = () => switchTab('run');
$('tab-history').onclick = () => { switchTab('history'); loadHistory().catch(show); };
$('tab-trends').onclick = () => { switchTab('trends'); loadHistory().catch(show); };
$('results-filter').addEventListener('input', () => { renderRun(); renderHistory(); renderTrends(); });

/* ---------- feedback ---------- */
let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}
function diag(message, kind) {
  const el = $('diagnostics');
  el.hidden = false;
  el.className = `diagnostics${kind ? ` ${kind}` : ''}`;
  el.textContent = message;
}
function hideDiag() { $('diagnostics').hidden = true; }
function show(error) { diag(hintFor(error.message) || error.message || String(error), 'err'); }

/* ---------- dialog ---------- */
function openDialog() {
  $('new-error').hidden = true;
  $('new-name').value = '';
  $('new-dialog').showModal();
  $('new-name').focus();
}
$('new-form').addEventListener('submit', event => {
  event.preventDefault();
  createFile($('new-name').value.trim()).then(() => $('new-dialog').close()).catch(error => {
    $('new-error').textContent = error.message;
    $('new-error').hidden = false;
  });
});
$('new-cancel').onclick = () => $('new-dialog').close();
$('rename-form').addEventListener('submit', event => {
  event.preventDefault();
  doRename($('rename-name').value.trim()).then(() => $('rename-dialog').close()).catch(error => {
    $('rename-error').textContent = error.message;
    $('rename-error').hidden = false;
  });
});
$('rename-cancel').onclick = () => $('rename-dialog').close();
$('rename').onclick = () => { if (state.path) openRename(state.path); };
$('filename').ondblclick = () => { if (state.path) openRename(state.path); };

/* ---------- wiring ---------- */
$('editor').addEventListener('input', () => { state.dirty = true; $('dirty').textContent = '● unsaved'; markErrorLine(0); openSuggest(); });
$('editor').addEventListener('blur', () => setTimeout(closeSuggest, 150));
$('editor').addEventListener('click', closeSuggest);
$('editor').addEventListener('scroll', syncScroll);
$('editor').addEventListener('keydown', event => {
  if (suggest.open) {
    if (event.key === 'ArrowDown') { event.preventDefault(); suggest.sel = (suggest.sel + 1) % suggest.items.length; renderSuggest(); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); suggest.sel = (suggest.sel - 1 + suggest.items.length) % suggest.items.length; renderSuggest(); return; }
    if (event.key === 'Tab' || event.key === 'Enter') { event.preventDefault(); acceptSuggestion(); return; }
    if (event.key === 'Escape') { closeSuggest(); return; }
  }
  if (event.key === ' ' && event.ctrlKey) { event.preventDefault(); openSuggest(); return; }
  if (event.key === 'Tab') {
    event.preventDefault();
    const el = $('editor');
    el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
    state.dirty = true; $('dirty').textContent = '● unsaved';
    syncEditor();
  }
});
document.addEventListener('keydown', event => {
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key === 's') { event.preventDefault(); save().catch(show); }
  if (meta && event.key === 'Enter') { event.preventDefault(); run('test').catch(show); }
  if (meta && event.key === 'n' && !event.shiftKey) { event.preventDefault(); openDialog(); }
});
$('new').onclick = openDialog;
$('welcome-new').onclick = openDialog;
$('save').onclick = () => save().catch(show);
$('validate').onclick = () => validate().catch(show);
$('run').onclick = () => run('test').catch(show);
$('parity').onclick = () => run('parity').catch(show);
$('batch-run').onclick = () => run('test', [...state.selected]).catch(show);
$('batch-parity').onclick = () => run('parity', [...state.selected]).catch(show);
$('batch-validate').onclick = () => run('validate', [...state.selected]).catch(show);
$('batch-clear').onclick = () => { state.selected.clear(); renderList(); };
$('refresh').onclick = () => refreshList().then(n => { if (!n && !state.path) showWelcome(true); }).catch(show);
$('filter').addEventListener('input', renderList);
setEnabled(false);
start().catch(show);
