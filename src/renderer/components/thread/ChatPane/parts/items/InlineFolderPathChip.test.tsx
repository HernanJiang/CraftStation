import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { describe, expect, it, vi } from "vitest";
import { InlineFolderPathChip } from "./InlineFolderPathChip";

vi.mock("@/renderer/components/common/fileIcons", () => ({ getFolderIconUrl: () => "folder.png" }));

describe("InlineFolderPathChip", () => {
  it.each([
    ["Open in sidebar", 0],
    ["Open in folder", 1],
    ["Open with default app", 2],
  ])("offers %s on right-click and dispatches only that operation", async (label, index) => {
    const callbacks = [
      vi.fn<(path: string) => void>(),
      vi.fn<(path: string) => void>(),
      vi.fn<(path: string) => void>(),
    ];
    render(
      <InlineFolderPathChip
        path="Documents/多模态Agent实习"
        onRevealInTree={callbacks[0]}
        onShowInExplorer={callbacks[1]}
        onOpenWithSystem={callbacks[2]}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Documents/多模态Agent实习" }));
    expect(callbacks.every((callback) => callback.mock.calls.length === 0)).toBe(true);
    fireEvent.click(await screen.findByRole("menuitem", { name: String(label) }));
    await waitFor(() =>
      expect(callbacks[Number(index)]).toHaveBeenCalledWith("Documents/多模态Agent实习"),
    );
    callbacks.forEach((callback, i) => expect(callback).toHaveBeenCalledTimes(i === index ? 1 : 0));
  });

  it("keeps the left-click action picker available", async () => {
    const onRevealInTree = vi.fn<(path: string) => void>();
    render(<InlineFolderPathChip path="Documents/subfolder" onRevealInTree={onRevealInTree} />);
    fireEvent.click(screen.getByRole("button", { name: "Documents/subfolder" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open in sidebar" }));
    expect(onRevealInTree).toHaveBeenCalledWith("Documents/subfolder");
  });
});
