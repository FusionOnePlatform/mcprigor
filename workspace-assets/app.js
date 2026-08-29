const state = { csrf: '', path: '', etag: '', dirty: false };
const $ = id => document.getElementById(id);

const WELCOME = `Welcome to the MCP Rigor QA Workspace

Three steps:

  1. Click "+ New test file" (left) to create a test — it opens
     pre-filled with a working example you can edit.

  2. Point it at your MCP server: change the "Server:" line to your
     server command, or use  MCP URL: http://localhost:3000/mcp

  3. Click "Validate" to check the wording, then "▶ Run tests".

Already have .mcpr or YAML suites in this folder? They are listed on
the left — click one to open it.

Tip: copy-ready examples for tool calls, errors, variables, data
tables, and flows live in the cookbook: https://mcprigor.com/docs/plain-language-cookbook.html`;

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.method && options.method !== 'GET' ? { 'x-mcp-csrf': state.csrf } : {}) };
  const response = await fetch(path, { ...options, headers: { ...headers, ...options.headers } });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message || `HTTP ${response.status}`);
  return value;
}

async function start() {
  const boot = await api('/api/v1/bootstrap');
  state.csrf = boot.csrf;
  $('workspace').textContent = `Workspace folder: ${boot.root} · MCP Rigor ${boot.version}`;
  $('connection').textContent = '● Local and ready';
  const found = await suites();
  if (!found) showWelcome();
}

function showWelcome() {
  $('editor').value = WELCOME;
  $('editor').readOnly = true;
  setEnabled(false);
  note('No test files here yet — click “＋ New test file” to create your first one.');
}

function setEnabled(on) {
  for (const id of ['save', 'validate', 'run', 'parity']) $(id).disabled = !on;
}

async function suites() {
  const value = await api('/api/v1/suites');
  const nav = $('suites');
  nav.replaceChildren();
  if (!value.suites.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No test files yet.';
    nav.append(empty);
    return 0;
  }
  for (const suite of value.suites) {
    const button = document.createElement('button');
    button.textContent = suite.path;
    button.title = suite.path;
    button.onclick = () => open(suite.path, button).catch(show);
    nav.append(button);
  }
  return value.suites.length;
}

async function open(path, button) {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const value = await api(`/api/v1/file?path=${encodeURIComponent(path)}`);
  state.path = path; state.etag = value.etag; state.dirty = false;
  $('editor').value = value.text;
  $('editor').readOnly = false;
  setEnabled(true);
  $('dirty').textContent = '';
  document.querySelectorAll('nav button').forEach(x => x.classList.remove('active'));
  if (button) button.classList.add('active');
  note(`Opened ${path} — edit, then Validate and ▶ Run tests.`);
}

async function createFile() {
  const name = prompt('Name for the new test file (e.g. "checkout tests"):');
  if (!name) return;
  const value = await api('/api/v1/file', { method: 'POST', body: JSON.stringify({ name }) });
  await suites();
  const target = [...document.querySelectorAll('nav button')].find(x => x.textContent === value.path);
  await open(value.path, target);
  note(`Created ${value.path} with a working example. Set the "Server:" line to your MCP server, then ▶ Run tests.`);
}

async function save() {
  if (!state.path) return;
  const value = await api('/api/v1/file', { method: 'PUT', body: JSON.stringify({ path: state.path, text: $('editor').value, etag: state.etag }) });
  state.etag = value.etag; state.dirty = false;
  $('dirty').textContent = '';
  note('Saved.');
}

async function validate() {
  if (!state.path) return note('Open or create a test file first.');
  if (state.dirty) await save();
  const value = await api('/api/v1/validate', { method: 'POST', body: JSON.stringify({ path: state.path }) });
  if (value.valid) note(`✓ Valid — ${value.suite.tests} test${value.suite.tests === 1 ? '' : 's'} ready${value.suite.parityTargets.length ? ` · ${value.suite.parityTargets.length} parity targets` : ''}. Click ▶ Run tests.`);
  else note(value.diagnostics.map(x => x.message).join('\n'));
}

async function run(mode) {
  if (!state.path) return note('Open or create a test file first.');
  if (state.dirty) await save();
  $('output').textContent = 'Starting…';
  const value = await api('/api/v1/runs', { method: 'POST', body: JSON.stringify({ path: state.path, mode }) });
  const poll = setInterval(async () => {
    try {
      const result = await api(`/api/v1/runs/${value.runId}`);
      $('output').textContent = result.output;
      if (result.status !== 'running') {
        clearInterval(poll);
        note(result.status === 'passed' ? '✓ Run passed' : '✗ Run failed — details are in Run results on the right.');
      }
    } catch (error) { clearInterval(poll); $('output').textContent = error.message; }
  }, 500);
}

function note(message) { $('diagnostics').textContent = message; }
function show(error) {
  let message = error.message || String(error);
  if (message.includes('MCP-SPAWN-001')) message += '\nTip: the "Server:" line must be a command that starts your MCP server from this folder.';
  note(message);
}

$('editor').addEventListener('input', () => { if (!$('editor').readOnly) { state.dirty = true; $('dirty').textContent = '● Unsaved'; } });
$('new').onclick = () => createFile().catch(show);
$('save').onclick = () => save().catch(show);
$('validate').onclick = () => validate().catch(show);
$('run').onclick = () => run('test').catch(show);
$('parity').onclick = () => run('parity').catch(show);
$('refresh').onclick = () => suites().then(n => { if (!n && !state.path) showWelcome(); }).catch(show);
start().catch(show);
