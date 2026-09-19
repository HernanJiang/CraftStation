import { Link } from "@heroui/react";
import { Suspense, useDeferredValue, useMemo } from "react";
import type { ProjectLocation } from "@/shared/contracts";
import { useSmoothStreamedText } from "@/renderer/hooks/useSmoothStreamedText";
import { openExternalWithFeedback } from "@/renderer/utils/openExternal";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { normalizeChatProjectPath } from "../../chatPathUtils";
import { InlineFilePathChip } from "./InlineFilePathChip";
import { InlineFolderPathChip } from "./InlineFolderPathChip";
import { parseProjectPathRef, PROJECT_PATH_TOKEN_SOURCE } from "./parseProjectPathRef";
import { DeferredItemMarkdownInner } from "@/renderer/deferredFeatures";

interface ItemMarkdownProps {
  text: string;
}

interface SmoothItemMarkdownProps extends ItemMarkdownProps {
  isStreaming: boolean;
}

export function SmoothItemMarkdown({ text, isStreaming }: SmoothItemMarkdownProps) {
  const smoothedText = useSmoothStreamedText(text, isStreaming);
  const deferredText = useDeferredValue(smoothedText);
  return <ItemMarkdown text={isStreaming ? deferredText : text} />;
}

/**
 * Compact markdown renderer used by every chat row (assistant, user,
 * reasoning). The heavy renderer (Streamdown + remark plugins) is lazy-loaded
 * so it doesn't block app startup; until the chunk arrives we fall back to a
 * plain-text view that still chips URLs and project paths so the first paint
 * is never blank.
 */
export function ItemMarkdown({ text }: ItemMarkdownProps) {
  const actions = useChatPaneActions();
  const rootNames = actions?.projectRootNames;
  return (
    <Suspense
      fallback={
        <PlainText text={text} rootNames={rootNames} projectLocation={actions?.projectLocation} />
      }
    >
      <DeferredItemMarkdownInner text={text} />
    </Suspense>
  );
}

function PlainText({
  text,
  rootNames,
  projectLocation,
}: {
  text: string;
  rootNames: ReadonlySet<string> | undefined;
  projectLocation: ProjectLocation | undefined;
}) {
  const actions = useChatPaneActions();
  // Re-tokenizing on every render dominates the plain-text path during
  // streaming (regex scan over the full message body for each delta).
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional escape hatch
  const nodes = useMemo(() => tokenizePlainText(text, rootNames), [text, rootNames]);
  const toRelative = (path: string) =>
    projectLocation ? normalizeChatProjectPath(path, projectLocation) : path;
  return (
    <div className="whitespace-pre-wrap break-words text-[length:var(--lc-chat-font-size)] leading-snug text-foreground">
      {nodes.map((node, i) => {
        if (node.kind === "text") return <span key={i}>{node.value}</span>;
        if (node.kind === "url") {
          return (
            <Link
              key={i}
              href={node.href}
              rel="noreferrer noopener"
              className="[display:inline] [width:auto] [overflow-wrap:anywhere] [word-break:break-word]"
              onClick={(event) => {
                event.preventDefault();
                openExternalWithFeedback(node.href);
              }}
            >
              {node.href}
            </Link>
          );
        }
        if (node.kind === "file") {
          return (
            <InlineFilePathChip
              key={i}
              path={toRelative(node.path)}
              line={node.line}
              endLine={node.endLine}
              onOpen={actions?.openProjectRelativePath}
            />
          );
        }
        return (
          <InlineFolderPathChip
            key={i}
            path={toRelative(node.path)}
            onRevealInTree={actions?.revealProjectFolderInTree}
            onShowInExplorer={actions?.showProjectEntryInExplorer}
          />
        );
      })}
    </div>
  );
}

type PlainTextNode =
  | { kind: "text"; value: string }
  | { kind: "url"; href: string }
  | { kind: "file"; path: string; line?: number; endLine?: number }
  | { kind: "folder"; path: string };

