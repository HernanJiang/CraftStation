import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "@heroui/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import { ImageLightboxHost } from "@/renderer/components/composer";
import { ChatPaneActionsContext, type ChatPaneActions } from "../../chatPaneActionsContext";
import ItemMarkdownInner from "./ItemMarkdownInner";
import { LC_SELECTOR_LANG } from "./SelectorBadge";

const { codeBlockSpy } = vi.hoisted(() => ({
  codeBlockSpy:
    vi.fn<(props: { text: string; lang: string; className: string | undefined }) => void>(),
}));

vi.mock("./CodeBlock", () => ({
  CodeBlock: ({ text, lang, className }: { text: string; lang: string; className?: string }) => {
    codeBlockSpy({ text, lang, className });
    return (
      <div data-testid="code-block" data-lang={lang} className={className}>
        {text}
      </div>
    );
  },
}));

const toastDangerSpy = vi.spyOn(toast, "danger").mockImplementation(() => undefined as never);

describe("ItemMarkdownInner", () => {
  beforeEach(() => {
    codeBlockSpy.mockClear();
    toastDangerSpy.mockClear();
    Reflect.deleteProperty(window, "craftstation");
  });

  it("routes supported fenced code blocks through CodeBlock", () => {
    render(
      <AppProvider>
        <ItemMarkdownInner
          text={"```css\n.animate-tool-call-enter {\n  animation: fade-in;\n}\n```"}
        />
      </AppProvider>,
    );

    expect(screen.getByTestId("code-block")).toHaveAttribute("data-lang", "css");
    expect(codeBlockSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: ".animate-tool-call-enter {\n  animation: fade-in;\n}",
        lang: "css",
        className: expect.stringContaining("lc-md-code-block"),
      }),
    );
  });

  it("keeps inline code on the inline code path", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"Use `const value = 1` in the snippet."} />
      </AppProvider>,
    );

    expect(screen.queryByTestId("code-block")).not.toBeInTheDocument();
    expect(container.querySelector("code")).toHaveTextContent("const value = 1");
  });

  it("renders inline and display LaTeX through KaTeX", async () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner
          text={`Inline $x^2$

$$
\\frac{1}{2}
$$`}
        />
      </AppProvider>,
    );

    await waitFor(() => expect(container.querySelectorAll(".katex").length).toBeGreaterThan(0));
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(
      container.querySelectorAll('annotation[encoding="application/x-tex"]')[1],
    ).toHaveTextContent("\\frac{1}{2}");
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("renders classic \\[ ... \\] display delimiters through KaTeX", async () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"\\[\n\\Delta=b^2-4ac\n\\]"} />
      </AppProvider>,
    );

    await waitFor(() => expect(container.querySelectorAll(".katex")).toHaveLength(1));
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector('annotation[encoding="application/x-tex"]')).toHaveTextContent(
      "\\Delta=b^2-4ac",
    );
    expect(container.textContent).not.toContain("\\[");
  });

  it("renders classic \\( ... \\) inline delimiters through KaTeX", async () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"the root is \\(x=\\frac{-1}{2}\\) indeed"} />
      </AppProvider>,
    );

    await waitFor(() => expect(container.querySelectorAll(".katex")).toHaveLength(1));
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.textContent).toContain("indeed");
  });

  it("renders formulas containing `<` instead of falling back to raw source", async () => {
    // Regression: `escapeBareAngleTags` used to rewrite `<t` to `&lt;t` inside
    // math, which made KaTeX throw and the whole formula rendered raw.
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner
          text={
            "$$\\mathcal{L}_{\\mathrm{CE}} = -\\frac{1}{N} \\sum_{t=1}^{N} \\log p_{\\theta}(y_t \\mid x, y_{<t})$$"
          }
        />
      </AppProvider>,
    );

    await waitFor(() => expect(container.querySelectorAll(".katex")).toHaveLength(1));
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("recovers formulas whose source already contains `&lt;` entities", async () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"$$y_{&lt;t}$$"} />
      </AppProvider>,
    );

    await waitFor(() => expect(container.querySelectorAll(".katex")).toHaveLength(1));
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("keeps math-signal-less escaped brackets as literal text", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"see \\[appendix\\] and cite \\[1\\] please"} />
      </AppProvider>,
    );

    expect(container.textContent).toContain("[appendix]");
    expect(container.textContent).toContain("[1]");
    expect(container.querySelectorAll(".katex")).toHaveLength(0);
  });

  it("renders Mermaid flowcharts and normalizes diagram fence aliases", async () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner
          text={`\`\`\`flowchart
flowchart TD
  A[Start] --> B[End]
\`\`\``}
        />
      </AppProvider>,
    );

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull(), { timeout: 5000 });
    expect(screen.queryByTestId("code-block")).not.toBeInTheDocument();
  });

  it("styles tensor pipeline prose like a code block", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner
          text={"CLIP encoder -> Linear projection -> modality_router -> Qwen LoRA"}
        />
      </AppProvider>,
    );

    const architectureBlock = container.querySelector(".lc-md-code-block");
    expect(architectureBlock).toHaveClass("lc-md-code-block", "font-mono");
    expect(architectureBlock).toHaveTextContent(
      "CLIP encoder -> Linear projection -> modality_router -> Qwen LoRA",
    );
    expect(architectureBlock?.tagName).toBe("DIV");
  });

  it("keeps ordinary arrow prose on the paragraph path", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"Open the menu -> choose Settings -> save your changes."} />
      </AppProvider>,
    );

    expect(container.querySelector("p")).toHaveTextContent(
      "Open the menu -> choose Settings -> save your changes.",
    );
    expect(container.querySelector(".lc-md-code-block")).toBeNull();
  });

  it("falls back to a plain pre/code block for language-less fences", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"```\nplain block\n```"} />
      </AppProvider>,
    );

    expect(screen.queryByTestId("code-block")).not.toBeInTheDocument();
    expect(container.querySelector("pre > code")).toHaveTextContent("plain block");
    expect(container.querySelector("pre")).toHaveClass("lc-md-code-block");
  });

  it("falls back to a plain pre/code block for unsupported fence languages", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"```text\nplain block\n```"} />
      </AppProvider>,
    );

    expect(screen.queryByTestId("code-block")).not.toBeInTheDocument();
    expect(container.querySelector("pre > code")).toHaveTextContent("plain block");
    expect(container.querySelector("pre")).toHaveClass("lc-md-code-block");
  });

  it("styles architecture fences as gray diagram cards", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner
          text={
            "```\nUI (IPC) → ScheduleCapability → ScheduleService → SQLite\n        ↓\nScheduleRunCoordinator\n```"
          }
        />
      </AppProvider>,
    );

    const diagram = container.querySelector("pre.lc-md-code-block");
    expect(diagram).toBeTruthy();
    expect(diagram).toHaveTextContent("ScheduleCapability");
    expect(diagram?.closest(".lc-chat-markdown")).toBeTruthy();
  });

  it("treats range/path fence info as a code fence header, not visible body text", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"```1:30:AGENTS.md\n# AGENTS.md\n\nBody\n```"} />
      </AppProvider>,
    );

    expect(screen.getByTestId("code-block")).toHaveAttribute("data-lang", "markdown");
    expect(screen.getByTestId("code-block")).toHaveTextContent("# AGENTS.md Body");
    expect(container).not.toHaveTextContent("1:30:AGENTS.md");
  });

  it("hides browser selector metadata fences", () => {
    const payload = JSON.stringify({
      selector: "svg.lnXdpd > path",
      url: "https://www.google.com/",
      name: "selection.png",
    });
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner
          text={`before\n\n\`\`\`${LC_SELECTOR_LANG}\n${payload}\n\`\`\`\n\nafter`}
        />
      </AppProvider>,
    );

    expect(container).toHaveTextContent("before");
    expect(container).toHaveTextContent("after");
    expect(container).not.toHaveTextContent("svg.lnXdpd > path");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders single newlines as line breaks", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"line 1\nline 2"} />
      </AppProvider>,
    );

    expect(container.querySelector("p")?.textContent).toBe("line 1\nline 2");
  });

  it("caps markdown images so tall screenshots do not fill the chat", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"![Tall screenshot](https://example.test/tall-screenshot.png)"} />
      </AppProvider>,
    );

    const img = screen.getByAltText("Tall screenshot");
    expect(img).toHaveClass("max-h-[min(18rem,40vh)]", "max-w-full", "object-contain");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("draggable", "false");
    expect(img.closest('[data-craftstation-image-card="true"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open preview" })).toBeTruthy();
    expect(container.querySelector("p div")).toBeNull();
  });

  it("opens markdown images in the shared lightbox", () => {
    render(
      <AppProvider>
        <ItemMarkdownInner text={"![Screenshot](https://example.test/screenshot.png)"} />
        <ImageLightboxHost />
      </AppProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open image preview" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.querySelector(".craftstation-image-lightbox__image")).toHaveAttribute(
      "src",
      "https://example.test/screenshot.png",
    );
  });

  it("renders Windows absolute markdown image paths through the local file protocol", () => {
    render(
      <AppProvider>
        <ItemMarkdownInner
          text={"![Before](C:/Users/sdsle/.craftstation-smoke/artifacts/composer-before-full.png)"}
        />
      </AppProvider>,
    );

    expect(screen.getByAltText("Before")).toHaveAttribute(
      "src",
      "craftstation-local://local/C:/Users/sdsle/.craftstation-smoke/artifacts/composer-before-full.png",
    );
  });

  it("renders remote markdown image paths through the host image endpoint", () => {
    const remoteLocalImageUrl = vi.fn<(url: string) => string>(
      () => "https://remote.test/api/files/image?path=screenshot.png",
    );
    const actions = makeActions({ remoteLocalImageUrl });

    render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner text={"![Screenshot](/tmp/screenshot.png)"} />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    expect(remoteLocalImageUrl).toHaveBeenCalledWith(
      "craftstation-local://local/tmp/screenshot.png",
    );
    expect(screen.getByAltText("Screenshot")).toHaveAttribute(
      "src",
      "https://remote.test/api/files/image?path=screenshot.png",
    );
  });

  it("renders Windows backslash markdown image paths without CommonMark escape corruption", () => {
    // Paths with `\.` (dot-folders) are mangled by CommonMark unless rewritten
    // to craftstation-local:// before parse.
    render(
      <AppProvider>
        <ItemMarkdownInner
          text={
            "![Before](C:\\Users\\sdsle\\.grok\\sessions\\E%3A%5Cwork\\assets\\image-ea056148.png)"
          }
        />
      </AppProvider>,
    );

    const src = screen.getByAltText("Before").getAttribute("src") ?? "";
    expect(src.startsWith("craftstation-local://local/")).toBe(true);
    // Literal percent folder names must be double-encoded in the URL so the
    // protocol handler's decodeURIComponent restores E%3A… rather than E:…
    expect(src).toContain("E%253A%255Cwork");
    expect(src).toContain(".grok");
    expect(src).not.toContain("sdsle.grok");
  });

  it("renders project-relative markdown image paths via the local file protocol", () => {
    const actions = makeActions({
      projectLocation: {
        kind: "windows",
        path: "E:\\work\\craftstation\\.craftstation\\worktrees\\craftstation-brave-willow-b4fc6c26",
      },
    });

    render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner
            text={"![After](verification-shots/01-collapsed-same-file-edits.png)"}
          />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    const src = screen.getByAltText("After").getAttribute("src") ?? "";
    expect(src.startsWith("craftstation-local://local/E:")).toBe(true);
    expect(src).toContain("verification-shots");
    expect(src).toContain("01-collapsed-same-file-edits.png");
  });

  it("copies project-relative markdown images through the local-file bridge", async () => {
    const readLocalImageFile = vi
      .fn<(payload: { url: string }) => Promise<Uint8Array>>()
      .mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    const copyImageToClipboard = vi
      .fn<(payload: { data: Uint8Array }) => Promise<boolean>>()
      .mockResolvedValue(true);
    Object.defineProperty(window, "craftstation", {
      configurable: true,
      value: {
        appVersion: "test",
        setWindowChrome: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        readLocalImageFile,
        copyImageToClipboard,
      },
    });
    const actions = makeActions({
      projectLocation: { kind: "posix", path: "/tmp/project" },
    });

    render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner text={"![Screenshot](images/screenshot.png)"} />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy image" }));

    await waitFor(() => expect(copyImageToClipboard).toHaveBeenCalledTimes(1));
    expect(readLocalImageFile).toHaveBeenCalledWith({
      url: "craftstation-local://local/tmp/project/images/screenshot.png",
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("renders Grok session-relative images/ markdown via the local file protocol", () => {
    const sessionDir =
      "C:\\Users\\sdsle\\.grok\\sessions\\E%3A%5Cwork%5Ccraftstation%5C.craftstation%5Cworktrees%5Ccraftstation-warm-yak-d27ed350\\019f6789-4fd1-7740-a828-9a42918d42e8";
    const actions = makeActions({
      projectLocation: {
        kind: "windows",
        path: "E:\\work\\craftstation\\.craftstation\\worktrees\\craftstation-warm-yak-d27ed350",
      },
      markdownImageRoots: [sessionDir],
    });

    render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner text={"![Modal PDF preview](images/4.jpg)"} />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    const src = screen.getByAltText("Modal PDF preview").getAttribute("src") ?? "";
    expect(src.startsWith("craftstation-local://local/")).toBe(true);
    expect(src).toContain("images");
    expect(src).toContain("4.jpg");
    // Must land under the Grok session dir, not the project root.
    expect(src).toContain(".grok");
    expect(src).toContain("E%253A%255Cwork");
  });

  it("normalizes absolute markdown link hrefs to project file chips", () => {
    const actions = makeActions();

    const { container } = render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner
            text={
              "Changed [styles.css](/Users/serhiivecherenko/work/craftstation/src/renderer/styles.css)"
            }
          />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    const chip = screen.getByRole("button", { name: /styles\.css/ });
    expect(chip).toHaveAttribute("title", "src/renderer/styles.css");
    expect(container.querySelector('a[href^="/Users/"]')).toBeNull();

    fireEvent.click(chip);
    expect(actions.openProjectRelativePath).toHaveBeenCalledWith(
      "src/renderer/styles.css",
      undefined,
    );
  });

  it("opens a project PDF link with a directory via the file open path", () => {
    const actions = makeActions({ projectRootNames: new Set(["Paper"]) });

    render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner text={"See [the paper](Paper/iclr2027_conference.pdf) for details."} />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    const chip = screen.getByRole("button", { name: /iclr2027_conference\.pdf/ });
    fireEvent.click(chip);
    expect(actions.openProjectRelativePath).toHaveBeenCalledWith(
      "Paper/iclr2027_conference.pdf",
      undefined,
    );
  });

  it("autolinks a plain-text PDF path with a directory as a file chip", () => {
    const actions = makeActions({ projectRootNames: new Set(["Paper"]) });

    render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner text={"详见 Paper/iclr2027_conference.pdf 第 3 节。"} />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    const chip = screen.getByRole("button", { name: /iclr2027_conference\.pdf/ });
    fireEvent.click(chip);
    expect(actions.openProjectRelativePath).toHaveBeenCalledWith(
      "Paper/iclr2027_conference.pdf",
      undefined,
    );
  });

  it("renders a bare filename with a line number as a clickable file chip", () => {
    const actions = makeActions();

    render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner text={"BrowserPanelManager.ts:288 lost its badge."} />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    const chip = screen.getByRole("button", { name: /BrowserPanelManager\.ts.*288/ });
    expect(chip).toHaveAttribute("title", "BrowserPanelManager.ts:288");

    fireEvent.click(chip);
    expect(actions.openProjectRelativePath).toHaveBeenCalledWith("BrowserPanelManager.ts", 288);
  });

  it("makes an unresolved bare filename chip read-only after the index lookup fails", async () => {
    const actions = makeActions({
      openProjectRelativePath: vi
        .fn<(path: string, lineNumber?: number) => Promise<void>>()
        .mockRejectedValue(new Error("File not found")),
    });

    render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner text={"MissingFile.ts:12 could not be found."} />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    const chip = screen.getByRole("button", { name: /MissingFile\.ts.*12/ });
    fireEvent.click(chip);

    await waitFor(() => expect(chip).toBeDisabled());
    expect(chip).toHaveClass("craftstation-inline-path-chip--inert");
  });

  it("keeps out-of-project absolute markdown link hrefs absolute", () => {
    const actions = makeActions();

    render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner text={"Read [outside.txt](/tmp/outside.txt)"} />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    const chip = screen.getByRole("button", { name: /outside\.txt/ });
    expect(chip).toHaveAttribute("title", "/tmp/outside.txt");

    fireEvent.click(chip);
    expect(actions.openProjectRelativePath).toHaveBeenCalledWith("/tmp/outside.txt", undefined);
  });

  it.each([
    [
      "/D:/Work/EQ-Agent/review/EQ-Dataset-v1-20260919/index.html",
      "review/EQ-Dataset-v1-20260919/index.html",
    ],
    ["/D:/Work/EQ-Agent/review/文件%20验证/index.html", "review/文件 验证/index.html"],
    ["file:///D:/Work/EQ-Agent/review/100%2520literal.html", "review/100%20literal.html"],
    ["D:/External/index.html", "D:/External/index.html"],
  ])("opens Windows markdown path %s", (href, expected) => {
    const actions = makeActions({
      projectLocation: { kind: "windows", path: "D:\\Work\\EQ-Agent" },
      projectRootNames: new Set(["review"]),
    });
    render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={actions}>
          <ItemMarkdownInner text={`[index.html](${href})`} />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /index\.html|literal\.html/ }));
    expect(actions.openProjectRelativePath).toHaveBeenCalledWith(expected, undefined);
  });

  it("does not leave a malformed table as raw piped text", () => {
    // 4-cell header but only 3 separator segments. Without normalization
    // remark-gfm rejects the table and renders the source as a raw paragraph
    // of pipes — the failure users report as a corrupted table. After
    // normalization the block should be recognized as a table, so no `<p>`
    // contains the raw pipes.
    const malformed = ["| a | b | c | d |", "|---|---|---|", "| 1 | 2 | 3 | 4 |", ""].join("\n");

    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={malformed} />
      </AppProvider>,
    );

    const rawParagraph = Array.from(container.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").includes("| a | b |"),
    );
    expect(rawParagraph).toBeUndefined();
  });

  it("renders a table whose header row is entirely empty", () => {
    // Observed from Grok: an all-empty header (`| | |`) with a single-segment
    // separator under it. The empty header carries no text character, so the
    // separator was never repaired and remark-gfm rejected the block.
    const emptyHeader = ["| | |", "|---|", "| 唯一变量 | 只训 MLP |", "| 起点 | 76.03 |", ""].join(
      "\n",
    );

    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={emptyHeader} />
      </AppProvider>,
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const rows = table!.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelectorAll("td")).toHaveLength(2);
  });

  it("renders a markdown table with thead, tbody, th and td elements", () => {
    const mdTable = [
      "| Name | Role |",
      "|------|------|",
      "| Alice | Engineer |",
      "| Bob | Designer |",
      "",
    ].join("\n");

    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={mdTable} />
      </AppProvider>,
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();

    const thead = table!.querySelector("thead");
    expect(thead).not.toBeNull();

    const ths = thead!.querySelectorAll("th");
    expect(ths).toHaveLength(2);
    expect(ths[0]).toHaveTextContent("Name");
    expect(ths[1]).toHaveTextContent("Role");

    const tbody = table!.querySelector("tbody");
    expect(tbody).not.toBeNull();

    const rows = tbody!.querySelectorAll("tr");
    expect(rows).toHaveLength(2);

    const firstRowCells = rows[0]!.querySelectorAll("td");
    expect(firstRowCells).toHaveLength(2);
    expect(firstRowCells[0]).toHaveTextContent("Alice");
    expect(firstRowCells[1]).toHaveTextContent("Engineer");
  });

  it("renders the table frame with square corners", () => {
    const mdTable = ["| Name | Role |", "|------|------|", "| Alice | Engineer |"].join("\n");

    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={mdTable} />
      </AppProvider>,
    );

    const frame = container.querySelector("table")!.closest("div");
    expect(frame).not.toBeNull();
    expect(frame!.className).not.toMatch(/rounded/);
    expect(frame!.className).toContain("border");
  });

  it("does not render incomplete absolute markdown hrefs as browser links", () => {
    const { container } = render(
      <AppProvider>
        <ChatPaneActionsContext.Provider value={makeActions()}>
          <ItemMarkdownInner text={"Changed [styles.css](/"} />
        </ChatPaneActionsContext.Provider>
      </AppProvider>,
    );

    expect(container.querySelector('a[href="/"]')).toBeNull();
    expect(container).toHaveTextContent("Changed styles.css");
    expect(screen.queryByText(/\[blocked\]/)).not.toBeInTheDocument();
  });

  it("keeps bare pseudo-XML tags visible instead of letting sanitize eat them", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"<plan>\n<response>最终回复</response>\n"} />
      </AppProvider>,
    );

    expect(container).toHaveTextContent("<plan>");
    expect(container).toHaveTextContent("<response>");
    expect(container).toHaveTextContent("最终回复");
  });

  it("reports failed markdown link opens", async () => {
    const openExternal = vi
      .fn<(href: string) => Promise<void>>()
      .mockRejectedValue(new Error("open failed"));
    Object.defineProperty(window, "craftstation", {
      configurable: true,
      value: {
        openExternal,
        setWindowChrome: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
    });

    render(
      <AppProvider>
        <ItemMarkdownInner text={"Open [docs](https://example.test/docs)."} />
      </AppProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: /docs/ }));

    await waitFor(() => {
      expect(toastDangerSpy).toHaveBeenCalledWith("open failed");
    });
    expect(openExternal).toHaveBeenCalledWith("https://example.test/docs");
  });
});

function makeActions(overrides?: Partial<ChatPaneActions>): ChatPaneActions {
  return {
    openProjectRelativePath: vi.fn<(path: string, lineNumber?: number) => Promise<void>>(),
    revealProjectFolderInTree: vi.fn<(path: string) => void>(),
    showProjectEntryInExplorer: vi.fn<(path: string) => void>(),
    onContentHeightChange: vi.fn<() => void>(),
    projectLocation: { kind: "posix", path: "/Users/serhiivecherenko/work/craftstation" },
    projectRootNames: new Set(["src"]),
    ...overrides,
  };
}
