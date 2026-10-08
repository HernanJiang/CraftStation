import { describe, expect, it } from "vitest";
import {
  escapeBareAngleTags,
  normalizeDisplayMathClosers,
  normalizeGfmTableSeparators,
  normalizeLatexMathDelimiters,
  normalizeMathDollarRuns,
  normalizeMermaidFenceLanguages,
  normalizeMermaidSubgraphTitles,
  normalizeShortCodeFenceClosers,
  protectMathSpans,
  repairMathSyntax,
} from "./ItemMarkdown";

describe("normalizeMermaidSubgraphTitles", () => {
  it("quotes the unescaped title from Gemini without changing nodes or links", () => {
    const source = "flowchart TD\n    subgraph 最终收拢 (Supervisor)\nA --> B\nend";
    expect(normalizeMermaidSubgraphTitles(source)).toBe(
      'flowchart TD\n    subgraph "最终收拢 (Supervisor)"\nA --> B\nend',
    );
  });

  it("preserves an explicit group id and CRLF line endings", () => {
    expect(
      normalizeMermaidSubgraphTitles("graph LR\r\nsubgraph stage[最终收拢 (Supervisor)];\r\nend"),
    ).toBe('graph LR\r\nsubgraph stage["最终收拢 (Supervisor)"];\r\nend');
  });

  it("leaves quoted titles and ordinary group declarations alone", () => {
    for (const declaration of [
      'subgraph "最终收拢 (Supervisor)"',
      'subgraph stage["最终收拢 (Supervisor)"]',
      "subgraph stage[最终收拢]",
      "subgraph stage %% description (comment)",
    ]) {
      const source = `flowchart TD\n${declaration}\nA --> B\nend`;
      expect(normalizeMermaidSubgraphTitles(source)).toBe(source);
    }
  });

  it("does not treat another diagram's text as a flowchart declaration", () => {
    const source = "sequenceDiagram\nNote over A: subgraph 最终收拢 (Supervisor)";
    expect(normalizeMermaidSubgraphTitles(source)).toBe(source);
  });
});

describe("normalizeLatexMathDelimiters", () => {
  it("rewrites classic display delimiters to a $$ block", () => {
    expect(normalizeLatexMathDelimiters("\\[\nE = mc^2\n\\]")).toBe("\n$$\nE = mc^2\n$$\n");
  });

  it("rewrites a single-line display span without breaking the paragraph", () => {
    expect(normalizeLatexMathDelimiters("so \\[a^2+b^2=c^2\\] holds")).toBe(
      "so $$a^2+b^2=c^2$$ holds",
    );
  });

  it("rewrites an inline math span to a single-dollar span", () => {
    expect(normalizeLatexMathDelimiters("the root is \\(x=\\frac{-1}{2}\\)")).toBe(
      "the root is $x=\\frac{-1}{2}$",
    );
  });

  it("leaves escaped prose brackets and escaped links untouched", () => {
    const source = "see \\[appendix\\], cite \\[1\\], but not \\[link\\](https://example.test)";
    expect(normalizeLatexMathDelimiters(source)).toBe(source);
  });

  it("does not rewrite inside fenced code or inline code", () => {
    const fenced = "```\n\\[x=1\\]\n```\n";
    expect(normalizeLatexMathDelimiters(fenced)).toBe(fenced);
    expect(normalizeLatexMathDelimiters("`\\[x=1\\]`")).toBe("`\\[x=1\\]`");
  });

  it("preserves the text when nothing matches", () => {
    const source = "plain text with $x$ math already using dollars";
    expect(normalizeLatexMathDelimiters(source)).toBe(source);
  });
});

describe("normalizeShortCodeFenceClosers", () => {
  it("treats a two-backtick line as a closer inside a triple-backtick fence", () => {
    expect(
      normalizeShortCodeFenceClosers("before\n\n```text\nwriting is blocked\n``\n\nafter\n"),
    ).toBe("before\n\n```text\nwriting is blocked\n```\n\nafter\n");
  });

  it("leaves two backticks alone outside code fences", () => {
    expect(normalizeShortCodeFenceClosers("before\n``\nafter\n")).toBe("before\n``\nafter\n");
  });
});

