import { inflateRawSync } from "node:zlib";

/**
 * Plain-text extraction for OOXML documents (docx/xlsx/pptx) so the side
 * pane can preview Office files without native renderers or new dependencies.
 * A minimal zip reader (stored + deflated entries) feeds small XML text
 * collectors per format. Output is capped; formatting, images and embedded
 * objects are intentionally dropped — full fidelity stays with the OS
 * default app (`openProjectEntryWithSystem`).
 */

export const OFFICE_PREVIEW_MAX_CHARS = 30_000;

interface ZipEntry {
  name: string;
  data: Buffer;
}

function findEndOfCentralDirectory(data: Buffer): number {
  // EOCD is at least 22 bytes; the comment may push it up to 64KiB earlier.
  const start = Math.max(0, data.length - (0xffff + 22));
  for (let offset = data.length - 22; offset >= start; offset -= 1) {
    if (
      data[offset] === 0x50 &&
      data[offset + 1] === 0x4b &&
      data[offset + 2] === 0x05 &&
      data[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error("Not a zip archive: end-of-central-directory record not found.");
}

export function readZipEntries(data: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(data);
  const entryCount = data.readUInt16LE(eocd + 10);
  const centralOffset = data.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (data.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Not a zip archive: corrupt central directory.");
    }
    const method = data.readUInt16LE(cursor + 10);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const name = data.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if (data.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Not a zip archive: bad local header for ${name}.`);
    }
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = data.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.push({ name, data: Buffer.from(raw) });
    } else if (method === 8) {
      entries.push({ name, data: inflateRawSync(raw) });
    } else {
      throw new Error(`Unsupported zip compression method ${method} for ${name}.`);
    }
  }
  return entries;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&(lt|gt|amp|quot|apos);/g, (_match, entity: string) => {
      switch (entity) {
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return "&";
      }
    })
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/** Collect the text of every `<tag>…</tag>` occurrence, in document order. */
function collectTagText(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "g");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    out.push(decodeXmlEntities((match[1] ?? "").replace(/<[^>]+>/g, "")));
  }
  return out;
}

function entryMap(entries: ZipEntry[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.name, entry.data.toString("utf8")]));
}

function extractDocxText(entries: Map<string, string>): string {
  // Main body plus the usual satellite parts; each keeps paragraph breaks.
  const parts: string[] = [];
  for (const name of [
    "word/document.xml",
    "word/footnotes.xml",
    "word/endnotes.xml",
    "word/comments.xml",
  ]) {
    const xml = entries.get(name);
    if (!xml) continue;
    const withBreaks = xml
      .replace(/<w:br\s*\/>/g, "\n")
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n");
    parts.push(collectTagText(withBreaks, "w:t").join(""));
  }
  return parts.join("\n").replace(/[ \t]+\n/g, "\n").trim();
}

function extractXlsxText(entries: Map<string, string>): string {
  const sharedStrings = entries.has("xl/sharedStrings.xml")
    ? collectTagText(entries.get("xl/sharedStrings.xml")!, "t")
    : [];
  const sheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const sheets = sheetNames.length > 0 ? sheetNames : ["xl/worksheets/sheet1.xml"];
  const lines: string[] = [];
  for (const name of sheets) {
    const xml = entries.get(name);
    if (!xml) continue;
    // Rows first so `</row>` survives cell splitting; shared-string refs
    // (`t="s"`) resolve through the table, other values stay literal.
    const rows = xml.split(/<\/row>/);
    for (const row of rows) {
      const cells = row.split(/<\/c>/).flatMap((cell) => {
        if (!/<c[\s>]/.test(cell)) return [];
        const sharedMatch = /<v>(\d+)<\/v>/.exec(cell);
        if (/<c[^>]*\st="s"/.test(cell) && sharedMatch?.[1] !== undefined) {
          return [sharedStrings[Number(sharedMatch[1])] ?? ""];
        }
        const inline = collectTagText(cell, "t");
        if (inline.length > 0) return inline;
        const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(cell);
        return valueMatch?.[1] !== undefined ? [decodeXmlEntities(valueMatch[1])] : [];
      });
      if (cells.length > 0) lines.push(cells.join("\t"));
    }
  }
  return lines.join("\n").trim();
}

function extractPptxText(entries: Map<string, string>): string {
  const slideNames = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return slideNames
    .map((name, index) => {
      const body = collectTagText(entries.get(name)!, "a:t").join("\n");
      return `[Slide ${index + 1}]\n${body}`;
    })
    .join("\n\n")
    .trim();
}

export interface OfficeTextResult {
  text: string;
  truncated: boolean;
}

/** Extract preview text from docx/xlsx/pptx bytes. Throws on invalid input. */
export function extractOfficeText(fileName: string, data: Buffer): OfficeTextResult {
  const lower = fileName.toLowerCase();
  const kind =
    lower.endsWith(".docx") ? "docx" : lower.endsWith(".xlsx") ? "xlsx" : lower.endsWith(".pptx") ? "pptx" : null;
  if (kind === null) {
    throw new Error(`Unsupported Office format: ${fileName}`);
  }
  const entries = entryMap(readZipEntries(data));
  const raw =
    kind === "docx"
      ? extractDocxText(entries)
      : kind === "xlsx"
        ? extractXlsxText(entries)
        : extractPptxText(entries);
  if (raw.length <= OFFICE_PREVIEW_MAX_CHARS) return { text: raw, truncated: false };
  return { text: `${raw.slice(0, OFFICE_PREVIEW_MAX_CHARS)}…`, truncated: true };
}
