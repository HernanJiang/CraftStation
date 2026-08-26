export interface ConflictBlockRange {
  startLine: number;
  endLine: number;
}

export interface ConflictBlock {
  currentHeaderLine: number;
  separatorLine: number;
  incomingFooterLine: number;
  baseHeaderLine: number | null;
  currentRange: ConflictBlockRange;
  incomingRange: ConflictBlockRange;
  fullRange: ConflictBlockRange;
  currentLabel: string;
  incomingLabel: string;
}

const CURRENT_RE = /^<{7}(?:\s(.*))?$/;
const BASE_RE = /^\|{7}(?:\s.*)?$/;
const SEPARATOR_RE = /^={7}\s*$/;
const INCOMING_RE = /^>{7}(?:\s(.*))?$/;

export function parseMergeConflicts(text: string): ConflictBlock[] {
  if (!text || (!text.includes("<<<<<<<") && !text.includes(">>>>>>>"))) return [];
  const lines = text.split(/\r?\n/);
  const blocks: ConflictBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const currentLine = lines[i];
    const currentMatch = currentLine ? currentLine.match(CURRENT_RE) : null;
    if (!currentMatch) {
      i++;
      continue;
    }

    const currentHeaderLine = i + 1;
    const currentLabel = (currentMatch[1] ?? "").trim();
    let separatorLine = -1;
    let baseHeaderLine: number | null = null;
    let incomingFooterLine = -1;
    let incomingLabel = "";

    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      if (line === undefined) {
        j++;
        continue;
      }
      if (CURRENT_RE.test(line)) {
        // Nested/unterminated — abandon this block, continue scan from j.
        break;
      }
      if (BASE_RE.test(line) && separatorLine === -1) {
        baseHeaderLine = j + 1;
      } else if (SEPARATOR_RE.test(line) && separatorLine === -1) {
        separatorLine = j + 1;
      } else if (separatorLine !== -1) {
        const incoming = line.match(INCOMING_RE);
        if (incoming) {
          incomingFooterLine = j + 1;
          incomingLabel = (incoming[1] ?? "").trim();
          break;
        }
      }
      j++;
    }

    if (separatorLine !== -1 && incomingFooterLine !== -1) {
      blocks.push({
        currentHeaderLine,
        separatorLine,
        incomingFooterLine,
        baseHeaderLine,
        currentRange: { startLine: currentHeaderLine + 1, endLine: separatorLine - 1 },
        incomingRange: { startLine: separatorLine + 1, endLine: incomingFooterLine - 1 },
        fullRange: { startLine: currentHeaderLine, endLine: incomingFooterLine },
        currentLabel,
        incomingLabel,
      });
      i = incomingFooterLine;
    } else {
      i = j;
    }
  }

  return blocks;
}

export function hasUnresolvedConflicts(text: string): boolean {
  return parseMergeConflicts(text).length > 0;
}