describe("normalizeMermaidFenceLanguages", () => {
  it("normalizes flowchart and graph fence aliases", () => {
    expect(normalizeMermaidFenceLanguages("```flowchart\nflowchart TD\nA --> B\n```")).toBe(
      "```mermaid\nflowchart TD\nA --> B\n```",
    );
    expect(normalizeMermaidFenceLanguages("~~~graph\ngraph LR\nA --> B\n~~~")).toBe(
      "~~~mermaid\ngraph LR\nA --> B\n~~~",
    );
  });

  it("normalizes an unlabelled Mermaid declaration fence", () => {
    expect(normalizeMermaidFenceLanguages("```\nflowchart LR\nA --> B\n```")).toBe(
      "```mermaid\nflowchart LR\nA --> B\n```",
    );
  });

  it("leaves ordinary code fence languages untouched", () => {
    const source = "```typescript\nconst flowchart = true;\n```";
    expect(normalizeMermaidFenceLanguages(source)).toBe(source);
  });
});

describe("normalizeGfmTableSeparators", () => {
  it("expands a short separator to match a wider header", () => {
    const input = "| a | b | c | d |\n|---|---|---|\n| 1 | 2 | 3 | 4 |\n";
    const out = normalizeGfmTableSeparators(input);
    expect(out).toContain("| --- | --- | --- | --- |");
    expect(out.split("\n")[2]).toBe("| 1 | 2 | 3 | 4 |");
  });

  it("truncates a long separator to match a narrower header", () => {
    const input = "| a | b |\n|---|---|---|---|\n| 1 | 2 |\n";
    const out = normalizeGfmTableSeparators(input);
    expect(out).toContain("| --- | --- |");
    expect(out).not.toContain("---|---|---|---");
  });

  it("preserves alignment markers when expanding", () => {
    const input = "| a | b | c | d |\n|:---|---:|:---:|\n| 1 | 2 | 3 | 4 |\n";
    const out = normalizeGfmTableSeparators(input);
    expect(out).toContain("| :--- | ---: | :---: | --- |");
  });

  it("leaves a well-formed table untouched", () => {
    const input = "| a | b |\n|---|---|\n| 1 | 2 |\n";
    expect(normalizeGfmTableSeparators(input)).toBe(input);
  });

  it("does not touch separator-like lines inside a code fence", () => {
    const input = "```\n| a | b | c |\n|---|---|\n```\n";
    expect(normalizeGfmTableSeparators(input)).toBe(input);
  });

  it("preserves CRLF line endings", () => {
    const input = "| a | b | c |\r\n|---|---|\r\n| 1 | 2 | 3 |\r\n";
    const out = normalizeGfmTableSeparators(input);
    expect(out).toContain("| --- | --- | --- |\r\n");
  });

  it("repairs the separator under an all-empty header row", () => {
    const input = "| | |\n|---|\n| 唯一变量 | 只训 MLP |\n| 起点 | 76.03 |\n";
    const out = normalizeGfmTableSeparators(input);
    expect(out).toContain("| --- | --- |");
    expect(out.split("\n")[0]).toBe("| | |");
  });

  it("leaves an all-empty header with a matching separator untouched", () => {
    const input = "| | |\n|---|---|\n| 1 | 2 |\n";
    expect(normalizeGfmTableSeparators(input)).toBe(input);
  });
});

describe("escapeBareAngleTags", () => {
  it("escapes pseudo-XML placeholders so the sanitizer cannot eat them", () => {
    expect(escapeBareAngleTags("<plan>\n</response>\n<understand>刺激</understand>")).toBe(
      "&lt;plan>\n&lt;/response>\n&lt;understand>刺激&lt;/understand>",
    );
  });

  it("leaves real autolinks and comparisons alone", () => {
    expect(escapeBareAngleTags("see <https://example.test/x> and <me@example.test>")).toBe(
      "see <https://example.test/x> and <me@example.test>",
    );
    expect(escapeBareAngleTags("a < b and 3 < 4")).toBe("a < b and 3 < 4");
  });

  it("skips fenced code and inline code", () => {
    expect(escapeBareAngleTags("```xml\n<plan/>\n```\n")).toBe("```xml\n<plan/>\n```\n");
    expect(escapeBareAngleTags("use `<tag>` here")).toBe("use `<tag>` here");
  });

  it("keeps raw `<` inside dollar math so KaTeX can parse it", () => {
    // `&lt;` inside math is a KaTeX parse error that drops the whole formula
    // back to raw source — the intermittent "garbled formula" report.
    expect(escapeBareAngleTags("$$\\sum_{t=1}^N \\log p(y_t \\mid y_{<t})$$")).toBe(
      "$$\\sum_{t=1}^N \\log p(y_t \\mid y_{<t})$$",
    );
    expect(escapeBareAngleTags("inline $x<y$ math")).toBe("inline $x<y$ math");
  });

  it("keeps `<` inside classic delimiters only when they carry a math signal", () => {
    expect(escapeBareAngleTags("\\[\\mathcal{L} = \\sum y_{<t}\\]")).toBe(
      "\\[\\mathcal{L} = \\sum y_{<t}\\]",
    );
    expect(escapeBareAngleTags("\\(x_t<y\\)")).toBe("\\(x_t<y\\)");
    // Signal-less brackets stay prose — pseudo-tags inside still get escaped
    // (and render back as literal `<` in the paragraph path).
    expect(escapeBareAngleTags("\\[x <tag> y\\]")).toBe("\\[x &lt;tag> y\\]");
    expect(escapeBareAngleTags("\\(x<t\\)")).toBe("\\(x&lt;t\\)");
  });

  it("keeps <br> as real inline HTML so table cells render a line break", () => {
    const cell = "对角线、相似度 1<br>金毛图 vs. 金毛文";
    expect(escapeBareAngleTags(cell)).toBe(cell);
    expect(escapeBareAngleTags("a<br/>b<br />c")).toBe("a<br/>b<br />c");
    // A look-alike pseudo-tag still escapes.
    expect(escapeBareAngleTags("<break>x")).toBe("&lt;break>x");
  });
});

