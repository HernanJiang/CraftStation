// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/renderer/i18n/i18n";
import type { Project } from "@/shared/contracts";
import { useFileEditorStore, type FileEditorBuffer } from "@/renderer/state/fileEditorStore";
import { FileEditorPane } from "./FileEditorPane";

const bridge = vi.hoisted(() => ({
  revealProjectEntry: vi.fn<(payload: unknown) => Promise<void>>(),
  browserCreateTab: vi.fn<(payload: unknown) => Promise<void>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
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
