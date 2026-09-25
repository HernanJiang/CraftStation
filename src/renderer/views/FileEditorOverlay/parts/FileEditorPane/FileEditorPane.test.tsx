// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/renderer/i18n/i18n";
import type { Project } from "@/shared/contracts";
import { useFileEditorStore, type FileEditorBuffer } from "@/renderer/state/fileEditorStore";
import { FileEditorPane } from "./FileEditorPane";

const bridge = vi.hoisted(() => ({
  revealProjectEntry: vi.fn<(payload: unknown) => Promise<void>>(),
  browserCreateTab: vi.fn<(payload: unknown) => Promise<void>>(),
  extractOfficeDocumentText:
    vi.fn<(payload: unknown) => Promise<{ text: string; truncated: boolean }>>(),
  openProjectEntryWithSystem: vi.fn<(payload: unknown) => Promise<void>>(),
}));

const isRemoteSession = vi.hoisted(() => vi.fn<() => boolean>(() => false));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
  isRemoteSession: () => isRemoteSession(),
}));

vi.mock("@monaco-editor/react", () => ({
  Editor: (props: { value: string; language: string; path: string }) => (
    <div data-testid="monaco-editor" data-language={props.language}>
      {props.value}
    </div>
  ),
}));

const projectA: Project = {
  id: "project-a",
  name: "CodexRouter",
  location: { kind: "windows", path: "D:\\Work\\CodexRouter" },
  createdAt: "2026-08-03T00:00:00.000Z",
};

function makeBuffer(partial: Partial<FileEditorBuffer> & { path: string }): FileEditorBuffer {
  return {
    path: partial.path,
    status: partial.status ?? "ready",
    modifiedAtMs: partial.modifiedAtMs ?? Date.now(),
    content: partial.content ?? "",
    savedContent: partial.savedContent ?? partial.content ?? "",
    lineEnding: partial.lineEnding ?? "lf",
    hasBom: partial.hasBom ?? false,
    isDirty: partial.isDirty ?? false,
    isLoading: partial.isLoading ?? false,
  };
}

