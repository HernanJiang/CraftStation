import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { ComposerControl } from "./ThreadComposer";
import { DraftParameterMenu } from "./DraftParameterMenu";

function makeControls(): ComposerControl[] {
  return [
    {
      kind: "provider-model",
      providers: [
        {
          kind: "codex",
          label: "Codex",
          capabilities: {
            models: [
              { id: "gpt-5.6-sol", label: "ChatGPT-5.6-Sol" },
              { id: "gpt-5.6-luna", label: "ChatGPT-5.6-Luna" },
            ],
            efforts: [],
            modelEfforts: {},
            modes: ["agent"],
            approvalPolicies: [],
            sandboxModes: [],
            supportsResume: true,
            supportsDirectInput: true,
            liveInputMode: "terminal",
            presentationMode: "gui",
            settingDefs: [],
          },
        },
      ],
      currentAgentKind: "codex",
      currentModel: "gpt-5.6-sol",
      onChange: vi.fn<(next: { agentKind: string; model: string; accountId?: string }) => void>(),
    },
  ];
}

describe("DraftParameterMenu", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the model submenu immediately when its row is hovered", async () => {
    vi.useFakeTimers();
    render(<DraftParameterMenu controls={makeControls()} />);

    fireEvent.click(screen.getByRole("button", { name: /ChatGPT-5.6-Sol/ }));
    const modelRow = screen.getByRole("menuitem", { name: /模型列表/ });

    fireEvent.pointerEnter(modelRow);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(document.querySelector('[role="menu"][aria-label="模型列表"]')).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /ChatGPT-5.6-Luna/ })).toBeInTheDocument();
  });
});
