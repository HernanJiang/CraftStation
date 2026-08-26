// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { ProjectFilesPanel } from "./ProjectFilesPanel";

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
    render(<ProjectFilesPanel rootContext={rootContext} />);

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

    render(<ProjectFilesPanel rootContext={rootContext} />);

    expect(useFileEditorStore.getState().rootContext?.projectLocation).toEqual(
      rootContext.projectLocation,
    );
    expect(useFileEditorStore.getState().activePath).toBeNull();
  });
});