describe("normalizeDisplayMathClosers", () => {
  it("splits a $$ closer glued to the last content line", () => {
    const source = "$$\n\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}$$\n";
    expect(normalizeDisplayMathClosers(source)).toBe(
      "$$\n\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}\n$$\n",
    );
    expect(normalizeDisplayMathClosers("$$\nx^2$$")).toBe("$$\nx^2\n$$");
  });

  it("splits a glued closer after an opener that carries inline content", () => {
    expect(normalizeDisplayMathClosers("$$ E = mc^2\nmore$$\n")).toBe("$$\n E = mc^2\nmore\n$$\n");
  });

  it("leaves well-formed blocks, single-line spans, prose, and fences alone", () => {
    const wellFormed = "$$\nx^2\n$$\n";
    expect(normalizeDisplayMathClosers(wellFormed)).toBe(wellFormed);
    const singleLine = "$$x^2$$\n";
    expect(normalizeDisplayMathClosers(singleLine)).toBe(singleLine);
    const prose = "price is 5$$\n";
    expect(normalizeDisplayMathClosers(prose)).toBe(prose);
    const fenced = "```\n$$\nx$$\n```\n";
    expect(normalizeDisplayMathClosers(fenced)).toBe(fenced);
    const metadata = "$$asciimath\nx^2\n$$\n";
    expect(normalizeDisplayMathClosers(metadata)).toBe(metadata);
    const mismatchedSingleLine = "$$x^2$\n";
    expect(normalizeDisplayMathClosers(mismatchedSingleLine)).toBe(mismatchedSingleLine);
  });
});

describe("normalizeMathDollarRuns", () => {
  it("pairs a double-dollar opener with a single-dollar closer", () => {
    expect(normalizeMathDollarRuns("$$\\mathbf{F} = \\alpha \\cdot \\mathbf{W}$")).toBe(
      "$$\\mathbf{F} = \\alpha \\cdot \\mathbf{W}$$",
    );
  });

  it("pairs a single-dollar opener with a double-dollar closer", () => {
    expect(normalizeMathDollarRuns("$\\mathcal{J}(\\theta) = \\mathbb{E}_{q}[x]$$")).toBe(
      "$$\\mathcal{J}(\\theta) = \\mathbb{E}_{q}[x]$$",
    );
  });

  it("closes an unclosed standalone $$ line when no later $$ line exists", () => {
    expect(normalizeMathDollarRuns("$$\\frac{a}{b} = c")).toBe("$$\\frac{a}{b} = c$$");
  });

  it("leaves balanced blocks, prose dollars, code, and multi-line openers alone", () => {
    const balanced = "$$x^2$$\n\n$$\ny_i = w_i\n$$";
    expect(normalizeMathDollarRuns(balanced)).toBe(balanced);
    expect(normalizeMathDollarRuns("costs $5 and $10 here")).toBe("costs $5 and $10 here");
    expect(normalizeMathDollarRuns("```\n$$x^2$\n```")).toBe("```\n$$x^2$\n```");
    expect(normalizeMathDollarRuns("`$$x^2$`")).toBe("`$$x^2$`");
    // A `$$` opener with content may be closed by a later `$$` line — do not
    // split a legitimate multi-line flow block.
    const multiLine = "$$\\frac{a}{b} +\nc$$\n";
    expect(normalizeMathDollarRuns(multiLine)).toBe(multiLine);
  });

  it("keeps math-signal-less dollar lines as prose", () => {
    expect(normalizeMathDollarRuns("$$price is 5$")).toBe("$$price is 5$");
  });
});

