import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractOfficeText, readZipEntries } from "./officeText";

function crc32(data: Buffer): number {
  let table = (crc32 as { table?: Int32Array }).table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as { table?: Int32Array }).table = table;
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal zip writer (stored + deflated) for fixtures. */
function buildZip(files: Array<{ name: string; content: string; method?: 0 | 8 }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = Buffer.from(file.content, "utf8");
    const method = file.method ?? 0;
    const payload = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(file.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, payload);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc32(raw), 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + payload.length;
  }
  const centralDir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralDir, eocd]);
}

describe("readZipEntries", () => {
  it("reads stored and deflated entries", () => {
    const zip = buildZip([
      { name: "a.txt", content: "hello" },
      { name: "b.txt", content: "world".repeat(100), method: 8 },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.map((entry) => entry.name)).toEqual(["a.txt", "b.txt"]);
    expect(entries[0]?.data.toString("utf8")).toBe("hello");
    expect(entries[1]?.data.toString("utf8")).toBe("world".repeat(100));
  });

  it("rejects non-zip input", () => {
    expect(() => readZipEntries(Buffer.from("not a zip"))).toThrow("Not a zip archive");
  });
});

describe("extractOfficeText", () => {
  it("extracts docx paragraphs", () => {
    const zip = buildZip([
      {
        name: "word/document.xml",
        content: `<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world &amp; friends</w:t></w:r></w:p></w:body></w:document>`,
      },
    ]);
    expect(extractOfficeText("report.docx", zip)).toEqual({
      text: "Hello world & friends",
      truncated: false,
    });
  });

  it("extracts xlsx shared strings and literal values as tab-separated rows", () => {
    const zip = buildZip([
      {
        name: "xl/sharedStrings.xml",
        content: `<sst><si><t>Name</t></si><si><t>Age</t></si><si><t>Ada</t></si></sst>`,
      },
      {
        name: "xl/worksheets/sheet1.xml",
        content: `<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="B2"><v>36</v></c></row></sheetData></worksheet>`,
      },
    ]);
    expect(extractOfficeText("data.xlsx", zip)).toEqual({
      text: "Name\tAge\nAda\t36",
      truncated: false,
    });
  });

  it("extracts pptx slides with slide markers", () => {
    const zip = buildZip([
      {
        name: "ppt/slides/slide1.xml",
        content: `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Title One</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      },
      {
        name: "ppt/slides/slide2.xml",
        content: `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Title Two</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      },
    ]);
    expect(extractOfficeText("deck.pptx", zip)).toEqual({
      text: "[Slide 1]\nTitle One\n\n[Slide 2]\nTitle Two",
      truncated: false,
    });
  });

  it("rejects unsupported formats and non-zip bytes", () => {
    expect(() => extractOfficeText("legacy.doc", Buffer.from("PK"))).toThrow(
      "Unsupported Office format",
    );
    expect(() => extractOfficeText("broken.docx", Buffer.from("nope"))).toThrow(
      "Not a zip archive",
    );
  });
});
