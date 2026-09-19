import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

type Highlight = (text: string, options: { theme: string; lang: string }) => string;
const fixture = vi.hoisted(() => ({
  appearance: "dark",
  codeToHtml: vi.fn<Highlight>(),
  getHighlighter: vi.fn<() => Promise<{ codeToHtml: Highlight }>>(),
}));
vi.mock("@/renderer/components/ui/provider", () => ({
  useResolvedAppearance: () => fixture.appearance,
}));
vi.mock("./shikiClient", () => ({
  ensureLanguage: async () => true,
  getShikiHighlighter: fixture.getHighlighter,
  transparentBgTransformer: {},
}));
beforeEach(() => {
  fixture.appearance = "dark";
  fixture.codeToHtml
    .mockReset()
    .mockImplementation(
      (text: string, options: { theme: string; lang: string }) =>
        `<pre data-theme="${options.theme}" data-language="${options.lang}">${text}</pre>`,
    );
  fixture.getHighlighter.mockReset().mockResolvedValue({ codeToHtml: fixture.codeToHtml });
});
afterEach(cleanup);

it("does not tokenize a superseded block after delayed highlighter loading", async () => {
  let release!: (value: { codeToHtml: typeof fixture.codeToHtml }) => void;
  fixture.getHighlighter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = render(<CodeBlock text="superseded-block" lang="json" />);
  await waitFor(() => expect(fixture.getHighlighter).toHaveBeenCalledTimes(1));
  view.rerender(<CodeBlock text="current-block" lang="json" />);
  await waitFor(() =>
    expect(view.container.querySelector(".lc-shiki")?.textContent).toBe("current-block"),
  );
  await act(async () => {
    release({ codeToHtml: fixture.codeToHtml });
  });
  expect(fixture.codeToHtml).toHaveBeenCalledTimes(1);
  expect(fixture.codeToHtml.mock.calls[0]?.[0]).toBe("current-block");
});

it("reuses small cached results and separates theme and language changes", async () => {
  const view = render(<CodeBlock text="cache-small-fixture" lang="json" />);
  await waitFor(() => expect(view.container.querySelector(".lc-shiki")).not.toBeNull());
  view.unmount();
  const next = render(<CodeBlock text="cache-small-fixture" lang="json" />);
  expect(fixture.codeToHtml).toHaveBeenCalledTimes(1);
  fixture.appearance = "light";
  next.rerender(<CodeBlock text="cache-small-fixture" lang="typescript" />);
  await waitFor(() =>
    expect(next.container.querySelector("pre")?.dataset.theme).toBe("github-light"),
  );
  expect(next.container.querySelector("pre")?.dataset.language).toBe("typescript");
});

it("renders oversized code in full and can recompute it after reopening", async () => {
  const text = "original-start:" + "x".repeat(2_200_000) + ":original-tail";
  const first = render(<CodeBlock text={text} lang="json" />);
  await waitFor(() => expect(first.container.querySelector(".lc-shiki")?.textContent).toBe(text));
  first.unmount();
  const second = render(<CodeBlock text={text} lang="json" />);
  await waitFor(() => expect(fixture.codeToHtml).toHaveBeenCalledTimes(2));
  expect(second.container.textContent).toBe(text);
});

it("preserves the complete plain fallback when loading the highlighter fails", async () => {
  fixture.getHighlighter.mockRejectedValueOnce(new Error("WASM unavailable"));
  render(<CodeBlock text="fallback-complete-你好🙂" lang="json" />);
  await waitFor(() => expect(fixture.getHighlighter).toHaveBeenCalled());
  expect(screen.getByText("fallback-complete-你好🙂")).toBeInTheDocument();
});
