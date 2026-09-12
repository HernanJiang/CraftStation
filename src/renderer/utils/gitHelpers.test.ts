import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CraftStationBridge } from "@/shared/ipc";
import type { Project } from "@/shared/contracts";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { openFileInRightPanel } from "./gitHelpers";

const readProjectFile = vi.fn<CraftStationBridge["readProjectFile"]>();

function stubBridge() {
  Object.defineProperty(window, "craftstation", {
    configurable: true,
    writable: true,
    value: { readProjectFile },
  });
}

function makeProject(): Project {
  return {
    id: "p1",
    name: "Demo",
    location: { kind: "windows", path: "D:/demo" },
  } as unknown as Project;
}

function resetEditor() {
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
}

describe("openFileInRightPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubBridge();
    resetEditor();
    usePanelStore.setState({
      auxiliaryPanelPlacement: "hidden",
      rightPanelTab: null,
      auxiliaryPanelTab: null,
      auxiliaryPanelTabs: [],
    } as never);
    readProjectFile.mockResolvedValue({
      path: "notes.md",
      status: "ready",
      modifiedAtMs: 1,
      content: "# hello",
      lineEnding: "lf",
      hasBom: false,
    } as never);
  });

  it("opens a markdown file as a right-panel tab in rendered preview without overlay", async () => {
    await openFileInRightPanel(makeProject(), undefined, undefined, "notes.md");

    const editor = useFileEditorStore.getState();
    expect(editor.overlayMode).toBeNull();
    expect(editor.tabs).toContain("notes.md");
    expect(editor.activePath).toBe("notes.md");
    expect(editor.markdownPreviewPath).toBe("notes.md");
    const panel = usePanelStore.getState();
    expect(panel.rightPanelTab).toBe("files");
    expect(panel.auxiliaryPanelPlacement).toBe("right");
  });

  it("opens source files without preview and stacks each click as a new tab", async () => {
    await openFileInRightPanel(makeProject(), undefined, undefined, "a.ts");
    await openFileInRightPanel(makeProject(), undefined, undefined, "b.ts");

    const editor = useFileEditorStore.getState();
    expect(editor.overlayMode).toBeNull();
    expect(editor.tabs).toEqual(["a.ts", "b.ts"]);
    expect(editor.activePath).toBe("b.ts");
    expect(editor.markdownPreviewPath).toBeNull();
  });
});
