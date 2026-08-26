// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/renderer/i18n/i18n";
import type { Project, ProjectTreeEntry } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useProjectTreeStore } from "@/renderer/state/projectTreeStore";
import { useFileEditorStore, type FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { ProjectTreeView } from "./ProjectTreeView";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; estimateSize?: () => number }) => ({
    getTotalSize: () => options.count * (options.estimateSize?.() ?? 24),
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        start: index * (options.estimateSize?.() ?? 24),
        size: options.estimateSize?.() ?? 24,
      })),
  }),
}));

const bridge = vi.hoisted(() => ({
  listProjectTree:
    vi.fn<(payload: unknown) => Promise<{ directoryPath: string; entries: unknown[] }>>(),
  createProjectEntry: vi.fn<(payload: unknown) => Promise<void>>(),
  renameProjectEntry: vi.fn<(payload: unknown) => Promise<void>>(),
  deleteProjectEntry: vi.fn<(payload: unknown) => Promise<void>>(),
  searchProjectTree: vi.fn<(payload: unknown) => Promise<{ entries: ProjectTreeEntry[] }>>(),
  revealProjectEntry: vi.fn<(payload: unknown) => Promise<void>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

const projectA: Project = {
  id: "project-a",
  name: "CodexRouter",
  location: { kind: "windows", path: "D:\\Work\\CodexRouter" },
  createdAt: "2026-08-03T00:00:00.000Z",
};

const rootContextA: FileEditorRootContext = {
  projectId: projectA.id,
  projectName: projectA.name,
  projectLocation: projectA.location,
  rootLabel: projectA.name,
};

describe("ProjectTreeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      projects: [projectA],
    });
    useProjectTreeStore.setState({
      generation: 0,
      rootKey: "",
      expandedPaths: { "": true },
      loadingPaths: {},
      directoryEntries: {},
      dropTargetPath: null,
      committedSearchQuery: "",
    });
    useFileEditorStore.setState({
      activePath: null,
      tabs: [],
      buffers: {},
      refreshToken: 0,
    });
    useGitStore.setState({
      statuses: {},
      worktreeStatuses: {},
    });
    bridge.listProjectTree.mockResolvedValue({ directoryPath: "", entries: [] });
    bridge.searchProjectTree.mockResolvedValue({ entries: [] });
  });

  it("renders the project root header with the active project name", async () => {
    bridge.listProjectTree.mockResolvedValue({
      directoryPath: "",
      entries: [
        { name: "src", path: "src", type: "directory", hasChildren: true },
        { name: "package.json", path: "package.json", type: "file" },
      ] satisfies ProjectTreeEntry[],
    });

    const onSelectFile = vi.fn<(path: string) => void>();
    render(
      <I18nProvider i18n={i18n}>
        <ProjectTreeView rootContext={rootContextA} onSelectFile={onSelectFile} />
      </I18nProvider>,
    );

    expect(screen.getByText("CodexRouter")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Filter files…")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument();
      expect(screen.getByText("package.json")).toBeInTheDocument();
    });
  });

  it("keeps a project-root read failure visible instead of presenting it as an empty workspace", async () => {
    bridge.listProjectTree.mockRejectedValue(new Error("ENOENT: project folder is missing"));

    render(
      <I18nProvider i18n={i18n}>
        <ProjectTreeView
          rootContext={rootContextA}
          onSelectFile={vi.fn<(path: string) => void>()}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Unable to read workspace")).toBeInTheDocument();
      expect(screen.getByText("ENOENT: project folder is missing")).toBeInTheDocument();
    });
    expect(screen.queryByText("Empty workspace")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(bridge.listProjectTree).toHaveBeenCalledTimes(2));
  });

  it("displays git modification status badge next to changed files", async () => {
    bridge.listProjectTree.mockResolvedValue({
      directoryPath: "",
      entries: [
        { name: "MainView.tsx", path: "src/MainView.tsx", type: "file" },
        { name: "newFile.ts", path: "src/newFile.ts", type: "file" },
      ] satisfies ProjectTreeEntry[],
    });

    useGitStore.setState({
      statuses: {
        "project-a": {
          isRepo: true,
          branch: "main",
          tracking: "origin/main",
          hasRemote: true,
          remoteInfo: null,
          ahead: 0,
          behind: 0,
          staged: [],
          unstaged: [
            { path: "src/MainView.tsx", status: "M", staged: false, insertions: 1, deletions: 0 },
            { path: "src/newFile.ts", status: "?", staged: false, insertions: 5, deletions: 0 },
          ],
          totalInsertions: 6,
          totalDeletions: 0,
        },
      },
    });

    render(
      <I18nProvider i18n={i18n}>
        <ProjectTreeView
          rootContext={rootContextA}
          onSelectFile={vi.fn<(path: string) => void>()}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("MainView.tsx")).toBeInTheDocument();
      expect(screen.getByText("M")).toBeInTheDocument();
      expect(screen.getByText("U")).toBeInTheDocument();
    });
  });

  it("supports fuzzy search and clearing search query", async () => {
    bridge.listProjectTree.mockResolvedValue({ directoryPath: "", entries: [] });
    bridge.searchProjectTree.mockResolvedValue({
      entries: [
        { name: "MainView.tsx", path: "src/renderer/MainView.tsx", type: "file" },
      ] satisfies ProjectTreeEntry[],
    });

    render(
      <I18nProvider i18n={i18n}>
        <ProjectTreeView
          rootContext={rootContextA}
          onSelectFile={vi.fn<(path: string) => void>()}
        />
      </I18nProvider>,
    );

    const input = screen.getByPlaceholderText("Filter files…");
    fireEvent.change(input, { target: { value: "Main" } });

    await waitFor(() => {
      expect(bridge.searchProjectTree).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "Main",
        }),
      );
      expect(screen.getByText("MainView.tsx")).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
  });
});
