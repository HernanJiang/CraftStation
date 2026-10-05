/**
 * Converts clipboard `text/html` into clean Markdown-ish text for the
 * composer. Browsers serialize rendered output to `text/plain` by flattening
 * the visible DOM, which mangles rich elements — KaTeX formulas become
 * one-symbol-per-line noise, mermaid SVGs become path dumps. Restructuring at
 * the HTML level restores the original semantics: `.katex` nodes carry their
 * TeX source in a MathML `<annotation>`, headings/lists/tables map back to
 * Markdown markers, and purely visual nodes (svg, buttons) are dropped.
 */

const SKIP_ELEMENTS = new Set([
  "SCRIPT",
  "STYLE",
  "SVG",
  "BUTTON",
  "SELECT",
  "OPTION",
  "TEMPLATE",
  "NOSCRIPT",
  // MathML under .katex is consumed via the <annotation> TeX source.
  "MATH",
]);

const BLOCK_ELEMENTS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DETAILS",
  "DIV",
  "DL",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "HEADER",
  "HR",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TFOOT",
  "THEAD",
  "TR",
  "UL",
]);

interface WalkState {
  inPre: boolean;
}

function push(out: string[], text: string) {
  out.push(text);
}

function ensureNewline(out: string[]) {
  const last = out[out.length - 1];
  if (last === undefined) return;
  if (!last.endsWith("\n")) out.push("\n");
}

function walkElement(el: Element, out: string[], state: WalkState) {
  const tag = el.tagName;

  if (SKIP_ELEMENTS.has(tag)) return;

  // TeX restored from KaTeX annotations keeps its own line layout.
  if (el.hasAttribute("data-md-verbatim")) {
    push(out, el.textContent ?? "");
    return;
  }

  if (tag === "BR") {
    push(out, "\n");
    return;
  }
  if (tag === "HR") {
    ensureNewline(out);
    push(out, "---\n");
    return;
  }
  if (tag === "IMG") {
    const alt = el.getAttribute("alt");
    if (alt) push(out, `![${alt}]`);
    return;
  }

  const isBlock = BLOCK_ELEMENTS.has(tag);
  if (isBlock) ensureNewline(out);

  if (tag === "LI") {
    push(out, "- ");
  } else if (/^H[1-6]$/.test(tag)) {
    push(out, "#".repeat(Number(tag[1])) + " ");
  } else if (tag === "TD" || tag === "TH") {
    push(out, "| ");
  } else if (tag === "PRE") {
    ensureNewline(out);
    push(out, "```\n");
    const next: WalkState = { ...state, inPre: true };
    for (const child of el.childNodes) walkNode(child, out, next);
    ensureNewline(out);
    push(out, "```\n");
    return;
  } else if (tag === "STRONG" || tag === "B") {
    push(out, "**");
    for (const child of el.childNodes) walkNode(child, out, state);
    push(out, "**");
    return;
  } else if (tag === "EM" || tag === "I") {
    push(out, "*");
    for (const child of el.childNodes) walkNode(child, out, state);
    push(out, "*");
    return;
  } else if (tag === "CODE") {
    push(out, "`");
    for (const child of el.childNodes) walkNode(child, out, state);
    push(out, "`");
    return;
  } else if (tag === "A") {
    for (const child of el.childNodes) walkNode(child, out, state);
    const href = el.getAttribute("href");
    if (href && !href.startsWith("#")) push(out, ` (${href})`);
    return;
  } else if (tag === "BLOCKQUOTE") {
    push(out, "> ");
  }

  for (const child of el.childNodes) walkNode(child, out, state);

  if (tag === "TD" || tag === "TH") {
    push(out, " ");
  }
  if (tag === "TR") {
    push(out, "|");
  }
  if (isBlock) ensureNewline(out);
}

function walkNode(node: Node, out: string[], state: WalkState) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? "";
    // Outside <pre>, collapse whitespace runs the way HTML rendering does;
    // inside, keep code layout verbatim.
    push(out, state.inPre ? text : text.replace(/\s+/g, " "));
    return;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    walkElement(node as Element, out, state);
  }
}

function restoreTexSource(doc: Document) {
  for (const katex of doc.querySelectorAll(".katex")) {
    const tex = katex
      .querySelector('annotation[encoding="application/x-tex"]')
      ?.textContent?.trim();
    const display =
      katex.classList.contains("katex-display") ||
      katex.parentElement?.classList.contains("katex-display") === true;
    const span = doc.createElement("span");
    span.setAttribute("data-md-verbatim", "");
    span.textContent = tex ? (display ? `\n$$\n${tex}\n$$\n` : `$${tex}$`) : "";
    katex.replaceWith(span);
  }
}

/** Converts clipboard HTML to Markdown-ish plain text; "" when unusable. */
export function htmlClipboardToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  restoreTexSource(doc);
  const out: string[] = [];
  for (const child of doc.body.childNodes) {
    walkNode(child, out, { inPre: false });
  }
  return out
    .join("")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
