import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { HarnessReference } from "@/shared/crafting/workbenchTypes";
import { useUpdateStore } from "@/renderer/state/updateStore";
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
      entries={[ref("grok", "Grok Build Native Harness"), ref("kimi", "Kimi Code Native Harness")]}
      onSelect={() => undefined}
      onAdd={() => undefined}
    />,
  );
}

describe("HarnessInventory CLI update badges", () => {
  it("marks cards whose CLI has an available update", () => {
    useUpdateStore.setState({
      availableCliUpdates: [
        { key: "grok:windows:", agentKind: "grok", label: "Grok Build", version: "v1.0.13", latest: "v1.0.25" },
      ],
    });
    renderInventory();

    expect(screen.getByLabelText("Update available")).toBeInTheDocument();
    useUpdateStore.setState({ availableCliUpdates: [] });
  });

  it("shows no badge when everything is up to date", () => {
    useUpdateStore.setState({ availableCliUpdates: [] });
    renderInventory();

    expect(screen.queryByLabelText("Update available")).not.toBeInTheDocument();
  });
});
