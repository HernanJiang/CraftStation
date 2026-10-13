import { describe, expect, it } from "vitest";
import { htmlClipboardToText } from "./htmlClipboardText";

const KATEX_INLINE = `<span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">h_{eos} = H_{text}[b, eos\\_index]</annotation><mi>h</mi></semantics></math></span><span class="katex-html" aria-hidden="true"><span>h</span><span>_eos</span><span>=</span></span></span>`;

const KATEX_DISPLAY = `<span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">X_{text} \\in \\mathbb{R}^{B \\times L}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span>X</span></span></span></span>`;

describe("htmlClipboardToText", () => {
  it("restores inline KaTeX as $tex$ from the MathML annotation", () => {
    const html = `<p>隐状态向量： ${KATEX_INLINE} 由 EOS 汇聚</p>`;
    const text = htmlClipboardToText(html);
    expect(text).toContain("$h_{eos} = H_{text}[b, eos\\_index]$");
    // The aria-hidden visual spans must not leak per-symbol text.
    expect(text).not.toContain("_eos =");
    expect(text).toContain("隐状态向量：");
  });

  it("restores display KaTeX as $$tex$$", () => {
    const text = htmlClipboardToText(`<p>映射：${KATEX_DISPLAY}</p>`);
    expect(text).toContain("$$\nX_{text} \\in \\mathbb{R}^{B \\times L}\n$$");
  });

  it("drops katex nodes without a TeX annotation", () => {
    const text = htmlClipboardToText(
      `<p>a<span class="katex"><span class="katex-html">noise</span></span>b</p>`,
    );
    expect(text).toBe("ab");
  });

  it("serializes headings, lists, bold, code and links", () => {
    const html = `<h3>步骤</h3><ol><li>分词 <strong>tokenizer</strong></li><li>投影 <code>W_t</code> 见 <a href="https://x.dev">链接</a></li></ol>`;
    const text = htmlClipboardToText(html);
    expect(text).toContain("### 步骤");
    expect(text).toContain("- 分词 **tokenizer**");
    expect(text).toContain("- 投影 W_t 见 链接 (https://x.dev)");
  });

  it("serializes table rows as pipe-separated lines", () => {
    const html = `<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`;
    const text = htmlClipboardToText(html);
    expect(text).toContain("| A | B |");
    expect(text).toContain("| 1 | 2 |");
  });

  it("drops svg/button/script visual noise", () => {
    const html = `<div><svg><path d="M0 0"/></svg><button>copy</button><script>evil()</script><p>正文</p></div>`;
    expect(htmlClipboardToText(html)).toBe("正文");
  });

  it("keeps selected pre content verbatim without adding a fence", () => {
    const html = `<pre>def f():\n    return  1</pre>`;
    const text = htmlClipboardToText(html);
    expect(text).toBe("def f():\n    return  1");
  });

  it("pastes selected highlighted code without adding nested backticks", () => {
    const html = `<pre><code><span>top, bottom = 0, len(matrix) - 1</span>\n        <span>left, right = 0, len(matrix[0]) - 1</span></code></pre>`;
    expect(htmlClipboardToText(html)).toBe(
      "top, bottom = 0, len(matrix) - 1\n        left, right = 0, len(matrix[0]) - 1",
    );
  });

  it("copies inline code as its selected text", () => {
    expect(htmlClipboardToText("<p>检查 <code>matrix[0]</code> 的长度</p>")).toBe(
      "检查 matrix[0] 的长度",
    );
  });

  it("preserves backticks that are part of the selected code", () => {
    expect(htmlClipboardToText("<pre><code>const text = `hello`;</code></pre>")).toBe(
      "const text = `hello`;",
    );
  });

  it("returns empty string for structureless html", () => {
    expect(htmlClipboardToText("")).toBe("");
    expect(htmlClipboardToText("<div>   </div>")).toBe("");
  });
});
