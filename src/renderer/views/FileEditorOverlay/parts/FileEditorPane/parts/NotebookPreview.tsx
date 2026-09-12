import { useMemo } from "react";
import { Trans } from "@lingui/react/macro";
import { MarkdownPreview } from "@/renderer/views/FileEditorOverlay/parts/MarkdownPreview";

const MAX_PREVIEW_CELLS = 100;
const MAX_OUTPUT_CHARS = 2_000;

interface NotebookOutput {
  text?: string;
  image?: string;
  error?: string;
}

interface NotebookCell {
  kind: "markdown" | "code";
  executionCount: number | null;
  source: string;
  outputs: NotebookOutput[];
}

function asStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}…` : text;
}

function parseOutput(output: unknown): NotebookOutput | null {
  if (output === null || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  const type = record.output_type;
  if (type === "stream") {
    const text = asStringArray(record.text).join("");
    return text ? { text: truncate(text) } : null;
  }
  if (type === "error") {
    const lines = [
      typeof record.ename === "string" ? record.ename : "",
      typeof record.evalue === "string" ? record.evalue : "",
    ]
      .filter(Boolean)
      .join(": ");
    return lines ? { error: truncate(lines) } : null;
  }
  if (type === "execute_result" || type === "display_data") {
    const data = record.data;
    if (data !== null && typeof data === "object") {
      const bundle = data as Record<string, unknown>;
      const text = bundle["text/plain"];
      if (text !== undefined) {
        const joined = asStringArray(text).join("");
        return joined ? { text: truncate(joined) } : null;
      }
      const image = bundle["image/png"];
      if (typeof image === "string" && image.length > 0) {
        return { image: `data:image/png;base64,${asStringArray(image).join("")}` };
      }
    }
    return null;
  }
  return null;
}

function parseNotebook(content: string): { cells: NotebookCell[]; truncated: boolean } {
  const parsed: unknown = JSON.parse(content);
  if (parsed === null || typeof parsed !== "object") throw new Error("not a notebook");
  const rawCells = (parsed as { cells?: unknown }).cells;
  if (!Array.isArray(rawCells)) throw new Error("not a notebook");
  const cells: NotebookCell[] = [];
  for (const raw of rawCells) {
    if (raw === null || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const type = record.cell_type;
    if (type !== "markdown" && type !== "code") continue;
    const source = asStringArray(record.source).join("");
    const executionCount =
      typeof record.execution_count === "number" ? record.execution_count : null;
    const outputs =
      type === "code" && Array.isArray(record.outputs)
        ? record.outputs.flatMap((output) => {
            const parsedOutput = parseOutput(output);
            return parsedOutput ? [parsedOutput] : [];
          })
        : [];
    cells.push({ kind: type, executionCount, source, outputs });
  }
  return {
    cells: cells.slice(0, MAX_PREVIEW_CELLS),
    truncated: cells.length > MAX_PREVIEW_CELLS,
  };
}

export function NotebookPreview(props: { content: string }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, ...parseNotebook(props.content) };
    } catch {
      return { ok: false as const };
    }
  }, [props.content]);

  if (!parsed.ok) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted">
        <Trans>Could not parse this notebook — open it as text instead.</Trans>
      </div>
    );
  }
  if (parsed.cells.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted">
        <Trans>Empty notebook.</Trans>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto px-4 py-3">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {parsed.cells.map((cell, index) =>
          cell.kind === "markdown" ? (
            <div
              key={index}
              className="rounded-md border border-[color:var(--border)] px-3 py-1"
            >
              <MarkdownPreview content={cell.source} compact />
            </div>
          ) : (
            <div key={index}>
              <p className="mb-1 font-mono text-[11px] text-muted">
                {cell.executionCount === null ? "In [ ]:" : `In [${cell.executionCount}]:`}
              </p>
              <pre className="overflow-auto rounded-md border border-[color:var(--border)] bg-black/20 px-3 py-2 font-mono text-xs text-foreground">
                {cell.source}
              </pre>
              {cell.outputs.map((output, outputIndex) => (
                <div key={outputIndex} className="mt-1">
                  {output.text !== undefined ? (
                    <pre className="overflow-auto px-3 py-1 font-mono text-xs whitespace-pre-wrap text-muted">
                      {output.text}
                    </pre>
                  ) : null}
                  {output.error !== undefined ? (
                    <pre className="overflow-auto px-3 py-1 font-mono text-xs whitespace-pre-wrap text-danger">
                      {output.error}
                    </pre>
                  ) : null}
                  {output.image !== undefined ? (
                    <img
                      src={output.image}
                      alt=""
                      className="mt-1 max-w-full rounded-md border border-[color:var(--border)]"
                      draggable={false}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ),
        )}
        {parsed.truncated ? (
          <p className="text-xs text-muted">
            <Trans>Preview truncated — open the file for all cells.</Trans>
          </p>
        ) : null}
      </div>
    </div>
  );
}
