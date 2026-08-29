import { inflateRawSync } from "node:zlib";

/**
 * Minimal, dependency-free XLSX table reader.
 *
 * Scope: read one worksheet of a well-formed .xlsx file as rows of cells —
 * shared strings, inline strings, numbers, booleans, formula cached values,
 * and date-formatted numbers (converted to ISO strings). This is not a
 * general spreadsheet library: no writing, no styles, no merged-cell
 * semantics, no macros.
 *
 * Safety: input size is validated by the caller; this module additionally
 * caps decompressed entry size and cell counts so a crafted file cannot
 * exhaust memory (zip-bomb protection).
 */

const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_CELLS = 2_000_000;

export interface XlsxSheet { name: string; rows: unknown[][] }

export function readXlsxSheet(archive: Buffer, sheetName?: string): XlsxSheet {
  const entries = readZipEntries(archive);
  const read = (path: string): string | undefined => {
    const entry = entries.get(path);
    return entry === undefined ? undefined : entry.toString("utf8");
  };
  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new Error("MCP-DATA-019 Spreadsheet is missing xl/workbook.xml");
  const date1904 = /<workbookPr[^>]*date1904="(?:1|true)"/.test(workbook);
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/?>(?:<\/sheet>)?/g)].map((m) => ({
    name: decodeEntities(attr(m[0], "name") ?? ""),
    rid: attr(m[0], "r:id") ?? attr(m[0], "id") ?? "",
  }));
  if (!sheets.length) throw new Error("MCP-DATA-019 Spreadsheet declares no worksheets");
  const chosen = sheetName === undefined ? sheets[0]! : sheets.find((s) => s.name === sheetName);
  if (!chosen) throw new Error(`MCP-DATA-008 Excel sheet “${sheetName}" was not found`);
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  const rel = [...rels.matchAll(/<Relationship\b[^>]*\/?>/g)].find((m) => attr(m[0], "Id") === chosen.rid);
  const target = rel ? attr(rel[0], "Target") ?? "" : `worksheets/sheet${sheets.indexOf(chosen) + 1}.xml`;
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheetXml = read(sheetPath.replaceAll("\\", "/"));
  if (!sheetXml) throw new Error(`MCP-DATA-019 Spreadsheet worksheet ${sheetPath} is missing`);
  const shared = parseSharedStrings(read("xl/sharedStrings.xml"));
  const dateStyles = parseDateStyles(read("xl/styles.xml"));
  return { name: chosen.name, rows: parseSheetRows(sheetXml, shared, dateStyles, date1904) };
}

// --- worksheet ---

function parseSheetRows(xml: string, shared: string[], dateStyles: Set<number>, date1904: boolean): unknown[][] {
  const rows: unknown[][] = [];
  let cells = 0;
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const rowIndex = Number(attr(rowMatch[0], "r") ?? rows.length + 1);
    while (rows.length < rowIndex - 1) rows.push([]);
    const values: unknown[] = [];
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c\b[^>]*(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (++cells > MAX_CELLS) throw new Error(`MCP-DATA-018 Spreadsheet exceeds ${MAX_CELLS.toLocaleString("en-US")} cells`);
      const reference = attr(cellMatch[0], "r");
      const column = reference ? columnIndex(reference) : values.length;
      while (values.length < column) values.push("");
      values[column] = cellValue(cellMatch[0], cellMatch[1] ?? "", shared, dateStyles, date1904);
    }
    rows.push(values);
  }
  return rows;
}

function cellValue(cellTag: string, body: string, shared: string[], dateStyles: Set<number>, date1904: boolean): unknown {
  const type = attr(cellTag, "t") ?? "n";
  if (type === "inlineStr") return decodeEntities(concatText(body));
  const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (v === undefined) return "";
  if (type === "s") return shared[Number(v)] ?? "";
  if (type === "str" || type === "e") return decodeEntities(v);
  if (type === "b") return v.trim() === "1";
  const numeric = Number(v);
  if (!Number.isFinite(numeric)) return decodeEntities(v);
  const style = Number(attr(cellTag, "s") ?? -1);
  if (dateStyles.has(style)) return excelDateToIso(numeric, date1904);
  return numeric;
}

function excelDateToIso(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(Math.round(epoch + serial * 86_400_000)).toISOString();
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference) {
    if (char >= "0" && char <= "9") break;
    index = index * 26 + (char.toUpperCase().charCodeAt(0) - 64);
  }
  return index - 1;
}

// --- shared strings and styles ---

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeEntities(concatText(m[1]!)));
}

function concatText(fragment: string): string {
  return [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => m[1] ?? "").join("");
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function parseDateStyles(xml: string | undefined): Set<number> {
  const styles = new Set<number>();
  if (!xml) return styles;
  const customDates = new Set<number>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*\/?>/g)) {
    const id = Number(attr(m[0], "numFmtId") ?? -1);
    const code = (attr(m[0], "formatCode") ?? "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    if (/[ymdhs]/i.test(code)) customDates.add(id);
  }
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  [...cellXfs.matchAll(/<xf\b[^>]*\/?>/g)].forEach((m, index) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || customDates.has(id)) styles.add(index);
  });
  return styles;
}

// --- XML helpers ---

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`))?.[1];
}

function decodeEntities(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#x?[0-9a-fA-F]+);/g, (whole, entity: string) => {
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "amp") return "&";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const code = entity.startsWith("#x") || entity.startsWith("#X") ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// --- minimal ZIP reader (central directory + stored/deflate entries) ---

function readZipEntries(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let eocd = -1;
  for (let index = archive.length - 22; index >= Math.max(0, archive.length - 22 - 65_536); index--) {
    if (archive.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("MCP-DATA-019 Spreadsheet is not a valid XLSX ZIP container");
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error("MCP-DATA-019 Spreadsheet ZIP central directory is corrupt");
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("MCP-DATA-018 Spreadsheet entry exceeds the decompressed size limit");
    if (name.startsWith("xl/") || name === "[Content_Types].xml") {
      if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("MCP-DATA-019 Spreadsheet ZIP local header is corrupt");
      const localName = archive.readUInt16LE(localOffset + 26);
      const localExtra = archive.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localName + localExtra;
      const raw = archive.subarray(start, start + compressedSize);
      if (method === 0) entries.set(name, Buffer.from(raw));
      else if (method === 8) {
        const inflated = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
        entries.set(name, inflated);
      } else throw new Error(`MCP-DATA-019 Spreadsheet uses unsupported ZIP compression method ${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
