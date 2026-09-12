// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/renderer/i18n/i18n";
import type { FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { ProjectFilesPanel } from "./ProjectFilesPanel";

function renderPanel() {
  return render(
    <I18nProvider i18n={i18n}>
      <ProjectFilesPanel rootContext={rootContext} />
    </I18nProvider>,
  );
}

vi.mock("./FileEditorPane/FileEditorPane", () => ({
  FileEditorPane: () => <div data-testid="file-preview-workspace">preview</div>,
}));

vi.mock("./ProjectTreeView/ProjectTreeView", () => ({
  ProjectTreeView: () => <div data-testid="project-file-tree">tree</div>,
}));

const rootContext: FileEditorRootContext = {
  projectId: "codex-router",
  projectName: "CodexRouter",
  projectLocation: { kind: "windows", path: "D:\\Work\\CodexRouter" },
  rootLabel: "CodexRouter",
};

describe("ProjectFilesPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useFileEditorStore.setState({
      rootContext: null,
      overlayMode: null,
      tabs: [],
      activePath: null,
      previewTab: null,
      markdownPreviewPath: null,
      buffers: {},
      refreshToken: 0,
      pendingReveal: null,
    });
  });

  it("mounts the preview and project tree in the same docked files workspace", async () => {
    renderPanel();

    expect(screen.getByTestId("file-preview-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("project-file-tree")).toBeInTheDocument();
    await waitFor(() => {
      expect(useFileEditorStore.getState().rootContext).toEqual(rootContext);
    });
  });

  it("resets the editor root when the same project id points at a new filesystem location", () => {
    useFileEditorStore.getState().setRootContext({
      ...rootContext,
      projectLocation: { kind: "windows", path: "D:\\Work\\CodexRouter\\stale" },
    });

    renderPanel();

    expect(useFileEditorStore.getState().rootContext?.projectLocation).toEqual(
      rootContext.projectLocation,
    );
    expect(useFileEditorStore.getState().activePath).toBeNull();
  });

  it("resizes the file list by dragging its left edge and persists the width", () => {
    const { container } = renderPanel();
    const aside = container.querySelector("aside");
    expect(aside).toHaveStyle({ width: "280px" });

    const handle = screen.getByRole("separator", { name: "Resize file list" });
    fireEvent.mouseDown(handle, { clientX: 1000 });
    fireEvent.mouseMove(window, { clientX: 940 });
    fireEvent.mouseUp(window);

    // Dragging left by 60px grows the right-anchored tree by 60px.
    expect(aside).toHaveStyle({ width: "340px" });
    expect(window.localStorage.getItem("craftstation.projectFiles.treeWidthPx")).toBe("340");
  });

  it("clamps the dragged width and supports keyboard resizing", () => {
    const { container } = renderPanel();
    const aside = container.querySelector("aside");
    const handle = screen.getByRole("separator", { name: "Resize file list" });

    fireEvent.mouseDown(handle, { clientX: 1000 });
    fireEvent.mouseMove(window, { clientX: 2000 });
    fireEvent.mouseUp(window);
    expect(aside).toHaveStyle({ width: "200px" });

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(aside).toHaveStyle({ width: "224px" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(aside).toHaveStyle({ width: "200px" });
  });
});
