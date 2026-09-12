import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { ModelSwitchMarker } from "./ModelSwitchMarker";

describe("ModelSwitchMarker", () => {
  it("renders the from → to model boundary", () => {
    const item: RuntimeChatItem = {
      id: "model-switch-1",
      type: "model_switch",
      state: "completed",
      streams: {},
      payload: {
        fromProvider: "grok",
        fromModel: "grok-4.6",
        toProvider: "kimi",
        toModel: "kimi-k2",
        switchedAt: 1_700_000_000_000,
      },
    };

    render(<ModelSwitchMarker item={item} />);

    expect(screen.getByLabelText("模型已切换 grok-4.6 → kimi-k2")).toHaveTextContent(
      "模型已切换 grok-4.6 → kimi-k2",
    );
  });

  it("renders nothing without a switch payload", () => {
    const item: RuntimeChatItem = {
      id: "model-switch-2",
      type: "model_switch",
      state: "completed",
      streams: {},
      payload: undefined,
    };

    const { container } = render(<ModelSwitchMarker item={item} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the handover state while the rebuild is in flight", () => {
    const item: RuntimeChatItem = {
      id: "model-switch-3",
      type: "model_switch",
      state: "started",
      streams: {},
      payload: {
        phase: "handover",
        fromProvider: "grok",
        fromModel: "grok-4.6",
        toProvider: "kimi",
        toModel: "kimi-k2",
        switchedAt: 1_700_000_000_000,
      },
    };

    render(<ModelSwitchMarker item={item} />);

    expect(screen.getByLabelText("正在交接上下文 grok-4.6 → kimi-k2")).toBeInTheDocument();
  });

  it("renders switch failures with the honest reason", () => {
    const item: RuntimeChatItem = {
      id: "model-switch-4",
      type: "model_switch",
      state: "completed",
      streams: {},
      payload: {
        phase: "failed",
        fromProvider: "grok",
        fromModel: "grok-4.6",
        toProvider: "kimi",
        toModel: "kimi-k2",
        switchedAt: 1_700_000_000_000,
        error: "No usable kimi account in the provider pool.",
      },
    };

    render(<ModelSwitchMarker item={item} />);

    expect(screen.getByLabelText(/模型切换失败/)).toHaveTextContent("No usable kimi account");
  });
});
