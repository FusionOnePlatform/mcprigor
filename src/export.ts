import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import type { RunResult } from "./types.js";
import type { HistoryEntry } from "./workspace.js";

/* ---------- CSV ---------- */

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvRows(rows: Array<Array<unknown>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** One row per test of a single run. */
export function runCsv(result: RunResult): string {
  const rows: Array<Array<unknown>> = [["suite", "test", "status", "durationMs", "retried", "error", "startedAt"]];
  for (const test of result.tests) rows.push([result.suiteName, test.name, test.status, test.durationMs, test.retried ? "yes" : "", test.error ?? "", result.startedAt]);
  return csvRows(rows);
}

/** One row per test occurrence across history — the raw trend data. */
export function historyCsv(entries: HistoryEntry[]): string {
  const rows: Array<Array<unknown>> = [["at", "suite", "mode", "runStatus", "runDurationMs", "test", "testStatus", "testDurationMs", "error"]];
  for (const entry of entries) {
    if (!entry.tests?.length) { rows.push([entry.at, entry.suite, entry.mode, entry.status, entry.durationMs, "", "", "", ""]); continue; }
    for (const test of entry.tests) rows.push([entry.at, entry.suite, entry.mode, entry.status, entry.durationMs, test.name, test.status, test.durationMs ?? "", test.error ?? ""]);
  }
  return csvRows(rows);
}

/** Aggregated per-test trend: totals, pass rate, average duration. */
export function trendsCsv(entries: HistoryEntry[]): string {
  const byTest = new Map<string, { suite: string; test: string; runs: number; passed: number; failed: number; skipped: number; totalMs: number; timed: number; lastStatus: string; lastAt: string }>();
  for (const entry of entries) {
    for (const test of entry.tests ?? []) {
      const key = `${entry.suite}\u0000${test.name}`;
      const row = byTest.get(key) ?? { suite: entry.suite, test: test.name, runs: 0, passed: 0, failed: 0, skipped: 0, totalMs: 0, timed: 0, lastStatus: "", lastAt: "" };
      row.runs += 1;
      if (test.status === "passed") row.passed += 1; else if (test.status === "failed") row.failed += 1; else row.skipped += 1;
      if (typeof test.durationMs === "number") { row.totalMs += test.durationMs; row.timed += 1; }
      row.lastStatus = test.status; row.lastAt = entry.at;
      byTest.set(key, row);
    }
  }
  const rows: Array<Array<unknown>> = [["suite", "test", "runs", "passed", "failed", "skipped", "passRate", "avgDurationMs", "lastStatus", "lastAt"]];
  for (const row of [...byTest.values()].sort((a, b) => a.suite.localeCompare(b.suite) || a.test.localeCompare(b.test))) {
    rows.push([row.suite, row.test, row.runs, row.passed, row.failed, row.skipped, row.runs ? (row.passed / row.runs).toFixed(3) : "", row.timed ? Math.round(row.totalMs / row.timed) : "", row.lastStatus, row.lastAt]);
  }
  return csvRows(rows);
}

/* ---------- Rich PDF writer (vector drawing, no dependencies) ---------- */

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - 2 * MARGIN;

type RGB = [number, number, number];
const INK: RGB = [0.13, 0.15, 0.14];
const DIM: RGB = [0.45, 0.48, 0.46];
const FAINT: RGB = [0.62, 0.65, 0.63];
const BRAND: RGB = [0.07, 0.42, 0.25];
const BRAND_DARK: RGB = [0.05, 0.24, 0.15];
const GREEN: RGB = [0.13, 0.62, 0.34];
const GREEN_SOFT: RGB = [0.88, 0.96, 0.91];
const RED: RGB = [0.8, 0.2, 0.18];
const RED_SOFT: RGB = [0.99, 0.92, 0.91];
const AMBER: RGB = [0.72, 0.53, 0.05];
const AMBER_SOFT: RGB = [0.99, 0.95, 0.85];
const PURPLE: RGB = [0.48, 0.25, 0.6];
const PURPLE_SOFT: RGB = [0.95, 0.91, 0.98];
const ZEBRA: RGB = [0.955, 0.965, 0.958];
const LINE: RGB = [0.85, 0.87, 0.86];

const STATUS_INK: Record<string, RGB> = { passed: GREEN, failed: RED, skipped: AMBER, blocked: PURPLE };
const STATUS_BG: Record<string, RGB> = { passed: GREEN_SOFT, failed: RED_SOFT, skipped: AMBER_SOFT, blocked: PURPLE_SOFT };

const TRANSLIT: Record<string, string> = { "\u2014": "-", "\u2013": "-", "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2026": "...", "\u2192": "->", "\u2713": "+", "\u2717": "x", "\u25cb": "o" };
function esc(text: string): string {
  return text.replace(/[\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u2192\u2713\u2717\u25cb]/g, (ch) => TRANSLIT[ch] ?? "?")
    .replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

/** Approximate Helvetica string width in points. */
function textWidth(text: string, size: number, bold = false): number {
  let width = 0;
  for (const ch of text) width += /[iIljtf.,:;'!|()\[\]]/.test(ch) ? 0.32 : /[mwMW@]/.test(ch) ? 0.89 : /[A-Z0-9]/.test(ch) ? 0.66 : 0.52;
  return width * size * (bold ? 1.05 : 1);
}

function truncate(text: string, size: number, maxWidth: number, bold = false): string {
  if (textWidth(text, size, bold) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && textWidth(out + "…", size, bold) > maxWidth) out = out.slice(0, -1);
  return out + "…";
}

function wrapText(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = []; let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size) <= maxWidth) { current = candidate; continue; }
    if (current) lines.push(current);
    current = word;
    while (textWidth(current, size) > maxWidth) {
      let cut = current.length;
      while (cut > 1 && textWidth(current.slice(0, cut), size) > maxWidth) cut--;
      lines.push(current.slice(0, cut)); current = current.slice(cut);
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** A canvas-style page builder emitting raw PDF content-stream operators. */
class Pdf {
  private pages: string[][] = [];
  private ops: string[] = [];
  y = 0;
  constructor(private title: string) { this.newPage(); }

  newPage(): void { this.ops = []; this.pages.push(this.ops); this.y = PAGE_H - MARGIN; }

  /** Break the page when fewer than `need` points remain; repaint header rule. */
  ensure(need: number): void {
    if (this.y - need < MARGIN + 18) {
      this.newPage();
      this.text(this.title, MARGIN, this.y, 8, FAINT);
      this.rule(this.y - 6);
      this.y -= 20;
    }
  }

  rect(x: number, y: number, w: number, h: number, fill: RGB, radius = 0): void {
    const [r, g, b] = fill;
    if (radius <= 0) { this.ops.push(`${r} ${g} ${b} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`); return; }
    const k = radius * 0.5523;
    const x2 = x + w, y2 = y + h;
    this.ops.push([`${r} ${g} ${b} rg`,
      `${(x + radius).toFixed(1)} ${y.toFixed(1)} m`,
      `${(x2 - radius).toFixed(1)} ${y.toFixed(1)} l`,
      `${(x2 - radius + k).toFixed(1)} ${y.toFixed(1)} ${x2.toFixed(1)} ${(y + radius - k).toFixed(1)} ${x2.toFixed(1)} ${(y + radius).toFixed(1)} c`,
      `${x2.toFixed(1)} ${(y2 - radius).toFixed(1)} l`,
      `${x2.toFixed(1)} ${(y2 - radius + k).toFixed(1)} ${(x2 - radius + k).toFixed(1)} ${y2.toFixed(1)} ${(x2 - radius).toFixed(1)} ${y2.toFixed(1)} c`,
      `${(x + radius).toFixed(1)} ${y2.toFixed(1)} l`,
      `${(x + radius - k).toFixed(1)} ${y2.toFixed(1)} ${x.toFixed(1)} ${(y2 - radius + k).toFixed(1)} ${x.toFixed(1)} ${(y2 - radius).toFixed(1)} c`,
      `${x.toFixed(1)} ${(y + radius).toFixed(1)} l`,
      `${x.toFixed(1)} ${(y + radius - k).toFixed(1)} ${(x + radius - k).toFixed(1)} ${y.toFixed(1)} ${(x + radius).toFixed(1)} ${y.toFixed(1)} c`,
      "f"].join(" "));
  }

  rule(y: number, color: RGB = LINE, x1 = MARGIN, x2 = PAGE_W - MARGIN): void {
    const [r, g, b] = color;
    this.ops.push(`${r} ${g} ${b} RG 0.7 w ${x1.toFixed(1)} ${y.toFixed(1)} m ${x2.toFixed(1)} ${y.toFixed(1)} l S`);
  }

  text(content: string, x: number, y: number, size: number, color: RGB = INK, bold = false): void {
    const [r, g, b] = color;
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${r} ${g} ${b} rg ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(content)}) Tj ET`);
  }

  /** Rounded status pill; returns its width. */
  pill(label: string, x: number, baselineY: number, size: number, ink: RGB, bg: RGB): number {
    const w = textWidth(label, size, true) + 12;
    const h = size + 7;
    this.rect(x, baselineY - 3.5, w, h, bg, h / 2);
    this.text(label, x + 6, baselineY, size, ink, true);
    return w;
  }

  /** Horizontal stat bar (used for pass-rate charts). */
  bar(x: number, y: number, w: number, h: number, ratio: number, good: RGB = GREEN, track: RGB = ZEBRA): void {
    this.rect(x, y, w, h, track, h / 2);
    if (ratio > 0) this.rect(x, y, Math.max(h, w * Math.min(1, ratio)), h, good, h / 2);
  }

  finish(): Buffer {
    const objects: string[] = [];
    const firstPageObj = 5;
    const pageRefs = this.pages.map((_, index) => firstPageObj + index * 2);
    objects.push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`);
    objects.push(`2 0 obj << /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${this.pages.length} >> endobj`);
    objects.push(`3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj`);
    objects.push(`4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj`);
    this.pages.forEach((content, index) => {
      const footer = `BT /F1 7.5 Tf ${FAINT[0]} ${FAINT[1]} ${FAINT[2]} rg ${MARGIN} 24 Td (Generated by MCP Rigor — deterministic MCP testing) Tj ET\nBT /F1 7.5 Tf ${FAINT[0]} ${FAINT[1]} ${FAINT[2]} rg ${(PAGE_W - MARGIN - textWidth(`Page ${index + 1} of ${this.pages.length}`, 7.5)).toFixed(1)} 24 Td (Page ${index + 1} of ${this.pages.length}) Tj ET`;
      const stream = deflateSync(Buffer.from(content.join("\n") + "\n" + footer, "latin1"));
      const pageObj = firstPageObj + index * 2;
      objects.push(`${pageObj} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObj + 1} 0 R >> endobj`);
      objects.push(`${pageObj + 1} 0 obj << /Length ${stream.length} /Filter /FlateDecode >> stream\n${stream.toString("latin1")}\nendstream endobj`);
    });
    const head = `%PDF-1.4\n%\xe2\xe3\xcf\xd3\n`;
    let body = ""; const offsets: number[] = [];
    for (const object of objects) { offsets.push(Buffer.byteLength(head + body, "latin1")); body += object + "\n"; }
    const xrefStart = Buffer.byteLength(head + body, "latin1");
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
    const trailer = `trailer << /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (${esc(this.title)}) /Producer (MCP Rigor) >> >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    return Buffer.from(head + body + xref + trailer, "latin1");
  }
}

function headerBand(pdf: Pdf, heading: string, subheading: string): void {
  pdf.rect(0, PAGE_H - 96, PAGE_W, 96, BRAND_DARK);
  pdf.rect(0, PAGE_H - 96, PAGE_W, 3, GREEN);
  pdf.text("MCP RIGOR", MARGIN, PAGE_H - 34, 10, [0.55, 0.85, 0.66], true);
  pdf.text(heading, MARGIN, PAGE_H - 56, 19, [1, 1, 1], true);
  pdf.text(subheading, MARGIN, PAGE_H - 76, 9.5, [0.75, 0.86, 0.79]);
  pdf.y = PAGE_H - 118;
}

function statCards(pdf: Pdf, cards: Array<{ label: string; value: string; ink?: RGB }>): void {
  const gap = 10;
  const w = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
  const h = 52;
  pdf.ensure(h + 10);
  const top = pdf.y;
  cards.forEach((card, index) => {
    const x = MARGIN + index * (w + gap);
    pdf.rect(x, top - h, w, h, ZEBRA, 6);
    pdf.text(card.value, x + 12, top - 26, 17, card.ink ?? INK, true);
    pdf.text(card.label.toUpperCase(), x + 12, top - 42, 7.5, DIM, true);
  });
  pdf.y = top - h - 16;
}

/** Full run report as a designed PDF: header band, stat cards, striped test table, failure detail. */
export function runPdf(result: RunResult): Buffer {
  const pdf = new Pdf(`MCP Rigor — ${result.suiteName}`);
  headerBand(pdf, result.suiteName, `Test report — started ${result.startedAt} — ${(result.durationMs / 1000).toFixed(2)}s — protocol ${result.protocolVersions.join(", ") || "n/a"}${result.server ? ` — server ${result.server.name ?? "unknown"} ${result.server.version ?? ""}` : ""}`);

  statCards(pdf, [
    { label: "Result", value: result.status.toUpperCase(), ink: result.status === "passed" ? GREEN : RED },
    { label: "Passed", value: String(result.summary.passed), ink: GREEN },
    { label: "Failed", value: String(result.summary.failed), ink: result.summary.failed ? RED : DIM },
    { label: "Skipped", value: String(result.summary.skipped), ink: result.summary.skipped ? AMBER : DIM },
    { label: "Blocked", value: String(result.summary.blocked), ink: result.summary.blocked ? PURPLE : DIM },
  ]);

  const total = result.summary.passed + result.summary.failed + result.summary.skipped + result.summary.blocked;
  pdf.ensure(26);
  pdf.text("Pass rate", MARGIN, pdf.y - 8, 8, DIM, true);
  pdf.bar(MARGIN + 60, pdf.y - 14, CONTENT_W - 130, 9, total ? result.summary.passed / total : 0);
  pdf.text(total ? `${Math.round((result.summary.passed / total) * 100)}%` : "n/a", PAGE_W - MARGIN - 30, pdf.y - 13, 9, INK, true);
  pdf.y -= 30;

  // Test table
  pdf.ensure(30);
  pdf.text("TESTS", MARGIN, pdf.y - 10, 8.5, BRAND, true);
  pdf.rule(pdf.y - 16, LINE);
  pdf.y -= 24;
  const colStatus = MARGIN, colName = MARGIN + 64, colDur = PAGE_W - MARGIN - 52;
  result.tests.forEach((test, index) => {
    const rowH = 20;
    pdf.ensure(rowH + 4);
    const top = pdf.y;
    if (index % 2 === 0) pdf.rect(MARGIN - 6, top - rowH + 4, CONTENT_W + 12, rowH, ZEBRA, 4);
    pdf.pill(test.status.toUpperCase(), colStatus, top - rowH + 9.5, 7, STATUS_INK[test.status] ?? INK, STATUS_BG[test.status] ?? ZEBRA);
    pdf.text(truncate(`${test.name}${test.retried ? "  (passed after retry)" : ""}`, 9.5, colDur - colName - 12), colName, top - rowH + 9.5, 9.5, INK, test.status === "failed");
    pdf.text(`${test.durationMs} ms`, colDur, top - rowH + 9.5, 8.5, DIM);
    pdf.y = top - rowH - 2;
    if (test.error) {
      for (const line of wrapText(test.error, 8.5, CONTENT_W - 76)) {
        pdf.ensure(13);
        pdf.text(line, colName, pdf.y - 8, 8.5, RED);
        pdf.y -= 12;
      }
      for (const step of test.steps) if (step.status === "failed" && step.error && step.error !== test.error) {
        for (const line of wrapText(`step ${step.name}: ${step.error}`, 8, CONTENT_W - 76)) {
          pdf.ensure(12); pdf.text(line, colName, pdf.y - 8, 8, [0.6, 0.3, 0.28]); pdf.y -= 11;
        }
      }
      pdf.y -= 4;
    }
  });

  pdf.ensure(28);
  pdf.y -= 8;
  pdf.rule(pdf.y, LINE);
  pdf.text(`Evidence hash: ${result.evidenceHash}`, MARGIN, pdf.y - 14, 7.5, FAINT);
  return pdf.finish();
}

/** Historical trends as a designed PDF: overview cards, per-suite run timelines, per-test pass-rate bars. */
export function trendsPdf(entries: HistoryEntry[], scope?: string): Buffer {
  const pdf = new Pdf("MCP Rigor — historical trends");
  const first = entries[0]?.at ?? "", last = entries[entries.length - 1]?.at ?? "";
  headerBand(pdf, "Historical trends", `${entries.length} recorded run${entries.length === 1 ? "" : "s"}${scope ? ` — ${scope}` : ""} — ${first.slice(0, 10)} to ${last.slice(0, 10)} — generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);

  const passedRuns = entries.filter((entry) => entry.status === "passed").length;
  const allTests = entries.flatMap((entry) => entry.tests ?? []);
  const passedTests = allTests.filter((test) => test.status === "passed").length;
  statCards(pdf, [
    { label: "Runs", value: String(entries.length) },
    { label: "Run pass rate", value: entries.length ? `${Math.round((passedRuns / entries.length) * 100)}%` : "n/a", ink: passedRuns === entries.length ? GREEN : passedRuns / Math.max(1, entries.length) >= 0.8 ? AMBER : RED },
    { label: "Test executions", value: String(allTests.length) },
    { label: "Test pass rate", value: allTests.length ? `${Math.round((passedTests / allTests.length) * 100)}%` : "n/a", ink: passedTests === allTests.length ? GREEN : RED },
  ]);

  const bySuite = new Map<string, HistoryEntry[]>();
  for (const entry of entries) { const list = bySuite.get(entry.suite) ?? []; list.push(entry); bySuite.set(entry.suite, list); }

  for (const [suite, runs] of [...bySuite.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    pdf.ensure(72);
    pdf.text(suite.toUpperCase(), MARGIN, pdf.y - 12, 9, BRAND, true);
    pdf.rule(pdf.y - 18, LINE);
    pdf.y -= 26;

    // Run timeline: one square per run, most recent 60
    const recent = runs.slice(-60);
    const cell = Math.min(12, Math.floor(CONTENT_W / Math.max(1, recent.length)) - 2);
    pdf.ensure(30);
    pdf.text("Run history (oldest to newest)", MARGIN, pdf.y - 8, 7.5, DIM);
    recent.forEach((run, index) => {
      pdf.rect(MARGIN + index * (cell + 2), pdf.y - 24, cell, cell, run.status === "passed" ? GREEN : RED, 2);
    });
    pdf.y -= 36;

    // Per-test aggregate rows with pass-rate bars
    const byTest = new Map<string, { runs: number; passed: number; totalMs: number; timed: number; last: string }>();
    for (const run of runs) for (const test of run.tests ?? []) {
      const row = byTest.get(test.name) ?? { runs: 0, passed: 0, totalMs: 0, timed: 0, last: "" };
      row.runs += 1; if (test.status === "passed") row.passed += 1;
      if (typeof test.durationMs === "number") { row.totalMs += test.durationMs; row.timed += 1; }
      row.last = test.status; byTest.set(test.name, row);
    }
    const nameW = CONTENT_W * 0.44;
    let zebra = 0;
    for (const [name, row] of [...byTest.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const rate = row.runs ? row.passed / row.runs : 0;
      const rowH = 18;
      pdf.ensure(rowH + 2);
      const top = pdf.y;
      if (zebra++ % 2 === 0) pdf.rect(MARGIN - 6, top - rowH + 3, CONTENT_W + 12, rowH, ZEBRA, 4);
      pdf.text(truncate(name, 8.5, nameW), MARGIN, top - rowH + 8, 8.5, INK);
      pdf.bar(MARGIN + nameW + 8, top - rowH + 7, CONTENT_W * 0.28, 7, rate, rate === 1 ? GREEN : rate >= 0.8 ? AMBER : RED);
      pdf.text(`${Math.round(rate * 100)}%`, MARGIN + nameW + 8 + CONTENT_W * 0.28 + 6, top - rowH + 8, 8, INK, true);
      pdf.text(`${row.runs} runs`, PAGE_W - MARGIN - 90, top - rowH + 8, 7.5, DIM);
      pdf.text(`avg ${row.timed ? Math.round(row.totalMs / row.timed) : 0} ms`, PAGE_W - MARGIN - 48, top - rowH + 8, 7.5, DIM);
      pdf.y = top - rowH - 1;
    }
    pdf.y -= 14;
  }
  return pdf.finish();
}

export async function writeRunCsv(result: RunResult, file: string): Promise<void> { await writeFile(file, runCsv(result), "utf8"); }
export async function writeRunPdf(result: RunResult, file: string): Promise<void> { await writeFile(file, runPdf(result)); }
