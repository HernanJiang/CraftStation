import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { HarnessReference } from "@/shared/crafting/workbenchTypes";
import { useUpdateStore } from "@/renderer/state/updateStore";
import { CRAFTING_SLOT_SIZE_CLASS } from "./CraftingSlot";
import { HarnessInventory } from "./HarnessInventory";

function ref(harnessKind: string, displayName: string): HarnessReference {
  return {
    harnessItemId: `harness:${harnessKind}`,
    harnessKind,
    descriptorId: `native-harness:${harnessKind}`,
    displayName,
    vendor: harnessKind,
    official: true,
    status: "ready",
    transport: "acp-stdio",
  };
}

function renderInventory() {
  return render(
    <HarnessInventory
      entries={[ref("grok", "Grok Build Harness"), ref("kimi", "Kimi Code Harness")]}
      onSelect={() => undefined}
      onAdd={() => undefined}
    />,
  );
}

describe("HarnessInventory update affordances", () => {
  it("shows no update badge on workbench cards even with a pending CLI update", () => {
    // Updates live on the Harness map tab — the bench is for picking.
    useUpdateStore.setState({
      availableCliUpdates: [
        {
          key: "grok:windows:",
          agentKind: "grok",
          label: "Grok Build",
          version: "v1.0.13",
          latest: "v1.0.25",
        },
      ],
    });
    renderInventory();

    expect(screen.queryByLabelText("Update available")).not.toBeInTheDocument();
    // Slots show the short name; the full display name remains in the tooltip.
    expect(screen.getByTitle("Grok Build Harness")).toBeInTheDocument();
    expect(screen.getByText("Grok Build")).toBeInTheDocument();
    useUpdateStore.setState({ availableCliUpdates: [] });
  });

  it("shows no badge when everything is up to date", () => {
    useUpdateStore.setState({ availableCliUpdates: [] });
    renderInventory();

    expect(screen.queryByLabelText("Update available")).not.toBeInTheDocument();
  });

  it("renders entries as square slots matching the crafting-grid footprint", () => {
    useUpdateStore.setState({ availableCliUpdates: [] });
    renderInventory();

    const slot = screen.getByTitle("Grok Build Harness").closest("button");
    expect(slot?.className).toContain(CRAFTING_SLOT_SIZE_CLASS);
  });
});
