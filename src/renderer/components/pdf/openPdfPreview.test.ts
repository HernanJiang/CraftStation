import { beforeEach, describe, expect, it, vi } from "vitest";

const browserCreateTab = vi.hoisted(() =>
  vi
    .fn<(payload: { url: string; activate: boolean; reveal?: boolean }) => Promise<void>>()
    .mockResolvedValue(),
);
const browserActivateTab = vi.hoisted(() =>
  vi.fn<(payload: { tabId: string }) => Promise<void>>().mockResolvedValue(),
);

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({ browserCreateTab, browserActivateTab }),
}));

import { openPdfPreview, resolvePdfHostPath } from "./openPdfPreview";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { usePanelStore } from "@/renderer/state/panelStore";

describe("resolvePdfHostPath", () => {
  it("joins relative paths for Windows projects", () => {
    expect(
      resolvePdfHostPath("docs/a.pdf", {
        kind: "windows",
        path: "C:\\repo",
      }),
    ).toBe("C:\\repo\\docs\\a.pdf");
  });

  it("maps WSL relative paths to UNC", () => {
    expect(
      resolvePdfHostPath("docs/a.pdf", {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/me/repo",
        uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\me\\repo",
      }),
    ).toBe("\\\\wsl.localhost\\Ubuntu\\home\\me\\repo\\docs\\a.pdf");
  });

  it("maps WSL linux absolute paths to UNC", () => {
    expect(
      resolvePdfHostPath("/home/me/repo/docs/a.pdf", {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/me/repo",
        uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\me\\repo",
      }),
    ).toBe("\\\\wsl.localhost\\Ubuntu\\home\\me\\repo\\docs\\a.pdf");
  });

  it("leaves host UNC paths unchanged for WSL projects", () => {
    const unc = "\\\\wsl.localhost\\Ubuntu\\home\\me\\doc.pdf";
    expect(
      resolvePdfHostPath(unc, {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/me/repo",
        uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\me\\repo",
      }),
    ).toBe(unc);
  });
});

describe("openPdfPreview", () => {
  beforeEach(() => {
    browserCreateTab.mockClear();
    browserActivateTab.mockClear();
    useBrowserPanelStore.setState({ tabs: [], activeTabId: null, extracted: false });
  });

  it("creates a browser tab with reveal so presentation matches link opens", () => {
    openPdfPreview("C:\\Users\\me\\Biometric Reuse.pdf");

    expect(browserCreateTab).toHaveBeenCalledWith({
      url: "file:///C:/Users/me/Biometric%20Reuse.pdf",
      activate: true,
      reveal: true,
    });
  });

  it("resolves project-relative paths before opening", () => {
    openPdfPreview("docs/a.pdf", { kind: "windows", path: "C:\\repo" });

    expect(browserCreateTab).toHaveBeenCalledWith({
      url: "file:///C:/repo/docs/a.pdf",
      activate: true,
      reveal: true,
    });
  });

  it("reuses an existing tab at the same file URL instead of duplicating it", () => {
    useBrowserPanelStore.setState({
      tabs: [
        {
          tabId: "tab-pdf",
          url: "file:///C:/repo/docs/a.pdf",
          title: "a.pdf",
          loading: false,
          canGoBack: false,
          canGoForward: false,
        },
      ],
      activeTabId: "tab-pdf",
    });

    openPdfPreview("docs/a.pdf", { kind: "windows", path: "C:\\repo" });

    expect(browserCreateTab).not.toHaveBeenCalled();
    expect(browserActivateTab).toHaveBeenCalledWith({ tabId: "tab-pdf" });
    expect(usePanelStore.getState().rightPanelTab).toBe("browser");
    expect(usePanelStore.getState().browserPanelOpen).toBe(true);
  });
});
