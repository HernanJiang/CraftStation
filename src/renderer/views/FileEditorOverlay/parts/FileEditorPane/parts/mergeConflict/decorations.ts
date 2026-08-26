import type { editor as MonacoEditor, IRange } from "monaco-editor";
import type { ConflictBlock } from "@/renderer/utils/mergeConflicts";

import "./mergeConflict.css";

function lineRange(line: number): IRange {
  return { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 };
}

function spanRange(startLine: number, endLine: number): IRange {
  return { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: 1 };
}

export function buildConflictDecorations(
  blocks: ConflictBlock[],
): MonacoEditor.IModelDeltaDecoration[] {
  const decorations: MonacoEditor.IModelDeltaDecoration[] = [];

  for (const block of blocks) {
    decorations.push({
      range: lineRange(block.currentHeaderLine),
      options: {
        isWholeLine: true,
        className: "lc-merge-current-header",
        linesDecorationsClassName: "lc-merge-rail-current",
        stickiness: 1,
      },
    });

    if (block.currentRange.endLine >= block.currentRange.startLine) {
      decorations.push({
        range: spanRange(block.currentRange.startLine, block.currentRange.endLine),
        options: {
          isWholeLine: true,
          className: "lc-merge-current",
          linesDecorationsClassName: "lc-merge-rail-current",
          stickiness: 1,
        },
      });
    }

    if (block.baseHeaderLine !== null) {
      const baseEnd = block.separatorLine - 1;
      decorations.push({
        range: spanRange(block.baseHeaderLine, baseEnd),
        options: { isWholeLine: true, className: "lc-merge-base", stickiness: 1 },
      });
    }

    decorations.push({
      range: lineRange(block.separatorLine),
      options: { isWholeLine: true, className: "lc-merge-separator", stickiness: 1 },
    });

    if (block.incomingRange.endLine >= block.incomingRange.startLine) {
      decorations.push({
        range: spanRange(block.incomingRange.startLine, block.incomingRange.endLine),
        options: {
          isWholeLine: true,
          className: "lc-merge-incoming",
          linesDecorationsClassName: "lc-merge-rail-incoming",
          stickiness: 1,
        },
      });
    }

    decorations.push({
      range: lineRange(block.incomingFooterLine),
      options: {
        isWholeLine: true,
        className: "lc-merge-incoming-footer",
        linesDecorationsClassName: "lc-merge-rail-incoming",
        stickiness: 1,
      },
    });
  }

  return decorations;
}
