import { afterEach, describe, expect, it } from "vitest";
import { expandMathChipToText, transformMathChips } from "./mathChips";
import { serializeToSegments, flattenSegments } from "./serializeMentions";

function makeEditor(text: string): HTMLDivElement {
  const editor = document.createElement("div");
  editor.appendChild(document.createTextNode(text));
  document.body.appendChild(editor);
  return editor;
}

function collapseCaret(node: Node, offset: number) {
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("transformMathChips", () => {
  it("replaces an inline $...$ span with a rendered chip", () => {
    const editor = makeEditor("before $x^2$ after");
    transformMathChips(editor);
    const chip = editor.querySelector<HTMLElement>("[data-math-tex]");
    expect(chip).not.toBeNull();
    expect(chip?.dataset.mathTex).toBe("x^2");
    expect(chip?.dataset.mathDisplay).toBeUndefined();
    expect(chip?.querySelector(".katex")).not.toBeNull();
  });

  it("replaces a $$...$$ span with a display chip", () => {
    const editor = makeEditor("sum: $$\\sum_{i} x_i$$");
    transformMathChips(editor);
    const chip = editor.querySelector<HTMLElement>("[data-math-tex]");
    expect(chip?.dataset.mathTex).toBe("\\sum_{i} x_i");
    expect(chip?.dataset.mathDisplay).toBe("true");
  });

  it("keeps bare-word inline math like $v$", () => {
    const editor = makeEditor("the vector $v$ here");
    transformMathChips(editor);
    expect(editor.querySelector("[data-math-tex]")?.getAttribute("data-math-tex")).toBe("v");
  });

  it("does not convert currency-like $5 and $10 pairs", () => {
    const editor = makeEditor("costs $5 and $10 total");
    transformMathChips(editor);
    expect(editor.querySelector("[data-math-tex]")).toBeNull();
  });

  it("does not convert $ spans whose body is plain prose", () => {
    const editor = makeEditor("the $quick brown$ fox");
    transformMathChips(editor);
    expect(editor.querySelector("[data-math-tex]")).toBeNull();
  });

  it("leaves an incomplete $… span as text", () => {
    const editor = makeEditor("still typing $\\alpha");
    transformMathChips(editor);
    expect(editor.querySelector("[data-math-tex]")).toBeNull();
  });

  it("skips the match while the caret is inside it", () => {
    const editor = makeEditor("$x^2$");
    const text = editor.firstChild as Text;
    collapseCaret(text, 2); // inside "x^2"
    transformMathChips(editor);
    expect(editor.querySelector("[data-math-tex]")).toBeNull();
  });

  it("converts when the caret sits right after the closing delimiter", () => {
    const editor = makeEditor("$x^2$");
    const text = editor.firstChild as Text;
    collapseCaret(text, text.length); // just typed the closing $
    transformMathChips(editor);
    const chip = editor.querySelector("[data-math-tex]");
    expect(chip).not.toBeNull();
    // Caret lands right after the chip.
    const sel = window.getSelection();
    expect(sel?.anchorNode).not.toBe(chip);
  });

  it("does not rescan inside existing chips", () => {
    const editor = makeEditor("$a$ then $b$");
    transformMathChips(editor);
    transformMathChips(editor);
    expect(editor.querySelectorAll("[data-math-tex]")).toHaveLength(2);
  });
});

describe("math chip serialization", () => {
  it("serializes chips back to their TeX source", () => {
    const editor = makeEditor("before $x^2$ and $$\\int_0^1$$ after");
    transformMathChips(editor);
    const segments = serializeToSegments(editor as HTMLDivElement);
    expect(flattenSegments(segments)).toBe("before $x^2$ and $$\\int_0^1$$ after");
  });
});

describe("expandMathChipToText", () => {
  it("restores the raw TeX source as editable text", () => {
    const editor = makeEditor("a $x^2$ b");
    transformMathChips(editor);
    const chip = editor.querySelector<HTMLElement>("[data-math-tex]")!;
    expandMathChipToText(chip);
    expect(editor.querySelector("[data-math-tex]")).toBeNull();
    expect(editor.textContent).toBe("a $x^2$ b");
    // Caret placed inside the restored source, right after the opening $.
    const sel = window.getSelection();
    expect(sel?.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
  });
});
