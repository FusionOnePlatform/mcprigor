export interface SourcePosition { line: number; column: number; offset: number }
export interface SourceSpan { file: string; start: SourcePosition; end: SourcePosition }
export type LanguageNodeKind = "version" | "suite" | "server" | "import" | "flow" | "data" | "test" | "statement" | "blank" | "comment";
export interface LanguageNode { kind: LanguageNodeKind; text: string; indent: number; span: SourceSpan }
export interface LanguageDocument { version: 1; file: string; source: string; nodes: LanguageNode[] }

export class LanguageDiagnostic extends Error {
  constructor(public readonly code: string, public readonly span: SourceSpan, public readonly reason: string, public readonly hint?: string, source?: string) {
    const line = source?.split(/\r?\n/)[span.start.line - 1] ?? "";
    const caret = `${" ".repeat(Math.max(0, span.start.column - 1))}${"^".repeat(Math.max(1, span.end.column - span.start.column))}`;
    super(`${code} ${span.file}:${span.start.line}:${span.start.column}\n\n${line}\n${caret}\n\n${reason}${hint ? `\nTry: ${hint}` : ""}`);
    this.name = "LanguageDiagnostic";
  }
}

/** Formal line lexer for MCP Test 1. It owns whitespace, spans, and declaration classification. */
export function lexLanguage(source: string, file = "test.mcpr"): LanguageDocument {
  const normalized = source.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const nodes: LanguageNode[] = [];
  let offset = 0;
  let version: 1 = 1;
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    if (raw.includes("\t")) throw diagnostic("MCPLANG101", file, normalized, index + 1, raw.indexOf("\t") + 1, "Tabs are not allowed because their visual width is ambiguous.", "replace the tab with two spaces");
    const indent = raw.match(/^ */)![0].length;
    if (indent % 2 !== 0) throw diagnostic("MCPLANG102", file, normalized, index + 1, 1, "Indentation must use multiples of two spaces.", "use 0, 2, 4, or 6 leading spaces");
    const text = raw.trim();
    const kind = classify(text);
    if (/^MCP Test\s+/i.test(text)) {
      if (text !== "MCP Test 1") throw diagnostic("MCPLANG103", file, normalized, index + 1, indent + 1, `Unsupported language header “${text}”.`, "MCP Test 1");
      version = 1;
    }
    nodes.push({ kind, text, indent, span: span(file, index + 1, indent + 1, Math.max(indent + 2, raw.length + 1), offset + indent, offset + raw.length) });
    offset += raw.length + 1;
  }
  return { version, file, source: normalized, nodes };
}

export function validateLanguageDocument(document: LanguageDocument): void {
  const names = new Map<string, LanguageNode>();
  const flowNames = new Map<string, LanguageNode>();
  let currentTest = false;
  let hasAction = false;
  for (const node of document.nodes) {
    if (node.kind === "test") {
      if (currentTest && !hasAction) throw new LanguageDiagnostic("MCPLANG202", node.span, "The previous test has no action.", "add Call tool, Read resource, Get prompt, or Send", document.source);
      currentTest = true; hasAction = false;
      const name = quotedName(node.text);
      if (name) duplicate(names, name, node, document, "test");
    }
    if (node.kind === "flow") { const name = quotedName(node.text); if (name) duplicate(flowNames, name, node, document, "flow"); }
    if (/^(Call|When I call|Read|When I read|Get|When I get|Send|When I send|Use flow|For each row|Subscribe to|Unsubscribe from|Wait for notification|Set log level|List all|List tasks|Cancel task)\b/i.test(node.text)) hasAction = true;
    if (/^(Expect|Then|Save|Remember|Export|Wait up to)\b/i.test(node.text) && !hasAction) throw new LanguageDiagnostic("MCPLANG203", node.span, `“${node.text}” needs an action before it.`, "add Call tool, Read resource, Get prompt, or Send above it", document.source);
  }
  if (currentTest && !hasAction) {
    const node = [...document.nodes].reverse().find((item) => item.kind === "test")!;
    throw new LanguageDiagnostic("MCPLANG202", node.span, "This test has no action.", "add Call tool, Read resource, Get prompt, or Send", document.source);
  }
}

function classify(text: string): LanguageNodeKind {
  if (!text) return "blank";
  if (text.startsWith("#")) return "comment";
  if (/^MCP Test\s+/i.test(text)) return "version";
  if (/^Suite:/i.test(text)) return "suite";
  if (/^(Server:|MCP URL:|Connect to:|Compare target\s+|Parity target\s+|Target options for\s+|Server options:)/i.test(text)) return "server";
  if (/^Import flows from\s+/i.test(text)) return "import";
  if (/^Flow:/i.test(text)) return "flow";
  if (/^Data source:/i.test(text)) return "data";
  if (/^(Test|Scenario):/i.test(text)) return "test";
  return "statement";
}
function quotedName(text: string): string | undefined { return text.match(/^[^:]+:\s*["']([^"']+)["']/)?.[1]; }
function duplicate(map: Map<string, LanguageNode>, name: string, node: LanguageNode, document: LanguageDocument, kind: string): void {
  if (map.has(name)) throw new LanguageDiagnostic("MCPLANG201", node.span, `Duplicate ${kind} name “${name}”.`, `rename one ${kind}; names must be unique`, document.source);
  map.set(name, node);
}
function diagnostic(code: string, file: string, source: string, line: number, column: number, reason: string, hint: string): LanguageDiagnostic { return new LanguageDiagnostic(code, span(file, line, column, column + 1, 0, 0), reason, hint, source); }
function span(file: string, line: number, start: number, end: number, startOffset: number, endOffset: number): SourceSpan { return { file, start: { line, column: start, offset: startOffset }, end: { line, column: end, offset: endOffset } }; }
