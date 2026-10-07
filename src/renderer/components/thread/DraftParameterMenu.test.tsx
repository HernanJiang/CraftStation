import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import type { AgentStatus } from "@/shared/contracts";
import type { ComposerControl } from "./ThreadComposer";
import { DraftParameterMenu } from "./DraftParameterMenu";

function installedStatus(kind: string, label: string): AgentStatus {
  return {
    kind,
    label,
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: [],
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
  };
}

function makeEffortControl(overrides?: {
  efforts?: Array<{ id: string; label: string }>;
  effortValue?: string;
  contextValue?: string;
}): ComposerControl {
  const efforts = overrides?.efforts ?? [
    { id: "high", label: "High" },
    { id: "max", label: "Max" },
  ];
  return {
    kind: "effort-context",
    efforts,
    effortValue: overrides?.effortValue ?? "max",
    contextSizes: [{ id: "1M", label: "1M" }],
    contextValue: overrides?.contextValue ?? "1M",
    onEffortChange: vi.fn<(value: string) => void>(),
    onContextChange: vi.fn<(value: string) => void>(),
  };
}

function makeModelControl(overrides?: {
  kind?: string;
  label?: string;
  models?: Array<{ id: string; label: string }>;
  accountId?: string;
}): ComposerControl {
  const kind = overrides?.kind ?? "codex";
  const models = overrides?.models ?? [
    { id: "gpt-5.6-sol", label: "ChatGPT-5.6-Sol" },
    { id: "gpt-5.6-luna", label: "ChatGPT-5.6-Luna" },
  ];
  return {
    kind: "provider-model",
    providers: [
      {
        kind,
        label: overrides?.label ?? "Codex",
        ...(overrides?.accountId ? { accountId: overrides.accountId } : {}),
        capabilities: {
          models,
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
    currentAgentKind: kind,
    currentModel: models[0]?.id ?? "",
    ...(overrides?.accountId ? { currentAccountId: overrides.accountId } : {}),
    onChange: vi.fn<(next: { agentKind: string; model: string; accountId?: string }) => void>(),
  };
}

function makeFastControl(overrides?: {
  isSelected?: boolean;
  disabledReason?: string;
}): ComposerControl {
  return {
    kind: "toggle",
    label: "Fast",
    iconKind: "fast",
    isSelected: overrides?.isSelected ?? false,
    ...(overrides?.disabledReason ? { disabledReason: overrides.disabledReason } : {}),
    onChange: vi.fn<(selected: boolean) => void>(),
  };
}

function makeControls(): ComposerControl[] {
  return [makeModelControl()];
}

describe("DraftParameterMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    useCraftingWorkbenchStore.setState({
      capabilityMode: "auto",
      recipes: [],
      pendingRecipeIntent: undefined,
    });
    useAgentStatusesStore.setState({ agentStatuses: [], wslAgentStatuses: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    useAgentStatusesStore.setState({ agentStatuses: [], wslAgentStatuses: [] });
  });

  it("opens the model submenu immediately when its row is hovered", async () => {
    vi.useFakeTimers();
    render(<DraftParameterMenu controls={makeControls()} />);

    fireEvent.click(screen.getByRole("button", { name: /ChatGPT-5.6-Sol/ }));
    const modelRow = screen.getByRole("menuitem", { name: /Model list/ });

    fireEvent.pointerEnter(modelRow);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(document.querySelector('[role="menu"][aria-label="Model list"]')).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /ChatGPT-5.6-Luna/ })).toBeInTheDocument();
    expect(document.querySelector(".craftstation-composer-menu-surface")).toBeInTheDocument();
  });

  it("shows Harness + Model identities in Auto Mode with a Native route tooltip", () => {
    render(<DraftParameterMenu controls={makeControls()} />);

    expect(screen.getByTestId("auto-harness-name")).toHaveTextContent("Codex");
    const identity = screen.getByTestId("auto-harness-model");
    expect(identity.getAttribute("title")).toContain("Harness: Codex");
    expect(identity.getAttribute("title")).toContain("Family: OpenAI");
  });

  it("keeps an openai-compatible GLM pick on the catalog row with the channel account", async () => {
    vi.useFakeTimers();
    const control = makeModelControl({
      kind: "codex",
      label: "Cavoti",
      accountId: "openai-compatible:cavoti",
      models: [
        { id: "glm-5.3-flash-C", label: "glm-5.3-flash-C" },
        { id: "glm-5.3-flash-A", label: "glm-5.3-flash-A" },
      ],
    });
    render(<DraftParameterMenu controls={[control]} />);

    fireEvent.click(screen.getByRole("button", { name: /glm-5.3-flash-C/ }));
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: /Model list/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /glm-5.3-flash-A/ }));

    expect(control.kind === "provider-model" ? control.onChange : undefined).toHaveBeenCalledWith({
      agentKind: "codex",
      model: "glm-5.3-flash-A",
      accountId: "openai-compatible:cavoti",
    });
  });

  it("names OpenCode as the live Harness for an OpenCode Muse Spark pick", () => {
    useAgentStatusesStore.setState({
      agentStatuses: [installedStatus("opencode", "OpenCode"), installedStatus("muse", "Muse")],
    });
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl({
            kind: "opencode",
            label: "OpenCode",
            models: [
              {
                id: "opencode-go/muse-spark-1.3-contributor",
                label: "Muse Spark 1.3 Contributor",
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("auto-harness-name")).toHaveTextContent("OpenCode");
    const identity = screen.getByTestId("auto-harness-model");
    expect(identity.getAttribute("title")).toContain("Harness: OpenCode");
    expect(identity.getAttribute("title")).toContain("Family: Muse");
  });

  it("still names OpenCode as the live Harness when WSL Muse is installed", () => {
    useAgentStatusesStore.setState({
      agentStatuses: [installedStatus("opencode", "OpenCode")],
      wslAgentStatuses: [installedStatus("muse", "Muse")],
    });
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl({
            kind: "opencode",
            label: "OpenCode",
            models: [
              {
                id: "opencode-go/muse-spark-1.3-contributor",
                label: "Muse Spark 1.3 Contributor",
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("auto-harness-name")).toHaveTextContent("OpenCode");
    expect(screen.getByTestId("auto-harness-model").getAttribute("title")).toContain(
      "Harness: OpenCode",
    );
  });

  it("names Muse for an explicitly selected Muse Code Recipe", () => {
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl({
            kind: "muse",
            label: "Muse",
            models: [
              {
                id: "opencode-go/muse-spark-1.3-contributor",
                label: "Muse Spark 1.3 Contributor",
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("auto-harness-name")).toHaveTextContent("Muse");
    expect(screen.getByTestId("auto-harness-model").getAttribute("title")).toContain(
      "Harness: Muse",
    );
  });

  it("submits an OpenCode Go Muse Spark pick through OpenCode when WSL Muse is installed", async () => {
    vi.useFakeTimers();
    useAgentStatusesStore.setState({
      agentStatuses: [installedStatus("opencode", "OpenCode")],
      wslAgentStatuses: [installedStatus("muse", "Muse")],
    });
    const control = makeModelControl({
      kind: "opencode",
      label: "OpenCode",
      models: [
        { id: "opencode-go/glm-5.3-flash", label: "GLM 5.3 Flash" },
        {
          id: "opencode-go/muse-spark-1.3-contributor",
          label: "Muse Spark 1.3 Contributor",
        },
      ],
    });
    render(<DraftParameterMenu controls={[control]} />);

    fireEvent.click(screen.getByRole("button", { name: /GLM 5.3 Flash/ }));
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: /Model list/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /Muse Spark 1.3 Contributor/ }));

    expect(control.kind === "provider-model" ? control.onChange : undefined).toHaveBeenCalledWith({
      agentKind: "opencode",
      model: "opencode-go/muse-spark-1.3-contributor",
    });
  });

  it("keeps an OpenCode Go Muse Spark pick on the OpenCode catalog row", async () => {
    vi.useFakeTimers();
    useAgentStatusesStore.setState({
      agentStatuses: [installedStatus("opencode", "OpenCode"), installedStatus("muse", "Muse")],
    });
    const control = makeModelControl({
      kind: "opencode",
      label: "OpenCode",
      models: [
        { id: "opencode-go/glm-5.3-flash", label: "GLM 5.3 Flash" },
        {
          id: "opencode-go/muse-spark-1.3-contributor",
          label: "Muse Spark 1.3 Contributor",
        },
      ],
    });
    render(<DraftParameterMenu controls={[control]} />);

    fireEvent.click(screen.getByRole("button", { name: /GLM 5.3 Flash/ }));
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: /Model list/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /Muse Spark 1.3 Contributor/ }));

    expect(control.kind === "provider-model" ? control.onChange : undefined).toHaveBeenCalledWith({
      agentKind: "opencode",
      model: "opencode-go/muse-spark-1.3-contributor",
    });
  });

  it("keeps a Command Code DeepSeek pick on the Command Code catalog row", async () => {
    vi.useFakeTimers();
    useAgentStatusesStore.setState({
      agentStatuses: [
        installedStatus("commandcode", "Command Code"),
        installedStatus("deepseek", "DeepSeek Harness"),
      ],
    });
    const control = makeModelControl({
      kind: "commandcode",
      label: "Command Code",
      models: [
        { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
        { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
      ],
    });
    render(<DraftParameterMenu controls={[control]} />);

    fireEvent.click(screen.getByRole("button", { name: /Gemini 3.1 Flash Lite/ }));
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: /Model list/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /DeepSeek V4.1 Flash/ }));

    expect(control.kind === "provider-model" ? control.onChange : undefined).toHaveBeenCalledWith({
      agentKind: "commandcode",
      model: "deepseek/deepseek-v4.1-flash",
    });
  });

  it("names DeepSeek Harness as the live Harness for a Command Code DeepSeek pick", () => {
    useAgentStatusesStore.setState({
      agentStatuses: [
        installedStatus("commandcode", "Command Code"),
        installedStatus("deepseek", "DeepSeek Harness"),
      ],
    });
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl({
            kind: "commandcode",
            label: "Command Code",
            models: [{ id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" }],
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("auto-harness-name")).toHaveTextContent("DeepSeek Harness");
    const identity = screen.getByTestId("auto-harness-model");
    expect(identity.getAttribute("title")).toContain("Harness: DeepSeek Harness");
    expect(identity.getAttribute("title")).toContain("Family: DeepSeek");
  });

  it("shows the Harness prefix in every mode, never gated", () => {
    useCraftingWorkbenchStore.setState({ capabilityMode: "efficient" });
    render(<DraftParameterMenu controls={makeControls()} />);

    expect(screen.getByTestId("auto-harness-name")).toHaveTextContent("Codex");
    expect(screen.getByTestId("auto-harness-model")).toHaveTextContent(/ChatGPT-5.6-Sol/);
  });

  it("shows the full model name, thinking intensity, and context on the trigger", () => {
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl({
            kind: "deepseek",
            label: "DeepSeek Harness",
            models: [{ id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" }],
          }),
          makeEffortControl(),
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /DeepSeek V4.1 Flash/ });
    expect(trigger).toHaveTextContent("DeepSeek Harness");
    expect(trigger).toHaveTextContent("DeepSeek V4.1 Flash");
    expect(trigger).toHaveTextContent("Max");
    expect(trigger).not.toHaveTextContent("1M");
    expect(trigger.className).not.toMatch(/max-w-\[280px\]/);
    expect(screen.getByTestId("auto-harness-model").className).not.toMatch(/truncate/);
  });

  it("opens model and effort submenus with full labels instead of truncated chips", async () => {
    vi.useFakeTimers();
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl({
            kind: "deepseek",
            label: "DeepSeek Harness",
            models: [
              { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
              { id: "deepseek-v4.1-pro", label: "DeepSeek V4.1 Pro" },
            ],
          }),
          makeEffortControl(),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /DeepSeek V4.1 Flash/ }));
    const modelRow = screen.getByRole("menuitem", { name: /Model list/ });
    expect(modelRow).toHaveTextContent("DeepSeek V4.1 Flash");
    expect(modelRow.querySelector(".truncate")).toBeNull();

    fireEvent.pointerEnter(modelRow);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("menuitem", { name: /DeepSeek V4.1 Pro/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Reasoning effort/ })).toHaveTextContent("Max");
  });

  it("names Command Code as Command Code even when the model is a DeepSeek id", () => {
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl({
            kind: "commandcode",
            label: "Command Code",
            models: [{ id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" }],
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("auto-harness-name")).toHaveTextContent("Command Code");
    expect(screen.getByTestId("auto-harness-name")).not.toHaveTextContent("DeepSeek Harness");
    expect(screen.getByTestId("auto-harness-model")).toHaveTextContent("DeepSeek V4.1 Flash");
  });

  it("names a native Harness after its CLI product, not the model family", () => {
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl({
            kind: "kimi",
            label: "Kimi Code",
            models: [{ id: "k3-256k", label: "K3-256k" }],
          }),
        ]}
      />,
    );

    // "Kimi Code · K3-256k", never the unreadable "Kimi · K3-256k".
    expect(screen.getByTestId("auto-harness-name")).toHaveTextContent("Kimi Code");
    const identity = screen.getByTestId("auto-harness-model");
    expect(identity.getAttribute("title")).toContain("Harness: Kimi Code");
  });

  it("names DeepSeek Harness after a Command Code DeepSeek pick has remapped", () => {
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl({
            kind: "deepseek",
            label: "DeepSeek Harness",
            models: [{ id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" }],
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("auto-harness-name")).toHaveTextContent("DeepSeek Harness");
    expect(screen.getByTestId("auto-harness-model")).toHaveTextContent("DeepSeek V4.1 Flash");
  });

  it("keeps an Antigravity Gemini card composed with OpenCode on OpenCode", async () => {
    vi.useFakeTimers();
    useCraftingWorkbenchStore.setState({
      recipes: [
        {
          id: "recipe:harness:opencode:agent:antigravity:gui:gemini-3.8-flash",
          version: "1.0.0",
          systemName: "OpenCode Harness · Gemini 3.8 Flash",
          modelEntryRef: "agent:antigravity:gui:gemini-3.8-flash",
          harnessRef: "harness:opencode",
          homepageVisible: true,
          compatibility: { uiStatus: "NATIVE" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastKnownModel: {
            displayName: "Gemini 3.8 Flash",
            modelId: "gemini-3.8-flash",
            providerLabel: "Antigravity",
          },
          lastKnownHarness: {
            displayName: "OpenCode Harness",
            harnessKind: "opencode",
          },
        },
      ],
    });
    const onChange =
      vi.fn<
        (value: {
          agentKind: string;
          model: string;
          accountId?: string;
          presentationMode?: "gui" | "terminal";
        }) => void
      >();
    const antigravity = makeModelControl({
      kind: "antigravity",
      label: "Antigravity",
      models: [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }],
    });
    const opencode = makeModelControl({
      kind: "opencode",
      label: "OpenCode",
      models: [
        { id: "opencode-go/muse-spark-1.3-contributor", label: "Muse Spark 1.3 Contributor" },
      ],
    });
    if (antigravity.kind !== "provider-model" || opencode.kind !== "provider-model") {
      throw new Error("expected provider-model controls");
    }
    const merged: ComposerControl = {
      ...opencode,
      onChange,
      providers: [...antigravity.providers, ...opencode.providers],
    };
    render(<DraftParameterMenu controls={[merged]} />);
    fireEvent.click(screen.getByRole("button", { name: /Muse Spark 1.3 Contributor/ }));
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: /Model list/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /OpenCode Harness · Gemini 3.8 Flash/ }));
    expect(onChange).toHaveBeenCalledWith({
      agentKind: "opencode",
      model: "gemini-3.8-flash",
    });
  });

  it("applies a homepage recipe as its Harness · Model composition", async () => {
    vi.useFakeTimers();
    useCraftingWorkbenchStore.setState({
      recipes: [
        {
          id: "recipe:harness:opencode:agent:opencode:gui:gemini-3.8-flash",
          version: "1.0.0",
          systemName: "OpenCode Harness · Gemini 3.8 Flash",
          modelEntryRef: "agent:opencode:gui:gemini-3.8-flash",
          harnessRef: "harness:opencode",
          homepageVisible: true,
          compatibility: { uiStatus: "CRAFTABLE" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastKnownModel: {
            displayName: "Gemini 3.8 Flash",
            modelId: "gemini-3.8-flash",
            providerLabel: "OpenCode",
          },
          lastKnownHarness: {
            displayName: "OpenCode Harness",
            harnessKind: "opencode",
          },
        },
      ],
    });
    const control = makeModelControl({
      kind: "opencode",
      label: "OpenCode",
      models: [
        {
          id: "opencode-go/muse-spark-1.3-contributor",
          label: "Muse Spark 1.3 Contributor",
        },
      ],
    });
    render(<DraftParameterMenu controls={[control]} />);

    fireEvent.click(screen.getByRole("button", { name: /Muse Spark 1.3 Contributor/ }));
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: /Model list/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /OpenCode Harness · Gemini 3.8 Flash/ }));

    expect(control.kind === "provider-model" ? control.onChange : undefined).toHaveBeenCalledWith({
      agentKind: "opencode",
      model: "gemini-3.8-flash",
    });
    expect(useCraftingWorkbenchStore.getState().pendingRecipeIntent).toEqual({
      recipeId: "recipe:harness:opencode:agent:opencode:gui:gemini-3.8-flash",
    });
  });

  it("shows a pending OpenCode + Gemini recipe as Harness logo+name and model logo+name", () => {
    useCraftingWorkbenchStore.setState({
      recipes: [
        {
          id: "recipe:harness:opencode:agent:antigravity:gui:gemini-3.8-flash",
          version: "1.0.0",
          systemName: "OpenCode Harness · Gemini 3.8 Flash",
          modelEntryRef: "agent:antigravity:gui:gemini-3.8-flash",
          harnessRef: "harness:opencode",
          homepageVisible: true,
          compatibility: { uiStatus: "NATIVE" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastKnownModel: {
            displayName: "Gemini 3.8 Flash",
            modelId: "gemini-3.8-flash",
            providerLabel: "Antigravity",
          },
          lastKnownHarness: {
            displayName: "OpenCode Harness",
            harnessKind: "opencode",
          },
        },
      ],
      pendingRecipeIntent: {
        recipeId: "recipe:harness:opencode:agent:antigravity:gui:gemini-3.8-flash",
      },
    });
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl({
            kind: "antigravity",
            label: "Antigravity",
            models: [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }],
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("auto-harness-name")).toHaveTextContent("OpenCode Harness");
    expect(screen.getByTestId("auto-harness-name")).not.toHaveTextContent("Antigravity");
    expect(screen.getByTestId("auto-model-name")).toHaveTextContent("Gemini 3.8 Flash");
    expect(screen.getByTestId("auto-harness-model").getAttribute("title")).toContain(
      "Harness: OpenCode Harness",
    );
  });

  it("renders the Fast toggle as a Fast mode switch row that flips on press", () => {
    const fast = makeFastControl();
    render(<DraftParameterMenu controls={[makeModelControl(), fast]} />);

    fireEvent.click(screen.getByRole("button", { name: /ChatGPT-5.6-Sol/ }));
    const row = screen.getByRole("menuitem", { name: "Fast mode" });
    fireEvent.click(row);

    expect(fast.kind === "toggle" ? fast.onChange : undefined).toHaveBeenCalledWith(true);
  });

  it("appends · Fast to the capsule label while fast mode is on", () => {
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl(),
          makeEffortControl({ effortValue: "max" }),
          makeFastControl({ isSelected: true }),
        ]}
      />,
    );

    expect(screen.getByTestId("auto-model-name")).toHaveTextContent("ChatGPT-5.6-Sol · Max · Fast");
  });

  it("renders the gated Fast row inert with its reason instead of a switch", () => {
    const fast = makeFastControl({ disabledReason: "该账号不支持快速模式" });
    render(<DraftParameterMenu controls={[makeModelControl(), fast]} />);

    fireEvent.click(screen.getByRole("button", { name: /ChatGPT-5.6-Sol/ }));
    const row = screen.getByRole("menuitem", { name: /Fast mode/ });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveTextContent("该账号不支持快速模式");
    fireEvent.click(row);

    expect(fast.kind === "toggle" ? fast.onChange : undefined).not.toHaveBeenCalled();
  });

  it("offers a tier submenu when the model advertises multiple speed tiers", async () => {
    vi.useFakeTimers();
    const onSpeedTierChange = vi.fn<(tierId: string | undefined) => void>();
    const fast: ComposerControl = {
      kind: "toggle",
      label: "Fast",
      iconKind: "fast",
      isSelected: true,
      speedTiers: [
        { id: "priority", label: "Fast" },
        { id: "ultrafast", label: "Ultrafast" },
      ],
      speedTierValue: "ultrafast",
      onChange: vi.fn<(selected: boolean) => void>(),
      onSpeedTierChange,
    };
    render(<DraftParameterMenu controls={[makeModelControl(), fast]} />);

    fireEvent.click(screen.getByRole("button", { name: /ChatGPT-5.6-Sol/ }));
    const row = screen.getByRole("menuitem", { name: /Fast mode/ });
    expect(row).toHaveTextContent("Ultrafast");

    fireEvent.click(row);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Fast" }));
    expect(onSpeedTierChange).toHaveBeenCalledWith("priority");

    // Picking a tier closes the whole menu; reopen to exercise the off row.
    fireEvent.click(screen.getByRole("button", { name: /ChatGPT-5.6-Sol/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Fast mode/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Standard" }));
    expect(onSpeedTierChange).toHaveBeenCalledWith(undefined);
  });

  it("shows the selected tier label on the capsule instead of a plain · Fast", () => {
    render(
      <DraftParameterMenu
        controls={[
          makeModelControl(),
          makeEffortControl({ effortValue: "max" }),
          {
            kind: "toggle",
            label: "Fast",
            iconKind: "fast",
            isSelected: true,
            speedTiers: [
              { id: "priority", label: "Fast" },
              { id: "ultrafast", label: "Ultrafast" },
            ],
            speedTierValue: "ultrafast",
            onChange: vi.fn<(selected: boolean) => void>(),
          },
        ]}
      />,
    );

    expect(screen.getByTestId("auto-model-name")).toHaveTextContent(
      "ChatGPT-5.6-Sol · Max · Ultrafast",
    );
  });
});
