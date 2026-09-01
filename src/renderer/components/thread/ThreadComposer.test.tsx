import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ThreadComposer, type ComposerControl } from "./ThreadComposer";

const originalResizeObserver = globalThis.ResizeObserver;

class MockResizeObserver {
  static instances = new Set<MockResizeObserver>();

  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    MockResizeObserver.instances.add(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {
    MockResizeObserver.instances.delete(this);
  }

  static notify(element: Element) {
    for (const instance of MockResizeObserver.instances) {
      instance.#callback([{ target: element } as ResizeObserverEntry], instance as ResizeObserver);
    }
  }

  static reset() {
    MockResizeObserver.instances.clear();
  }
}

function composerControls(): ComposerControl[] {
  return [
    {
      value: "auto",
      options: [{ id: "auto", label: "Auto" }],
      hideLabelOnWrap: true,
    },
    {
      kind: "toggle",
      label: "Plan",
      isSelected: false,
      hideLabelOnWrap: true,
      onChange: vi.fn<(selected: boolean) => void>(),
    },
  ];
}

function renderComposer(controls = composerControls()) {
  return render(
    <ThreadComposer
      controls={controls}
      placeholder="Send a message..."
      prompt=""
      submitDisabled
      submitLabel="Send message"
      onPromptChange={vi.fn<(value: string) => void>()}
      onSubmit={vi.fn<() => void>()}
    />,
  );
}

function renderComposerWithAttach(onAttachFiles: (paths: string[]) => void) {
  return render(
    <ThreadComposer
      controls={composerControls()}
      placeholder="Send a message..."
      prompt=""
      submitDisabled
      submitLabel="Send message"
      onAttachFiles={onAttachFiles}
      onPromptChange={vi.fn<(value: string) => void>()}
      onSubmit={vi.fn<() => void>()}
    />,
  );
}

function visibleText(text: string): HTMLElement {
  const matches = screen.getAllByText(text);
  const visible = matches.find((element) => !element.closest('[aria-hidden="true"]'));
  expect(visible).toBeDefined();
  return visible!;
}

function setProbeMeasurements(
  container: HTMLElement,
  widths: readonly number[],
  clientWidth = 100,
) {
  const probes = [...container.querySelectorAll<HTMLElement>(".probe-wrap-container")];
  for (const [index, probe] of probes.entries()) {
    Object.defineProperties(probe, {
      clientWidth: { configurable: true, get: () => clientWidth },
      scrollWidth: { configurable: true, get: () => widths[index] ?? 100 },
    });
  }
}

function composerToolbar(container: HTMLElement): HTMLElement {
  const toolbar = container.querySelector<HTMLElement>(".craftstation-composer-toolbar");
  expect(toolbar).not.toBeNull();
  return toolbar!;
}

function setToolbarWidth(container: HTMLElement, width: number) {
  Object.defineProperty(composerToolbar(container), "clientWidth", {
    configurable: true,
    get: () => width,
  });
}

describe("ThreadComposer", () => {
  beforeEach(() => {
    MockResizeObserver.reset();
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("does not hide labels just because they are eligible to hide on wrap", () => {
    renderComposer();

    expect(visibleText("Auto")).toBeVisible();
    expect(visibleText("Plan")).toBeVisible();
  });

  it("hides eligible labels when resize measurement requires a collapsed level", () => {
    const { container } = renderComposer();
    const controls = container.querySelector<HTMLElement>(
      ".craftstation-composer-toolbar > .relative",
    );
    expect(controls).not.toBeNull();

    setProbeMeasurements(container, [160, 100, 100, 100, 100, 100]);

    act(() => {
      MockResizeObserver.notify(controls!);
    });

    expect(composerToolbar(container)).toHaveAttribute("data-wrap-level", "1");
    expect(visibleText("Auto")).toHaveAttribute("data-collapse-tier", "1");
    expect(visibleText("Plan")).toHaveAttribute("data-collapse-tier", "1");
  });

  it("does not expand collapsed labels again at the same measured width", () => {
    const { container } = renderComposer();
    const controls = container.querySelector<HTMLElement>(
      ".craftstation-composer-toolbar > .relative",
    );
    expect(controls).not.toBeNull();

    setProbeMeasurements(container, [101, 100, 100, 100, 100, 100]);

    act(() => {
      MockResizeObserver.notify(controls!);
    });

    expect(composerToolbar(container)).toHaveAttribute("data-wrap-level", "1");

    setProbeMeasurements(container, [100, 100, 100, 100, 100, 100]);

    act(() => {
      MockResizeObserver.notify(controls!);
    });

    expect(composerToolbar(container)).toHaveAttribute("data-wrap-level", "1");

    setProbeMeasurements(container, [101, 100, 100, 100, 100, 100], 101);

    act(() => {
      MockResizeObserver.notify(controls!);
    });

    expect(composerToolbar(container)).toHaveAttribute("data-wrap-level", "0");
  });

  it("does not expand labels while the outer toolbar width is decreasing", () => {
    const { container } = renderComposer();
    const controls = container.querySelector<HTMLElement>(
      ".craftstation-composer-toolbar > .relative",
    );
    expect(controls).not.toBeNull();

    setToolbarWidth(container, 200);
    setProbeMeasurements(container, [100, 100, 100, 100, 100, 100]);

    act(() => {
      MockResizeObserver.notify(controls!);
    });

    expect(composerToolbar(container)).toHaveAttribute("data-wrap-level", "0");

    setToolbarWidth(container, 120);
    setProbeMeasurements(container, [121, 100, 100, 100, 100, 100]);

    act(() => {
      MockResizeObserver.notify(controls!);
    });

    expect(composerToolbar(container)).toHaveAttribute("data-wrap-level", "1");
    expect(composerToolbar(container)).toHaveAttribute("data-width-decreasing");

    setProbeMeasurements(container, [110, 100, 100, 100, 100, 100], 130);

    act(() => {
      MockResizeObserver.notify(controls!);
    });

    expect(composerToolbar(container)).toHaveAttribute("data-wrap-level", "1");

    setToolbarWidth(container, 121);

    act(() => {
      MockResizeObserver.notify(controls!);
    });

    expect(composerToolbar(container)).toHaveAttribute("data-wrap-level", "0");
    expect(composerToolbar(container)).not.toHaveAttribute("data-width-decreasing");
  });

  it("can collapse permission labels before mode labels", () => {
    const { container } = renderComposer([
      {
        value: "full-access",
        options: [{ id: "full-access", label: "Full access" }],
        iconKind: "permission",
        hideLabelOnWrap: true,
        tier: 2,
      },
      {
        kind: "toggle",
        label: "Work",
        isSelected: false,
        hideLabelOnWrap: true,
        tier: 3,
        onChange: vi.fn<(selected: boolean) => void>(),
      },
    ]);
    const controls = container.querySelector<HTMLElement>(
      ".craftstation-composer-toolbar > .relative",
    );
    expect(controls).not.toBeNull();

    setProbeMeasurements(container, [160, 160, 100, 100, 100, 100]);

    act(() => {
      MockResizeObserver.notify(controls!);
    });

    expect(composerToolbar(container)).toHaveAttribute("data-wrap-level", "2");
    expect(visibleText("Full access")).toHaveAttribute("data-collapse-tier", "2");
    expect(visibleText("Work")).toHaveAttribute("data-collapse-tier", "3");
  });

  it("labels a thinking-only effort context control", () => {
    renderComposer([
      {
        kind: "effort-context",
        efforts: [],
        contextSizes: [],
        thinkingSupported: true,
        thinkingValue: false,
        onThinkingChange: vi.fn<(selected: boolean) => void>(),
        hideLabelOnWrap: true,
      },
    ]);

    expect(visibleText("Thinking")).toBeVisible();
  });

  it("renders the compact permission and model controls without a Chat or CLI switch", () => {
    const onPermissionChange = vi.fn<(selected: boolean) => void>();
    const onModelChange =
      vi.fn<
        (next: { agentKind: string; model: string; presentationMode?: "terminal" | "gui" }) => void
      >();

    render(
      <ThreadComposer
        controlsDisplay="menu"
        controls={[
          {
            kind: "toggle",
            label: "Supervised",
            iconKind: "permission",
            isSelected: false,
            onChange: onPermissionChange,
          },
          {
            kind: "provider-model",
            providers: [
              {
                kind: "codex",
                label: "OpenAI",
                presentationMode: "gui",
                capabilities: {
                  models: [{ id: "gpt-5.6-sol", label: "5.6 Sol" }],
                  efforts: ["medium"],
                  modelEfforts: {},
                  modes: ["agent"],
                  approvalPolicies: [],
                  sandboxModes: [],
                  supportsResume: true,
                  supportsDirectInput: true,
                  liveInputMode: "server",
                  presentationMode: "terminal",
                  settingDefs: [],
                },
              },
            ],
            currentAgentKind: "codex",
            currentModel: "gpt-5.6-sol",
            presentationMode: "gui",
            onChange: onModelChange,
          },
          {
            kind: "effort-context",
            efforts: [{ id: "medium", label: "Medium" }],
            effortValue: "medium",
            contextSizes: [{ id: "272k", label: "272K" }],
            contextValue: "272k",
          },
        ]}
        placeholder="Send a message..."
        prompt=""
        submitDisabled
        submitLabel="Send message"
        onPromptChange={vi.fn<(value: string) => void>()}
        onSubmit={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByRole("button", { name: "切换执行模式与权限" })).toHaveTextContent(
      "请求批准",
    );
    expect(visibleText("5.6 Sol · Medium")).toBeVisible();
    expect(screen.queryByText("Chat")).not.toBeInTheDocument();
    expect(screen.queryByText("CLI")).not.toBeInTheDocument();

    expect(onPermissionChange).not.toHaveBeenCalled();
  });

  it("keeps add and access controls on the left and the only quota ring before the model", () => {
    const { container } = render(
      <ThreadComposer
        controlsDisplay="menu"
        controls={[
          {
            kind: "toggle",
            label: "Plan",
            iconKind: "mode",
            isSelected: false,
            onChange: vi.fn<(selected: boolean) => void>(),
          },
          {
            kind: "toggle",
            label: "Supervised",
            iconKind: "permission",
            isSelected: false,
            onChange: vi.fn<(selected: boolean) => void>(),
          },
          {
            kind: "provider-model",
            providers: [
              {
                kind: "codex",
                label: "OpenAI",
                presentationMode: "gui",
                capabilities: {
                  models: [{ id: "gpt-5.6-sol", label: "5.6 Sol" }],
                  efforts: [],
                  modelEfforts: {},
                  modes: [],
                  approvalPolicies: [],
                  sandboxModes: [],
                  supportsResume: true,
                  supportsDirectInput: true,
                  liveInputMode: "server",
                  presentationMode: "gui",
                  settingDefs: [],
                },
              },
            ],
            currentAgentKind: "codex",
            currentModel: "gpt-5.6-sol",
            presentationMode: "gui",
            onChange:
              vi.fn<
                (next: {
                  agentKind: string;
                  model: string;
                  presentationMode?: "terminal" | "gui";
                  accountId?: string;
                }) => void
              >(),
          },
        ]}
        leadingControls={
          <button type="button" aria-label="添加数据和文件">
            +
          </button>
        }
        beforeEndControls={
          <button type="button" aria-label="上下文与额度详情" data-testid="context-quota-ring" />
        }
        placeholder="Send a message..."
        prompt=""
        submitDisabled
        submitLabel="Send message"
        onPromptChange={vi.fn<(value: string) => void>()}
        onSubmit={vi.fn<() => void>()}
      />,
    );

    const toolbar = composerToolbar(container);
    const add = screen.getByRole("button", { name: "添加数据和文件" });
    const access = screen.getByRole("button", { name: "切换执行模式与权限" });
    const ring = screen.getByRole("button", { name: "上下文与额度详情" });
    const model = screen.getByRole("button", { name: /5.6 Sol/ });

    expect(toolbar.querySelectorAll('[data-testid="context-quota-ring"]')).toHaveLength(1);
    expect(add.compareDocumentPosition(access) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(access.compareDocumentPosition(ring) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ring.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("switches to another enabled model from the parameter submenu", async () => {
    const onModelChange =
      vi.fn<
        (next: { agentKind: string; model: string; presentationMode?: "terminal" | "gui" }) => void
      >();

    render(
      <ThreadComposer
        controlsDisplay="menu"
        controls={[
          {
            kind: "provider-model",
            providers: [
              {
                kind: "codex",
                label: "OpenAI",
                presentationMode: "gui",
                capabilities: {
                  models: [
                    { id: "gpt-current", label: "Current Model" },
                    { id: "gpt-enabled", label: "Enabled Model" },
                  ],
                  efforts: [],
                  modelEfforts: {},
                  modes: [],
                  approvalPolicies: [],
                  sandboxModes: [],
                  supportsResume: true,
                  supportsDirectInput: true,
                  liveInputMode: "server",
                  presentationMode: "gui",
                  settingDefs: [],
                },
              },
            ],
            currentAgentKind: "codex",
            currentModel: "gpt-current",
            presentationMode: "gui",
            onChange: onModelChange,
          },
        ]}
        placeholder="Send a message..."
        prompt=""
        submitDisabled
        submitLabel="Send message"
        onPromptChange={vi.fn<(value: string) => void>()}
        onSubmit={vi.fn<() => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Current Model/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /模型列表/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Enabled Model/ }));

    expect(onModelChange).toHaveBeenCalledWith({
      agentKind: "codex",
      model: "gpt-enabled",
      presentationMode: "gui",
    });
  });

  it("does not show a reset-to-default action in the parameter menu", async () => {
    render(
      <ThreadComposer
        controlsDisplay="menu"
        controls={[
          {
            kind: "provider-model",
            providers: [
              {
                kind: "codex",
                label: "OpenAI",
                capabilities: {
                  models: [{ id: "gpt-current", label: "Current Model" }],
                  efforts: [],
                  modelEfforts: {},
                  modes: [],
                  approvalPolicies: [],
                  sandboxModes: [],
                  supportsResume: true,
                  supportsDirectInput: true,
                  liveInputMode: "server",
                  presentationMode: "gui",
                  settingDefs: [],
                },
              },
            ],
            currentAgentKind: "codex",
            currentModel: "gpt-current",
            presentationMode: "gui",
            onChange:
              vi.fn<
                (next: {
                  agentKind: string;
                  model: string;
                  presentationMode?: "terminal" | "gui";
                }) => void
              >(),
          },
        ]}
        placeholder="Send a message..."
        prompt=""
        submitDisabled
        submitLabel="Send message"
        onPromptChange={vi.fn<(value: string) => void>()}
        onSubmit={vi.fn<() => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Current Model/ }));

    expect(screen.queryByRole("menuitem", { name: "重置为默认设置" })).not.toBeInTheDocument();
  });

  it("uses the execution-mode dropdown as an action menu", async () => {
    const onModeChange = vi.fn<(selected: boolean) => void>();
    const onPermissionChange = vi.fn<(selected: boolean) => void>();

    render(
      <ThreadComposer
        controlsDisplay="menu"
        controls={[
          {
            kind: "toggle",
            label: "Plan",
            iconKind: "mode",
            isSelected: true,
            onChange: onModeChange,
          },
          {
            kind: "toggle",
            label: "Supervised",
            iconKind: "permission",
            isSelected: false,
            onChange: onPermissionChange,
          },
        ]}
        placeholder="Send a message..."
        prompt=""
        submitDisabled
        submitLabel="Send message"
        onPromptChange={vi.fn<(value: string) => void>()}
        onSubmit={vi.fn<() => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "切换执行模式与权限" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /完全访问权限/ }));

    expect(onModeChange).toHaveBeenCalledWith(false);
    expect(onPermissionChange).toHaveBeenCalledWith(true);
  });

  it("shows an attachment drop target for supported files", () => {
    const { container } = renderComposerWithAttach(vi.fn());
    const shell = container.querySelector<HTMLElement>(".craftstation-composer-shell");
    expect(shell).not.toBeNull();

    fireEvent.dragEnter(shell!, {
      dataTransfer: { types: ["Files"], files: [], dropEffect: "copy" },
    });

    expect(screen.getByText("Drop here to attach")).toBeVisible();
  });

  it("attaches files dragged from the project tree", () => {
    const onAttachFiles = vi.fn<(paths: string[]) => void>();
    const { container } = renderComposerWithAttach(onAttachFiles);
    const shell = container.querySelector<HTMLElement>(".craftstation-composer-shell");
    expect(shell).not.toBeNull();

    fireEvent.drop(shell!, {
      dataTransfer: {
        types: ["application/craftstation-composer-file"],
        files: [],
        getData: (type: string) =>
          type === "application/craftstation-composer-file"
            ? JSON.stringify({ path: "src/App.tsx", type: "file" })
            : "",
      },
    });

    expect(onAttachFiles).toHaveBeenCalledWith(["src/App.tsx"]);
  });
});
