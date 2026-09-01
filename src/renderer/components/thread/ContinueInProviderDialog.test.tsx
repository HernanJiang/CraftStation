import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Thread } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useSessionHandoffStore } from "@/renderer/state/sessionHandoffStore";
import { ContinueInProviderDialog } from "./ContinueInProviderDialog";

const actions = vi.hoisted(() => ({
  compileHandoffTarget: vi.fn<(...args: unknown[]) => unknown>(() => ({
    available: true,
    craftPlan: { id: "target-plan" },
  })),
  requestSessionHandoff: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  cancelSessionHandoff: vi.fn<(...args: unknown[]) => Promise<void>>(),
  readSessionHandoffState: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@/renderer/actions/sessionHandoffActions", () => actions);
vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    cancelExtractContext: vi.fn<(...args: unknown[]) => Promise<void>>(),
    extractContext: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    pickFiles: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
  }),
}));
vi.mock("./ThreadComposer", () => ({
  ThreadComposer: (props: { inputContent?: React.ReactNode; afterControls?: React.ReactNode }) => (
    <div>
      {props.inputContent}
      {props.afterControls}
    </div>
  ),
}));
vi.mock("../composer/MentionInput", () => ({
  MentionInput: () => <textarea aria-label="handoff prompt" defaultValue="Continue safely" />,
}));
vi.mock("../composer/AttachmentBar", () => ({ AttachmentBar: () => null }));
vi.mock("../composer/useAttachments", () => ({
  useAttachments: () => ({
    attachments: [],
    toSegments: () => [],
    removeAttachment: vi.fn<(...args: unknown[]) => void>(),
    addClipboardImage: vi.fn<(...args: unknown[]) => Promise<void>>(),
    addFiles: vi.fn<(...args: unknown[]) => void>(),
  }),
}));
vi.mock("./buildModelPickerControls", () => ({
  appendProviderComposerControls: () => [],
  buildModelPickerControls: () => [],
  buildProviderModelMenuProviders: () => [],
}));

const capabilities = {
  models: [{ id: "gpt-5.3-codex", label: "GPT-5.3 Codex" }],
  efforts: ["high"],
  modelEfforts: {},
  modes: ["agent"],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "server",
  presentationMode: "gui",
  presentationModes: ["gui"],
  settingDefs: [],
} as AgentStatus["capabilities"];

const agents: AgentStatus[] = [
  {
    kind: "codex",
    label: "Codex",
    installed: true,
    authState: "authenticated",
    capabilities,
  },
  {
    kind: "grok",
    label: "Grok",
    installed: true,
    authState: "authenticated",
    capabilities: {
      ...capabilities,
      models: [{ id: "grok-4.6", label: "Grok 4.6" }],
    },
  },
];

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Handoff",
    agentKind: "codex",
    config: { model: "gpt-5.3-codex" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    presentationMode: "gui",
    compositionProvenance: {
      recipeId: "recipe:openai-codex-native",
      recipeVersion: "0.1.0",
      craftedAt: "2026-08-31T00:00:00.000Z",
      ingredients: {},
    },
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

function renderDialog(sourceThread = thread()) {
  return render(
    <ContinueInProviderDialog
      isOpen
      thread={sourceThread}
      projectLocation={{ kind: "windows", path: "D:\\repo" }}
      installedAgents={agents}
      onClose={vi.fn<() => void>()}
      onContinue={vi.fn<() => void>()}
    />,
  );
}

describe("ContinueInProviderDialog in-place handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.compileHandoffTarget.mockReturnValue({
      available: true,
      craftPlan: { id: "target-plan" },
    });
    actions.readSessionHandoffState.mockResolvedValue(null);
    actions.requestSessionHandoff.mockResolvedValue({ phase: "queued" });
    actions.cancelSessionHandoff.mockResolvedValue(undefined);
    useSessionHandoffStore.setState({ statesByThread: {} });
  });

  it("shows both safe switch modes only for a local crafted GUI conversation", async () => {
    renderDialog();

    expect(
      await screen.findByRole("button", { name: "Switch in this conversation" }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: /After current turn/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Abort current turn and switch/ })).toBeVisible();
    expect(actions.readSessionHandoffState).toHaveBeenCalledWith("thread-1");
  });

  it("requests abort handoff without invoking the Fork or Move callback", async () => {
    const onContinue = vi.fn<() => void>();
    render(
      <ContinueInProviderDialog
        isOpen
        thread={thread()}
        projectLocation={{ kind: "windows", path: "D:\\repo" }}
        installedAgents={agents}
        onClose={vi.fn<() => void>()}
        onContinue={onContinue}
      />,
    );

    fireEvent.click(await screen.findByRole("radio", { name: /Abort current turn and switch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Switch in this conversation" }));

    await waitFor(() =>
      expect(actions.requestSessionHandoff).toHaveBeenCalledWith(
        expect.objectContaining({
          thread: expect.objectContaining({ id: "thread-1" }),
          targetAgentKind: "grok",
          mode: "abort-current-turn",
        }),
      ),
    );
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("restores a queued state and exposes cancellation", async () => {
    useSessionHandoffStore.setState({
      statesByThread: {
        "thread-1": {
          requestId: "switch-1",
          threadId: "thread-1",
          mode: "after-current-turn",
          phase: "queued",
          sourceSegmentId: "segment-1",
          targetBinding: {
            harnessKind: "grok",
            modelId: "grok-4.6",
            vendor: "xai",
            runtimeAdapterId: "native-harness:grok",
          },
          requestedAt: "2026-08-31T00:00:00.000Z",
          updatedAt: "2026-08-31T00:00:00.000Z",
        },
      },
    });
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel queued switch" }));
    await waitFor(() =>
      expect(actions.cancelSessionHandoff).toHaveBeenCalledWith("thread-1", "switch-1"),
    );
  });

  it("keeps in-place switching hidden for legacy terminal conversations", async () => {
    renderDialog(thread({ presentationMode: "terminal", compositionProvenance: undefined }));
    await waitFor(() => expect(actions.readSessionHandoffState).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Switch in this conversation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Fork" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Move" })).toBeVisible();
  });
});