const PLAIN_TOKEN_RE = new RegExp(`https?:\\/\\/[^\\s<>"']+|${PROJECT_PATH_TOKEN_SOURCE}`, "g");

function tokenizePlainText(
  text: string,
  rootNames: ReadonlySet<string> | undefined,
): PlainTextNode[] {
  PLAIN_TOKEN_RE.lastIndex = 0;
  const out: PlainTextNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = PLAIN_TOKEN_RE.exec(text)) !== null) {
    if (/^https?:\/\//i.test(match[0])) {
      const href = trimTrailingUrlPunctuation(match[0]);
      if (href.length === 0) continue;
      if (match.index > cursor) {
        out.push({ kind: "text", value: text.slice(cursor, match.index) });
      }
      out.push({ kind: "url", href });
      cursor = match.index + href.length;
      PLAIN_TOKEN_RE.lastIndex = cursor;
      continue;
    }

    const ref = parseProjectPathRef(match[0], { rootNames });
    if (!ref) continue;
    if (match.index > cursor) {
      out.push({ kind: "text", value: text.slice(cursor, match.index) });
    }
    if (ref.kind === "file") {
      out.push(
        ref.line !== undefined
          ? {
              kind: "file",
              path: ref.path,
              line: ref.line,
              ...(ref.endLine !== undefined ? { endLine: ref.endLine } : {}),
            }
          : { kind: "file", path: ref.path },
      );
    } else {
      out.push({ kind: "folder", path: ref.path });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor === 0) return [{ kind: "text", value: text }];
  if (cursor < text.length) out.push({ kind: "text", value: text.slice(cursor) });
  return out;
}

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[),.;:!?]+$/, "");
}

/**
 * remark-gfm only recognizes a markdown table when the separator row's cell
 * count exactly matches the header row's cell count. If the model emits a
 * mismatched separator (e.g. `|---|---|---|` under a 4-cell header), the entire
 * block is rejected and rendered as raw piped text — the failure mode users
 * report as a "corrupted table". Rewrite the separator to match the header
 * before handing the text to Streamdown so the table renders.
 */
