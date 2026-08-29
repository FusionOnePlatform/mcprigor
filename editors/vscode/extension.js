// MCP Rigor VS Code extension: on-save validation via the mcprigor CLI.
// Plain CommonJS, zero dependencies beyond the vscode API.
const vscode = require("vscode");
const { exec } = require("node:child_process");

let diagnostics;

function activate(context) {
  diagnostics = vscode.languages.createDiagnosticCollection("mcprigor");
  context.subscriptions.push(diagnostics);
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.languageId !== "mcpr") return;
    if (!vscode.workspace.getConfiguration("mcprigor").get("validateOnSave", true)) return;
    validate(document);
  }));
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
    if (document.languageId === "mcpr") validate(document);
  }));
  for (const document of vscode.workspace.textDocuments) if (document.languageId === "mcpr") validate(document);
}

function validate(document) {
  const command = vscode.workspace.getConfiguration("mcprigor").get("command", "npx mcprigor");
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const cwd = folder ? folder.uri.fsPath : undefined;
  exec(`${command} check "${document.uri.fsPath}"`, { cwd, timeout: 30000 }, (_error, _stdout, stderr) => {
    const items = [];
    // Errors look like: QA-LANG-001 [category] /path/file.mcpr:12 Message text
    const pattern = /^([A-Z]+-[A-Z]+-\d+)\s+\[[^\]]+\]\s+(.+?):(\d+)\s+(.*)$/gm;
    let match;
    while ((match = pattern.exec(stderr)) !== null) {
      const [, code, file, lineText, message] = match;
      if (!document.uri.fsPath.endsWith(file) && !file.endsWith(document.uri.fsPath)) {
        if (!sameFile(file, document.uri.fsPath)) continue;
      }
      const line = Math.max(0, Number(lineText) - 1);
      const range = document.lineAt(Math.min(line, document.lineCount - 1)).range;
      const item = new vscode.Diagnostic(range, `${code} ${message}`, vscode.DiagnosticSeverity.Error);
      item.source = "mcprigor";
      items.push(item);
    }
    // Fallback: a failure with no parseable location goes on line 1
    if (!items.length && stderr.includes("MCP Rigor could not continue")) {
      const firstLine = stderr.split("\n").find((entry) => /^[A-Z]+-[A-Z]+-\d+/.test(entry.trim()));
      if (firstLine) {
        const item = new vscode.Diagnostic(document.lineAt(0).range, firstLine.trim(), vscode.DiagnosticSeverity.Error);
        item.source = "mcprigor";
        items.push(item);
      }
    }
    diagnostics.set(document.uri, items);
  });
}

function sameFile(a, b) {
  try { return require("node:fs").realpathSync(a) === require("node:fs").realpathSync(b); } catch { return false; }
}

function deactivate() { if (diagnostics) diagnostics.dispose(); }

module.exports = { activate, deactivate };
