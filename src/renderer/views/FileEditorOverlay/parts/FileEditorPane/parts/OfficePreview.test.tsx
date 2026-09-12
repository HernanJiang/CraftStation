// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@/renderer/i18n/i18n";
import type { ProjectLocation } from "@/shared/contracts";
import { OfficePreview } from "./OfficePreview";

const bridge = vi.hoisted(() => ({
  extractOfficeDocumentText: vi.fn<(payload: unknown) => Promise<{ text: string; truncated: boolean }>>(),
  openProjectEntryWithSystem: vi.fn<(payload: unknown) => Promise<void>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

const location: ProjectLocation = { kind: "windows", path: "D:\\Work\\repo" };

function renderPreview() {
  return render(
    <I18nProvider i18n={i18n}>
      <OfficePreview path="docs/report.docx" projectLocation={location} />
    </I18nProvider>,
  );
}

describe("OfficePreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders extracted text with a text-only note", async () => {
    bridge.extractOfficeDocumentText.mockResolvedValue({ text: "Hello report", truncated: true });
    renderPreview();

    await waitFor(() => {
      expect(screen.getByText("Hello report")).toBeInTheDocument();
    });
    expect(bridge.extractOfficeDocumentText).toHaveBeenCalledWith({
      projectLocation: location,
      path: "docs/report.docx",
    });
    expect(screen.getByText("Text-only preview — formatting and images are omitted.")).toBeInTheDocument();
    expect(screen.getByText("Preview truncated — open the file for the full text.")).toBeInTheDocument();
  });

  it("offers the system default app when extraction fails", async () => {
    bridge.extractOfficeDocumentText.mockRejectedValue(new Error("Not a zip archive"));
    renderPreview();

    await waitFor(() => {
      expect(screen.getByText("Not a zip archive")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open With System Default" })).toBeInTheDocument();
  });
});