export function normalizeGfmTableSeparators(text: string): string {
  const lineParts = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g);
  if (!lineParts) return text;
  let inFence = false;
  let changed = false;
  for (let i = 0; i < lineParts.length - 1; i++) {
    const line = lineParts[i];
    if (line === undefined) continue;
    const newlineMatch = line.match(/(\r\n|\n|\r)$/);
    const body = newlineMatch ? line.slice(0, -newlineMatch[0].length) : line;
    if (/^ {0,3}```/.test(body)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const nextLine = lineParts[i + 1];
    if (nextLine === undefined) continue;
    const nextNewlineMatch = nextLine.match(/(\r\n|\n|\r)$/);
    const nextBody = nextNewlineMatch ? nextLine.slice(0, -nextNewlineMatch[0].length) : nextLine;
    if (!isPotentialTableRow(body)) continue;
    if (!isTableSeparatorRow(nextBody)) continue;
    const headerCells = splitTableCells(body);
    const sepCells = splitTableCells(nextBody);
    if (headerCells.length === 0) continue;
    if (headerCells.length === sepCells.length) continue;
    const rebuilt = buildSeparatorRow(headerCells.length, sepCells);
    lineParts[i + 1] = rebuilt + (nextNewlineMatch?.[0] ?? "");
    changed = true;
  }
  return changed ? lineParts.join("") : text;
}

function isPotentialTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  if (/[^\s|:-]/.test(trimmed)) return true;
  // Models occasionally emit a table with an all-empty header (`| | |`) — no
  // text character, so the check above rejects it and the mismatched separator
  // is never rewritten, leaving the whole block as raw piped text. An empty
  // header row is still a table row: at least two pipes forming >= 1 column,
  // and never a separator row (those contain `-`).
  return (trimmed.match(/\|/g)?.length ?? 0) >= 2 && /^[|\s]+$/.test(trimmed);
}

function isTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(trimmed);
}

function splitTableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|");
}

function buildSeparatorRow(cellCount: number, sourceCells: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < cellCount; i++) {
    const src = (sourceCells[i] ?? "").trim();
    let cell = "---";
    if (/^:-+:$/.test(src)) cell = ":---:";
    else if (/^:-+$/.test(src)) cell = ":---";
    else if (/^-+:$/.test(src)) cell = "---:";
    parts.push(cell);
  }
  return `| ${parts.join(" | ")} |`;
}

/**
 * Models sometimes use the diagram type as a fence language (`flowchart` or
 * `graph`) instead of Mermaid's canonical `mermaid` language. Normalize only
 * known Mermaid diagram declarations so ordinary code fences keep their label.
 */
export function normalizeMermaidFenceLanguages(text: string): string {
  const lines = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g);
  if (!lines) return text;
  let changed = false;
  const normalized = [...lines];
  for (let index = 0; index < normalized.length; index += 1) {
    const line = normalized[index];
    if (line === undefined) continue;
    const newlineMatch = line.match(/(\r\n|\n|\r)$/);
    const newline = newlineMatch?.[0] ?? "";
    const body = newline ? line.slice(0, -newline.length) : line;
    const match = body.match(/^( {0,3})(```|~~~)([^\s`]*)\s*(.*)$/u);
    if (!match) continue;
    const language = match[3]?.trim();
    if (language && isMermaidFenceLanguage(language)) {
      changed = true;
      normalized[index] =
        `${match[1]}${match[2]}mermaid${match[4] ? ` ${match[4]}` : ""}${newline}`;
      continue;
    }
    if (language) continue;
    const declaration = normalized
      .slice(index + 1)
      .map((content) => content.replace(/(?:\r\n|\n|\r)$/u, "").trim())
      .find((content) => content.length > 0);
    if (isMermaidDeclaration(declaration)) {
      changed = true;
      normalized[index] = `${match[1]}${match[2]}mermaid${newline}`;
    }
  }
  return changed ? normalized.join("") : text;
}

function isMermaidDeclaration(line: string | undefined): boolean {
  return /^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b|^(?:sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|journey|gantt|pie|quadrantChart|gitGraph|mindmap|timeline|xychart(?:-beta)?)\b/iu.test(
    line ?? "",
  );
}

function isMermaidFenceLanguage(language: string | undefined): boolean {
  return /^(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|journey|gantt|pie|quadrantChart|gitGraph|mindmap|timeline|xychart(?:-beta)?)$/u.test(
    language ?? "",
  );
}

/**
 * Models frequently emit LaTeX with the classic `\[ … \]` / `\( … \)`
 * delimiters, but remark-math only recognizes `$$ … $$` / `$ … $`. Rewrite the
 * classic delimiters (outside fenced code and inline code) so the math plugin
 * renders them. A rewrite requires a math signal (LaTeX command, `^`, `_`,
 * `=`) so backslash-escaped prose brackets like `\[1\]` and `\[text\](url)`
 * links survive untouched.
 */
export function normalizeLatexMathDelimiters(text: string): string {
  let changed = false;
  const converted = splitSegmentsOutsideFences(text).map((segment) => {
    if (segment.inFence) return segment.text;
    const next = convertLatexDelimitersOutsideInlineCode(segment.text);
    if (next !== segment.text) changed = true;
    return next;
  });
  return changed ? converted.join("") : text;
}

interface FenceSegment {
  inFence: boolean;
  text: string;
}

function splitSegmentsOutsideFences(text: string): FenceSegment[] {
  const segments: FenceSegment[] = [];
  let inFence = false;
  let buffer = "";
  for (const line of text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []) {
    if (/^ {0,3}(?:```|~~~)/.test(line)) {
      segments.push({ inFence, text: buffer });
      buffer = line;
      inFence = !inFence;
      continue;
    }
    buffer += line;
  }
  segments.push({ inFence, text: buffer });
  return segments;
}