describe("repairMathSyntax", () => {
  it("appends missing braces at the end of a truncated display formula", () => {
    expect(
      repairMathSyntax(
        "$$\\mathcal{J}(\\theta) = \\mathbb{E}_{\\substack{q \\sim P(Q)}} \\left[x\\right]$$",
      ),
    ).toBe("$$\\mathcal{J}(\\theta) = \\mathbb{E}_{\\substack{q \\sim P(Q)}} \\left[x\\right]$$");
    const broken = "$$\\mathbb{E}_{\\substack{q \\sim P(Q), \\\\ x} \\left[y\\right]$$";
    expect(repairMathSyntax(broken)).toBe(
      "$$\\mathbb{E}_{\\substack{q \\sim P(Q), \\\\ x} \\left[y\\right]}$$",
    );
  });

  it("closes open braces and dangling \\left inside a formula", () => {
    expect(repairMathSyntax("$$\\mathbb{E}_{\\substack{a, \\\\ b} = \\left(x$$")).toBe(
      "$$\\mathbb{E}_{\\substack{a, \\\\ b} = \\left(x} \\right.$$",
    );
    expect(repairMathSyntax("$$\\frac{a}{b} = \\left( c$$")).toBe(
      "$$\\frac{a}{b} = \\left( c \\right.$$",
    );
  });

  it("ignores escaped braces, balanced spans, prose, and code", () => {
    expect(repairMathSyntax("$\\{a\\}$ and $x_{1}$")).toBe("$\\{a\\}$ and $x_{1}$");
    expect(repairMathSyntax("costs $5 then $10")).toBe("costs $5 then $10");
    expect(repairMathSyntax("```\n$$x_{1$$\n```")).toBe("```\n$$x_{1$$\n```");
  });

  it("drops stray \\right delimiters that have no matching \\left", () => {
    // A lone `\right.` is a hard KaTeX parse error — the whole span used to
    // fall back to raw backslash soup mid-answer.
    expect(repairMathSyntax("$a \\leftrightarrow \\right. b$")).toBe("$a \\leftrightarrow b$");
    expect(repairMathSyntax("$a \\leftrightarrow \\right) b$")).toBe("$a \\leftrightarrow ) b$");
    expect(repairMathSyntax("$x \\leftarrow \\right.$")).toBe("$x \\leftarrow $");
    // Balanced pairs and legitimately-missing closers are untouched.
    expect(repairMathSyntax("$\\left( x \\right)$")).toBe("$\\left( x \\right)$");
    expect(repairMathSyntax("$\\left( x$")).toBe("$\\left( x \\right.$");
  });
});

describe("protectMathSpans", () => {
  it("rewrites tag-like `<` inside math to `\\lt ` so remend cannot truncate it", () => {
    // remend strips `<`+letter as an unclosed tag (`$x<y$` → `$x`), handing
    // KaTeX a truncated formula — the intermittent "garbled formula" report.
    expect(protectMathSpans("$$\\sum_{t=1}^N \\log p(y_t \\mid y_{<t})$$")).toBe(
      "$$\\sum_{t=1}^N \\log p(y_t \\mid y_{\\lt t})$$",
    );
    expect(protectMathSpans("inline $x<y$ math")).toBe("inline $x\\lt y$ math");
  });

  it("decodes entities inside math first so `&lt;` takes the `\\lt` path too", () => {
    expect(protectMathSpans("$$y_{&lt;t} &gt; 0$$")).toBe("$$y_{\\lt t} > 0$$");
    expect(protectMathSpans("$a&lt;b$")).toBe("$a\\lt b$");
  });

  it("leaves `<=`, spaced `<`, prose entities, and code untouched", () => {
    expect(protectMathSpans("$x <= y$ and $x < y$")).toBe("$x <= y$ and $x < y$");
    expect(protectMathSpans("a &lt; b and `$x<y$`")).toBe("a &lt; b and `$x<y$`");
    expect(protectMathSpans("```\n$x<y$\n```")).toBe("```\n$x<y$\n```");
  });
});
// @vitest-environment node
