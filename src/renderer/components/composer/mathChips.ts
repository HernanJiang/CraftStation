import { renderToString as renderKatex } from "katex";

/**
 * Live math rendering inside the contentEditable composer. `$...$` and
 * `$$...$$` spans in text nodes are swapped for non-editable KaTeX chips
 * (Typora-style: a span renders as soon as its closing delimiter is typed or
 * pasted). Chips serialize back to their raw TeX source in
 * `serializeToSegments`, so the prompt sent to the agent always carries the
 * plain-text delimiters. A collapsed caret strictly inside a candidate match
 * leaves it as text so mid-edit formulas stay editable; double-clicking a
 * chip expands it back to source.
 */

const DISPLAY_MATH_RE = /\$\$([^$]+?)\$\$/g;
// Pandoc-style inline rules: the opener must not be followed by whitespace
// and the closer must not be preceded by whitespace nor followed by a digit —
// that keeps "$5 and $10" currency pairs as plain text. The `(?<!\$)`
// lookbehind leaves `$$` runs to the display pass.
const INLINE_MATH_RE = /(?<!\$)\$(?!\$|\s)([^$]*?[^\s$])\$(?!\d)/g;

const MATHY_CHARS_RE = /[\\^_{}=<>|~]/;
const MATHY_OPS_RE = /[+\-*/]/;
const BARE_WORD_RE = /^[\p{L}][\p{L}\p{N}]*$/u;

/**
 * Inline `$...$` is easy to type accidentally (currency, shell vars), so a
 * candidate only renders when its body actually looks like math: it carries
 * TeX syntax (\_^{}=<>|~ or operators) or is a bare word like `x` or `α`.
 */
function isLikelyInlineMath(inner: string): boolean {
  if (MATHY_CHARS_RE.test(inner) || MATHY_OPS_RE.test(inner)) return true;
  return BARE_WORD_RE.test(inner);
}

export function createMathChipElement(tex: string, display: boolean): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.mathTex = tex;
  if (display) chip.dataset.mathDisplay = "true";
  chip.className = "craftstation-math-chip";
  try {
    chip.innerHTML = renderKatex(tex, {
      throwOnError: false,
      displayMode: display,
      strict: "ignore",
    });
  } catch {
    chip.textContent = display ? `$$${tex}$$` : `$${tex}$`;
  }
  return chip;
}

/** Replaces a rendered chip with its raw TeX source and puts the caret inside. */
export function expandMathChipToText(chip: HTMLElement): void {
  const tex = chip.dataset.mathTex;
  if (tex === undefined) return;
  const display = chip.dataset.mathDisplay === "true";
  const node = document.createTextNode(display ? `$$${tex}$$` : `$${tex}$`);
  chip.replaceWith(node);
  const range = document.createRange();
  range.setStart(node, display ? 2 : 1);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

interface MathMatch {
  start: number;
  end: number;
  tex: string;
}

function collectMatches(text: string, display: boolean): MathMatch[] {
  const re = display ? DISPLAY_MATH_RE : INLINE_MATH_RE;
  re.lastIndex = 0;
  const out: MathMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tex = (m[1] ?? "").trim();
    if (tex.length === 0) continue;
    if (!display && !isLikelyInlineMath(tex)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, tex });
  }
  return out;
}

/** Text nodes eligible for math scanning — skips chips and preview spans. */
function editableTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = (node as Text).parentElement;
      while (el && el !== root) {
        // KaTeX markup includes MathML elements without `dataset`; only HTML
        // ancestors carry the skip markers.
        if (
          el instanceof HTMLElement &&
          (el.getAttribute("contenteditable") === "false" ||
            el.dataset.voiceTranscriptPreview !== undefined ||
            el.dataset.mdVerbatim !== undefined)
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function transformPass(root: HTMLElement, display: boolean): void {
  const sel = window.getSelection();
  const caretNode = sel?.isCollapsed === true ? sel.anchorNode : null;
  const caretOffset = sel?.anchorOffset ?? -1;

  for (const node of editableTextNodes(root)) {
    const matches = collectMatches(node.nodeValue ?? "", display).filter(
      (match) => !(node === caretNode && caretOffset > match.start && caretOffset < match.end),
    );
    // Right-to-left so earlier offsets stay valid after each split.
    for (let i = matches.length - 1; i >= 0; i--) {
      const { start, end, tex } = matches[i]!;
      // A caret exactly at the closing delimiter means it was just typed —
      // convert and leave the caret after the chip.
      const caretAtMatchEnd = node === caretNode && caretOffset === end;
      node.splitText(end);
      const mid = node.splitText(start);
      const chip = createMathChipElement(tex, display);
      mid.replaceWith(chip);
      if (caretAtMatchEnd && sel) {
        const range = document.createRange();
        range.setStartAfter(chip);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }
}

/** Scan `root`'s editable text and replace complete TeX spans with chips. */
export function transformMathChips(root: HTMLElement): void {
  transformPass(root, true);
  transformPass(root, false);
}