const LATEX_DISPLAY_MATH_RE = /\\\[([\s\S]*?)\\\](?!\()/gu;
const LATEX_INLINE_MATH_RE = /\\\(([\s\S]*?)\\\)/gu;
const LATEX_MATH_SIGNAL_RE = /\\[a-zA-Z]|[=^_]/u;

function convertLatexDelimitersOutsideInlineCode(text: string): string {
  if (!text.includes("\\")) return text;
  const parts = text.split(/(`[^`\n]*`)/);
  let changed = false;
  const converted = parts.map((part, index) => {
    if (index % 2 === 1) return part;
    const next = convertLatexDelimiters(part);
    if (next !== part) changed = true;
    return next;
  });
  return changed ? converted.join("") : text;
}

function convertLatexDelimiters(text: string): string {
  let changed = false;
  let out = text.replace(LATEX_DISPLAY_MATH_RE, (match, body: string) => {
    if (!LATEX_MATH_SIGNAL_RE.test(body)) return match;
    changed = true;
    const math = body.trim();
    // Bodies that span lines (delimiters on their own lines) become a display
    // block; single-line ones stay inline (as `$$…$$`) so they don't break out
    // of a surrounding paragraph/list.
    return body.includes("\n") ? `\n$$\n${math}\n$$\n` : `$$${math}$$`;
  });
  out = out.replace(LATEX_INLINE_MATH_RE, (match, body: string) => {
    if (!LATEX_MATH_SIGNAL_RE.test(body)) return match;
    changed = true;
    return `$${body.trim()}$`;
  });
  return changed ? out : text;
}

export function normalizeShortCodeFenceClosers(text: string): string {
  let inBacktickFence = false;
  let changed = false;
  const out = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.map((line) => {
    if (line.length === 0) return line;
    const newlineMatch = line.match(/(\r\n|\n|\r)$/);
    const newline = newlineMatch?.[0] ?? "";
    const body = newline ? line.slice(0, -newline.length) : line;
    if (!inBacktickFence) {
      if (/^ {0,3}```[^`]*$/.test(body)) inBacktickFence = true;
      return line;
    }
    if (/^ {0,3}```+\s*$/.test(body)) {
      inBacktickFence = false;
      return line;
    }
    const shortCloserMatch = body.match(/^( {0,3})``\s*$/);
    if (!shortCloserMatch) return line;
    inBacktickFence = false;
    changed = true;
    return `${shortCloserMatch[1]}\`\`\`${newline}`;
  });
  return changed ? (out ?? []).join("") : text;
}

/**
 * Models (Gemini/Antigravity especially) emit pseudo-XML placeholders as bare
 * prose (`<plan>`, `</response>`, `<understand>`). micromark parses those as
 * HTML tags and the sanitizer then drops the unknown elements, so whole lines
 * vanish from the rendered answer. Escape a `<` that opens something tag-like
 * outside fenced/inline code, while preserving real CommonMark autolinks
 * (`<https://…>`, `<mailto:…>`, `<user@host>`) byte for byte.
 */
export function escapeBareAngleTags(text: string): string {
  let changed = false;
  const converted = splitSegmentsOutsideFences(text).map((segment) => {
    if (segment.inFence) return segment.text;
    const next = escapeBareAngleTagsOutsideInlineCode(segment.text);
    if (next !== segment.text) changed = true;
    return next;
  });
  return changed ? converted.join("") : text;
}

