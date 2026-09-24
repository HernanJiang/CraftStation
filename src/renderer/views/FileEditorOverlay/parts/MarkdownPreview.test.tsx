import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".katex-mathml, annotation").forEach((node) => node.remove());
  return clone.textContent ?? "";
}

const CASES_FORMULA = [
  "定义新输出：",
  "",
  "$$ H_{b,t}= \\begin{cases} \\dfrac{m^v_{b,t}V_{b,t}+m^a_{b,t}A_{b,t}}{m^v_{b,t}+m^a_{b,t}}, & m^v_{b,t}+m^a_{b,t}>0, \\\\ 0, & m^v_{b,t}+m^a_{b,t}=0. \\end{cases} $$",
  "",
  "其中 $(b)$ 为样本，$V_{b,t}$ 是视觉向量。",
].join("\n");

describe("MarkdownPreview math", () => {
  it("renders a standalone cases formula instead of leaving the $$ source", () => {
    const { container } = render(<MarkdownPreview content={CASES_FORMULA} />);

    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
    const rendered = container.querySelector(".katex-html")?.textContent ?? "";
    expect(rendered).not.toContain("$$");
    expect(rendered).not.toContain("\\begin");
    expect(rendered).toContain("H");
    expect(container.textContent).toContain("定义新输出：");
    expect(container.textContent).toContain("为样本");
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(3);
  });

  it("renders inline dollars, classic delimiters, and formulas containing <", () => {
    const { container } = render(
      <MarkdownPreview
        content={["根是 \\(x=\\frac{-1}{2}\\)。", "", "\\[", "y_{<t}", "\\]"].join("\n")}
      />,
    );

    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.textContent).toContain("根是");
    expect(container.textContent).not.toContain("\\[");
  });

  it("leaves fenced code and ordinary prose untouched", () => {
    const { container } = render(
      <MarkdownPreview
        content={["见 `a_b` 与 <https://example.test/x>。", "", "```", "$$ x^2 $$", "```", ""].join(
          "\n",
        )}
      />,
    );

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain("$$ x^2 $$");
    expect(container.querySelector("a")).toHaveAttribute("href", "https://example.test/x");
  });

  it("renders a multiline display formula and the inline math around it", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "choice 拆成 SocialIQA 和 EmoBench。",
          "",
          "$$",
          "S=\\frac{n_S}{2224}\\times 100,\\quad",
          "E_{\\mathrm{EU}}=\\frac{n_{\\mathrm{EU}}}{400}\\times 100,\\quad",
          "E=\\frac{n_{\\mathrm{EU}}+n_{\\mathrm{EA}}}{800}\\times 100.",
          "$$",
          "",
          "$n_{\\mathrm{EU}}$ 是答对的题数。$|\\mathcal{F}|=3187$。",
        ].join("\n")}
      />,
    );

    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
    const visible = visibleText(container);
    expect(visible).not.toContain("$$");
    expect(visible).not.toContain("\\frac");
    expect(visible).toContain("是答对的题数");
    expect(visible).toContain("3187");
  });

  it("promotes a same-line $$ formula that sits against the next paragraph", () => {
    const { container } = render(
      <MarkdownPreview
        content={["上一句", "$$ E=\\frac{a}{b} $$", "下一句 $n_{\\mathrm{EU}}$"].join("\n")}
      />,
    );

    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
    const visible = visibleText(container);
    expect(visible).not.toContain("$$");
    expect(visible).not.toContain("\\frac");
    expect(visible).toContain("上一句");
    expect(visible).toContain("下一句");
  });

  it("keeps a score table cell intact when the header has inline math", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "| 模型 | SocialIQA $S$ | EU | EA | EmoBench $E$ | $C$ |",
          "|---|---:|---:|---:|---:|---:|",
          "| Nano-EmoX | 3.60 (80/2224) | 0.00 (0/400) | 1.00 (4/400) | 0.50 (4/800) | 2.05 |",
        ].join("\n")}
      />,
    );

    const row = [...container.querySelectorAll("tr")].find((tr) =>
      (tr.textContent ?? "").includes("Nano-EmoX"),
    );
    const cells = [...(row?.querySelectorAll("td") ?? [])].map((cell) =>
      (cell.textContent ?? "").replace(/\s+/g, ""),
    );
    expect(cells).toEqual([
      "Nano-EmoX",
      "3.60(80/2224)",
      "0.00(0/400)",
      "1.00(4/400)",
      "0.50(4/800)",
      "2.05",
    ]);
  });

  it("still renders GFM tables and raw emphasis", () => {
    const { container } = render(
      <MarkdownPreview
        content={["| A | B |", "| --- | --- |", "| 1 | 2 |", "", "<em>强调</em>"].join("\n")}
      />,
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("em")).toHaveTextContent("强调");
  });
});
