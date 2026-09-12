import { useMemo } from "react";
import { Trans } from "@lingui/react/macro";

const MAX_PREVIEW_ROWS = 200;
const MAX_PREVIEW_COLS = 50;

/** Minimal RFC-4180 reader: quoted fields, `""` escapes, newlines in quotes. */
export function parseCsvRows(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  while (index < content.length) {
    const char = content[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 2;
        } else {
          inQuotes = false;
          index += 1;
        }
      } else {
        field += char === "\r" ? "" : char;
        index += 1;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      index += 1;
    } else if (char === delimiter) {
      pushField();
      index += 1;
    } else if (char === "\n") {
      pushField();
      rows.push(row);
      row = [];
      index += 1;
    } else if (char === "\r") {
      index += 1;
    } else {
      field += char;
      index += 1;
    }
  }
  pushField();
  rows.push(row);
  // Drop the single empty row a trailing newline produces.
  if (rows.length > 0 && rows[rows.length - 1]!.length === 1 && rows[rows.length - 1]![0] === "") {
    rows.pop();
  }
  return rows;
}

function sniffDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
  // Score candidates by field count on the header line; ties prefer `,`.
  let best = ",";
  let bestCount = 0;
  for (const candidate of [",", ";", "\t", "|"]) {
    const count = parseCsvRows(firstLine, candidate)[0]?.length ?? 0;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function CsvPreview(props: { content: string }) {
  const { rows, truncated } = useMemo(() => {
    const all = parseCsvRows(props.content, sniffDelimiter(props.content));
    const truncatedByRows = all.length > MAX_PREVIEW_ROWS;
    const sliced = all.slice(0, MAX_PREVIEW_ROWS).map((row) => row.slice(0, MAX_PREVIEW_COLS));
    const truncatedByCols = all.some((row) => row.length > MAX_PREVIEW_COLS);
    return { rows: sliced, truncated: truncatedByRows || truncatedByCols };
  }, [props.content]);

  const isEmpty =
    rows.length === 0 ||
    rows.every((row) => row.every((cell) => cell.trim().length === 0));
  if (isEmpty) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted">
        <Trans>Empty CSV file.</Trans>
      </div>
    );
  }
  const [header, ...body] = rows;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-auto px-4 py-3">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-[var(--content-background)]">
            <tr>
              {header!.map((cell, index) => (
                <th
                  key={index}
                  className="border border-[color:var(--border)] px-2 py-1 text-left font-semibold text-foreground"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-[var(--row-hover)]">
                {header!.map((_, colIndex) => (
                  <td
                    key={colIndex}
                    className="max-w-64 truncate border border-[color:var(--border)] px-2 py-1 text-muted"
                    title={row[colIndex] ?? ""}
                  >
                    {row[colIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated ? (
        <p className="shrink-0 border-t border-[color:var(--border)] px-4 py-1.5 text-xs text-muted">
          <Trans>Preview truncated — open the file for the full table.</Trans>
        </p>
      ) : null}
    </div>
  );
}
