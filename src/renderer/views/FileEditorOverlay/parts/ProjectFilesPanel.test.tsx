// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/renderer/i18n/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import type { FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { ProjectFilesPanel } from "./ProjectFilesPanel";

function focusThread(threadId: string) {
  useAppStore.setState({
    view: { kind: "thread", panes: [threadId] },
    focusedPaneId: threadId,
  });
}

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
  ProjectTreeView: (props: { onCollapseTree?: () => void }) => (
    <div data-testid="project-file-tree">
      {props.onCollapseTree ? (
        <button type="button" onClick={props.onCollapseTree}>
          Hide directory
        </button>
      ) : null}
    </div>
  ),
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
    focusThread("thread-a");
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

  it("collapses only the directory and restores it without unmounting the preview", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Hide directory" }));

    expect(screen.queryByTestId("project-file-tree")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-preview-workspace")).toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize file list" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show directory" }));

    expect(screen.getByTestId("project-file-tree")).toBeInTheDocument();
    expect(screen.getByTestId("file-preview-workspace")).toBeInTheDocument();
  });

  it("keeps the directory hidden after leaving the thread and coming back", () => {
    const first = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Hide directory" }));
    expect(
      window.localStorage.getItem("craftstation.projectFiles.treeCollapsedByThread"),
    ).toContain("thread-a");
    first.unmount();

    renderPanel();
    expect(screen.queryByTestId("project-file-tree")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show directory" })).toBeInTheDocument();
  });

  it("does not hide the directory of a different thread", () => {
    const first = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Hide directory" }));
    first.unmount();

    focusThread("thread-b");
    renderPanel();
    expect(screen.getByTestId("project-file-tree")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show directory" })).not.toBeInTheDocument();
  });

  it("claims a legacy app-wide collapse for the open thread only", () => {
    window.localStorage.setItem("craftstation.projectFiles.treeCollapsed", "1");
    const first = renderPanel();
    expect(screen.queryByTestId("project-file-tree")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("craftstation.projectFiles.treeCollapsed")).toBeNull();
    first.unmount();

    focusThread("thread-b");
    renderPanel();
    expect(screen.getByTestId("project-file-tree")).toBeInTheDocument();
  });
});
