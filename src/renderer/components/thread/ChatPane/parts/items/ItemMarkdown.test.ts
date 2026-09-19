import { describe, expect, it } from "vitest";
import {
  escapeBareAngleTags,
  normalizeGfmTableSeparators,
  normalizeLatexMathDelimiters,
  normalizeMermaidFenceLanguages,
  normalizeShortCodeFenceClosers,
  protectMathSpans,
} from "./ItemMarkdown";

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
