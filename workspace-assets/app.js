const state = { csrf: '', path: '', etag: '', dirty: false, files: [] };
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
}

/* ---------- sidebar ---------- */
async function refreshList() {
  const value = await api('/api/v1/suites');
  state.files = value.suites;
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
    return;
  }
  for (const file of files) {
    const button = document.createElement('button');
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = file.path.endsWith('.mcpr') ? '📝' : '⚙️';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.path;
    button.title = file.path;
    button.append(icon, name);
    if (file.path === state.path) button.classList.add('active');
    button.onclick = () => open(file.path).catch(show);
    nav.append(button);
  }
}

/* ---------- editor: highlight + gutter ---------- */
const escapeHtml = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function highlight(text) {
  return text.split('\n').map(line => {
    if (/^\s*#/.test(line)) return `<span class="tok-cmt">${escapeHtml(line)}</span>`;
    let html = escapeHtml(line);
    html = html.replace(/&quot;/g, '"');
    html = html.replace(/"([^"]*)"/g, (m, inner) => `<span class="tok-str">"${inner}"</span>`);
    html = html.replace(/^(\s*)([A-Za-z][A-Za-z0-9 _-]*?)(:)/, (m, sp, word, colon) =>
      `${sp}<span class="tok-key">${word}</span>${colon}`);
    html = html.replace(/^(\s*)(Call tool|Read resource|Get prompt|Expect|Save|Send|Require|Import flows from|Use flow|Keep rows where|Test|Suite|Server|MCP URL)\b/g,
      (m, sp, word) => sp + (m.includes('tok-key') ? word : `<span class="tok-key">${word}</span>`));
    html = html.replace(/\b(-?\d+(?:\.\d+)?)\b(?![^<]*<\/span>)/g, '<span class="tok-num">$1</span>');
    return html;
  }).join('\n');
}
function syncEditor() {
  const text = $('editor').value;
  $('highlight-code').innerHTML = highlight(text) + '\n';
  const lines = text.split('\n').length;
  $('gutter').textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  syncScroll();
}
function syncScroll() {
  $('highlight').scrollTop = $('editor').scrollTop;
  $('gutter').scrollTop = $('editor').scrollTop;
}

/* ---------- welcome / states ---------- */
function showWelcome(on) {
  $('welcome').hidden = !on;
  setEnabled(!on && !!state.path);
}
function setEnabled(on) {
  for (const id of ['save', 'validate', 'run', 'parity']) $(id).disabled = !on;
}

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
  showWelcome(false);
  setEnabled(true);
  renderList();
  hideDiag();
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
  if (value.valid) diag(`✓ Valid — ${value.suite.tests} test${value.suite.tests === 1 ? '' : 's'} ready${value.suite.parityTargets.length ? ` · ${value.suite.parityTargets.length} parity targets` : ''}. Click ▶ Run tests.`, 'ok');
  else diag(value.diagnostics.map(x => x.message).join('\n'), 'err');
}

/* ---------- runs ---------- */
function colorize(output) {
  return escapeHtml(output).split('\n').map(line => {
    if (/^\s*✓/.test(line)) return `<span class="out-pass">${line}</span>`;
    if (/^\s*✗/.test(line)) return `<span class="out-fail">${line}</span>`;
    if (/^MCP Rigor/.test(line)) return `<span class="out-head">${line}</span>`;
    if (/\d+ passed/.test(line)) return `<span class="out-head">${line}</span>`;
    return line;
  }).join('\n');
}
function badge(status) {
  const el = $('run-badge');
  if (!status) { el.hidden = true; return; }
  el.hidden = false;
  el.className = `badge ${status}`;
  el.textContent = status === 'running' ? '● Running' : status === 'passed' ? '✓ Passed' : '✗ Failed';
}

async function run(mode) {
  if (!state.path) return diag('Open or create a test file first.', 'warn');
  if (state.dirty) await save(true);
  badge('running');
  $('output').textContent = `Running ${state.path}…`;
  hideDiag();
  try {
    const value = await api('/api/v1/runs', { method: 'POST', body: JSON.stringify({ path: state.path, mode }) });
    const poll = setInterval(async () => {
      try {
        const result = await api(`/api/v1/runs/${value.runId}`);
        $('output').innerHTML = colorize(result.output);
        if (result.status !== 'running') {
          clearInterval(poll);
          badge(result.status);
          if (result.status === 'passed') diag('✓ All tests passed.', 'ok');
          else diag(hintFor(result.error || result.output) || '✗ Run failed — see Run results for details.', 'err');
        }
      } catch (error) { clearInterval(poll); badge('failed'); $('output').textContent = error.message; }
    }, 500);
  } catch (error) { badge(null); show(error); }
}

function hintFor(text) {
  if (!text) return '';
  if (text.includes('MCP-SPAWN-001')) return '✗ The server command was not found. Edit the "Server:" line — it must start your MCP server from this folder.';
  if (text.includes('no Compare target')) return '✗ Parity needs a targets section with two named targets. See the cookbook for an example.';
  return '';
}

/* ---------- feedback ---------- */
let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
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
function show(error) {
  diag(hintFor(error.message) || error.message || String(error), 'err');
}

/* ---------- dialog ---------- */
function openDialog() {
  $('new-error').hidden = true;
  $('new-name').value = '';
  $('new-dialog').showModal();
  $('new-name').focus();
}
$('new-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('new-name').value.trim();
  createFile(name).then(() => $('new-dialog').close()).catch(error => {
    $('new-error').textContent = error.message;
    $('new-error').hidden = false;
  });
});
$('new-cancel').onclick = () => $('new-dialog').close();

/* ---------- wiring ---------- */
$('editor').addEventListener('input', () => { state.dirty = true; $('dirty').textContent = '● unsaved'; syncEditor(); });
$('editor').addEventListener('scroll', syncScroll);
$('editor').addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const el = $('editor');
    const start = el.selectionStart;
    el.setRangeText('  ', start, el.selectionEnd, 'end');
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
$('refresh').onclick = () => refreshList().then(n => { if (!n && !state.path) showWelcome(true); }).catch(show);
$('filter').addEventListener('input', renderList);
setEnabled(false);
start().catch(show);