describe("FileEditorPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileEditorStore.setState({
      rootContext: {
        projectId: projectA.id,
        projectName: projectA.name,
        projectLocation: projectA.location,
        rootLabel: projectA.name,
      },
      activePath: null,
      tabs: [],
      buffers: {},
      markdownPreviewPath: null,
    });
  });

  it("renders empty state when no file is selected", () => {
    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );

    expect(screen.getByText("Open a file")).toBeInTheDocument();
    expect(
      screen.getByText("Select a file from the workspace tree to preview"),
    ).toBeInTheDocument();
  });

  it("renders image preview placeholder for image files", () => {
    useFileEditorStore.setState({
      activePath: "assets/logo.png",
      tabs: ["assets/logo.png"],
      buffers: {
        "assets/logo.png": makeBuffer({
          path: "assets/logo.png",
          status: "ready",
          content: "",
        }),
      },
    });

    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );

    const img = screen.getByRole("img", { name: "logo.png" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", expect.stringContaining("craftstation-local://"));
  });

  it("renders PDF files inline without opening a browser tab", () => {
    useFileEditorStore.setState({
      activePath: "docs/resume.pdf",
      tabs: ["docs/resume.pdf"],
      buffers: {
        "docs/resume.pdf": makeBuffer({
          path: "docs/resume.pdf",
          status: "ready",
          content: "",
        }),
      },
    });

    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );

    const frame = screen.getByTitle("resume.pdf");
    expect(frame.tagName).toBe("WEBVIEW");
    expect(frame).toHaveAttribute("src", expect.stringContaining("file://"));
    expect(frame.getAttribute("src")).toContain(".pdf");
    expect(screen.getByRole("button", { name: "Open in browser" })).toBeInTheDocument();
    expect(bridge.browserCreateTab).not.toHaveBeenCalled();
  });

  it("reloads the PDF webview when the on-disk file's mtime changes", () => {
    const seed = (modifiedAtMs: number) =>
      useFileEditorStore.setState({
        activePath: "docs/resume.pdf",
        tabs: ["docs/resume.pdf"],
        buffers: {
          "docs/resume.pdf": makeBuffer({
            path: "docs/resume.pdf",
            status: "binary",
            modifiedAtMs,
          }),
        },
      });
    seed(1);

    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );

    const first = screen.getByTitle("resume.pdf");
    expect(first.getAttribute("src")).toContain("v=1");

    // Watcher-driven refresh rebuilt the buffer with a newer mtime — the
    // webview must remount on a new cache-busted URL instead of showing the
    // stale document.
    act(() => seed(2));

    const second = screen.getByTitle("resume.pdf");
    expect(second.getAttribute("src")).toContain("v=2");
    expect(second).not.toBe(first);
  });

  it("re-extracts office documents when the on-disk file's mtime changes", async () => {
    bridge.extractOfficeDocumentText.mockResolvedValue({ text: "v1", truncated: false });
    const seed = (modifiedAtMs: number) =>
      useFileEditorStore.setState({
        activePath: "docs/report.docx",
        tabs: ["docs/report.docx"],
        buffers: {
          "docs/report.docx": makeBuffer({
            path: "docs/report.docx",
            status: "binary",
            modifiedAtMs,
          }),
        },
      });
    seed(1);

    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );

    expect(await screen.findByText("v1")).toBeInTheDocument();
    bridge.extractOfficeDocumentText.mockResolvedValue({ text: "v2", truncated: false });
    act(() => seed(2));

    expect(await screen.findByText("v2")).toBeInTheDocument();
    expect(bridge.extractOfficeDocumentText).toHaveBeenCalledTimes(2);
  });

  it("falls back to the browser tab for PDFs in remote sessions", () => {
    isRemoteSession.mockReturnValueOnce(true);
    useFileEditorStore.setState({
      activePath: "docs/resume.pdf",
      tabs: ["docs/resume.pdf"],
      buffers: {
        "docs/resume.pdf": makeBuffer({
          path: "docs/resume.pdf",
          status: "binary",
        }),
      },
    });

    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );

    expect(screen.getByText("PDF preview opens in the browser.")).toBeInTheDocument();
    expect(screen.queryByTitle("resume.pdf")).not.toBeInTheDocument();
  });

  it("renders video and audio files with native players", () => {
    useFileEditorStore.setState({
      activePath: "media/clip.mp4",
      tabs: ["media/clip.mp4"],
      buffers: {
        "media/clip.mp4": makeBuffer({ path: "media/clip.mp4", status: "binary" }),
      },
    });

    const { unmount } = render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );
    const video = screen.getByTitle("clip.mp4");
    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("src", expect.stringContaining("craftstation-local://"));
    unmount();

    useFileEditorStore.setState({
      activePath: "media/voice.mp3",
      tabs: ["media/voice.mp3"],
      buffers: {
        "media/voice.mp3": makeBuffer({ path: "media/voice.mp3", status: "binary" }),
      },
    });
    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );
    const audio = screen.getByTitle("voice.mp3");
    expect(audio.tagName).toBe("AUDIO");
    expect(audio).toHaveAttribute("src", expect.stringContaining("craftstation-local://"));
  });

  it("renders CSV files as tables and notebooks as cells", () => {
    useFileEditorStore.setState({
      activePath: "data/scores.csv",
      tabs: ["data/scores.csv"],
      buffers: {
        "data/scores.csv": makeBuffer({
          path: "data/scores.csv",
          status: "ready",
          content: "name,age\nAda,36\n",
        }),
      },
    });

    const { unmount } = render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    unmount();

    useFileEditorStore.setState({
      activePath: "notes/analysis.ipynb",
      tabs: ["notes/analysis.ipynb"],
      buffers: {
        "notes/analysis.ipynb": makeBuffer({
          path: "notes/analysis.ipynb",
          status: "ready",
          content: JSON.stringify({
            nbformat: 4,
            cells: [{ cell_type: "markdown", source: ["# Hello"] }],
          }),
        }),
      },
    });
    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders Office documents through text extraction", async () => {
    bridge.extractOfficeDocumentText.mockResolvedValue({
      text: "Quarterly results",
      truncated: false,
    });
    useFileEditorStore.setState({
      activePath: "docs/report.docx",
      tabs: ["docs/report.docx"],
      buffers: {
        "docs/report.docx": makeBuffer({ path: "docs/report.docx", status: "binary" }),
      },
    });

    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );

    expect(await screen.findByText("Quarterly results")).toBeInTheDocument();
    expect(bridge.extractOfficeDocumentText).toHaveBeenCalledWith({
      projectLocation: projectA.location,
      path: "docs/report.docx",
    });
  });

  it("renders unsupported binary file warning and action", () => {
    useFileEditorStore.setState({
      activePath: "bin/binary.exe",
      tabs: ["bin/binary.exe"],
      buffers: {
        "bin/binary.exe": makeBuffer({
          path: "bin/binary.exe",
          status: "binary",
        }),
      },
    });

    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );

    expect(screen.getByText("Binary file cannot be previewed directly.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal in File Explorer" })).toBeInTheDocument();
  });

  it("renders code editor for source files", () => {
    useFileEditorStore.setState({
      activePath: "src/index.ts",
      tabs: ["src/index.ts"],
      buffers: {
        "src/index.ts": makeBuffer({
          path: "src/index.ts",
          status: "ready",
          content: "console.log('hello');",
        }),
      },
    });

    render(
      <I18nProvider i18n={i18n}>
        <FileEditorPane showTabs={false} />
      </I18nProvider>,
    );

    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.getByText("console.log('hello');")).toBeInTheDocument();
  });
});
