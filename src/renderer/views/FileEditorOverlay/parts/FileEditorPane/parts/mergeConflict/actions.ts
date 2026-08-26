import type { editor as MonacoEditor, IRange } from "monaco-editor";
import type { ConflictBlock, ConflictBlockRange } from "@/renderer/utils/mergeConflicts";

export type ConflictAction = "current" | "incoming" | "both";

function fullRange(model: MonacoEditor.ITextModel, block: ConflictBlock): IRange {
  const startLine = block.fullRange.startLine;
  const endLine = block.fullRange.endLine;
  const totalLines = model.getLineCount();
  const includeTrailingNewline = endLine < totalLines;
  return {
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: includeTrailingNewline ? endLine + 1 : endLine,
    endColumn: includeTrailingNewline ? 1 : model.getLineMaxColumn(endLine),
  };
}

function rangeText(model: MonacoEditor.ITextModel, range: ConflictBlockRange): string {
  if (range.endLine < range.startLine) return "";
  const lines: string[] = [];
  for (let line = range.startLine; line <= range.endLine; line++) {
    lines.push(model.getLineContent(line));
  }
  return lines.join("\n") + "\n";
}

export function buildReplacement(
  model: MonacoEditor.ITextModel,
  block: ConflictBlock,
  action: ConflictAction,
): string {
  switch (action) {
    case "current":
      return rangeText(model, block.currentRange);
    case "incoming":
      return rangeText(model, block.incomingRange);
    case "both":
      return rangeText(model, block.currentRange) + rangeText(model, block.incomingRange);
  }
}

export function applyConflictAction(
  editor: MonacoEditor.IStandaloneCodeEditor | null,
  block: ConflictBlock,
  action: ConflictAction,
): void {
  const model = editor?.getModel();
  if (!editor || !model) return;
  const replacement = buildReplacement(model, block, action);
  const range = fullRange(model, block);
  editor.pushUndoStop();
  model.pushEditOperations(
    null,
    [{ range, text: replacement, forceMoveMarkers: true }],
    () => null,
  );
  editor.pushUndoStop();
}