/**
 * Inline code and math spans, in one capture group for `String.split`. Math
 * spans are protected for the same reason code is: `&lt;` inside math is a
 * KaTeX parse error (`&` outside alignment) that drops the whole formula back
 * to raw source. Classic `\( \)` `\[ \]` spans are captured too; whether they
 * count as math is decided per-span by the same signal check
 * `normalizeLatexMathDelimiters` uses, so prose brackets still get escaped.
 * Single `$` requires a non-space-closed body whose closing `$` is not
 * followed by a digit — the same currency guard micromark-extension-math
 * applies.
 */
const INLINE_CODE_OR_MATH_SPAN_RE =
  /(`[^`\n]*`|\$\$[\s\S]+?\$\$|\$[^\s$][^$]*?[^\s$]\$(?!\d)|\$[^\s$]\$(?!\d)|\\\[[\s\S]*?\\\](?!\()|\\\([\s\S]*?\\\))/g;

function isProtectedMathSpan(part: string): boolean {
  if (part.startsWith("$")) return true;
  if (part.startsWith("\\[") || part.startsWith("\\(")) {
    return LATEX_MATH_SIGNAL_RE.test(part.slice(2, -2));
  }
  return false;
}

function escapeBareAngleTagsOutsideInlineCode(text: string): string {
  if (!text.includes("<")) return text;
  const parts = text.split(INLINE_CODE_OR_MATH_SPAN_RE);
  let changed = false;
  const converted = parts.map((part, index) => {
    if (index % 2 === 1 && (part.startsWith("`") || isProtectedMathSpan(part))) return part;
    const next = escapeBareTagOpens(part);
    if (next !== part) changed = true;
    return next;
  });
  return changed ? converted.join("") : text;
}

const MATH_ENTITY_MAP: Record<string, string> = { lt: "<", gt: ">", amp: "&" };

/**
 * Make `$…$`/`$$…$$` math-span contents safe for the rest of the pipeline.
 * Two hazards:
 *
 * - Streamdown's `remend` incomplete-markdown pass treats `<` followed by a
 *   letter as an unclosed HTML tag and truncates the math span from that
 *   point on (`$x<y$` → `$x`), handing KaTeX a truncated formula (`y_{` EOF
 *   parse errors). Rewrite tag-like `<` opens to the `\lt ` TeX command,
 *   which remend ignores and KaTeX renders as `<`.
 * - Models sometimes emit HTML entities inside math (`y_{&lt;t}`); `&` is a
 *   KaTeX error outside alignment environments, so decode the common
 *   entities first — `&lt;` then takes the same `\lt` path.
 *
 * Runs after `normalizeLatexMathDelimiters`, so only `$`/`$$` spans need
 * handling. Fenced/inline code and prose keep their bytes.
 */
export function protectMathSpans(text: string): string {
  if (!text.includes("$")) return text;
  let changed = false;
  const converted = splitSegmentsOutsideFences(text).map((segment) => {
    if (segment.inFence) return segment.text;
    return segment.text
      .split(INLINE_CODE_OR_MATH_SPAN_RE)
      .map((part, index) => {
        if (index % 2 === 0 || !part.startsWith("$")) return part;
        const next = part
          .replace(/&(lt|gt|amp);/g, (match, name: string) => MATH_ENTITY_MAP[name] ?? match)
          .replace(/<(?=[A-Za-z/!?])/g, "\\lt ");
        if (next !== part) changed = true;
        return next;
      })
      .join("");
  });
  return changed ? converted.join("") : text;
}

function escapeBareTagOpens(text: string): string {
  return text.replace(/<(?=[A-Za-z/!?])/g, (match, offset: number) => {
    const rest = text.slice(offset);
    // Genuine autolinks survive: `<scheme:…>` (no spaces) and `<user@host>`.
    const autolink = /^<[a-zA-Z][a-zA-Z0-9+.-]*:[^<>\s]*>/.exec(rest);
    if (autolink) return match;
    const email = /^<[^<>\s]*@[^<>\s]*>/.exec(rest);
    if (email) return match;
    return "&lt;";
  });
}
