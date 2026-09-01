import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { AppProvider } from "@/renderer/components/ui/provider";
import { RuntimeSegmentMarker } from "./RuntimeSegmentMarker";

describe("RuntimeSegmentMarker", () => {
  it("renders durable recipe, model, harness, Session and Entity provenance", () => {
    const item: RuntimeChatItem = {
      id: "runtime-segment:segment-2",
      type: "runtime_segment",
      state: "completed",
      streams: {},
      payload: {
        segmentId: "segment-2",
        ordinal: 1,
        recipeId: "recipe:xai-grok-native",
        craftPlanId: "plan-2",
        modelId: "grok-4.6",
        harnessKind: "grok",
        entityId: "entity-abcdefghijk",
        runtimeSessionId: "session-abcdefghijk",
        nativeSessionRef: "native-session-abcdefghijk",
        bindingEpoch: 2,
      },
    };

    render(
      <AppProvider>
        <RuntimeSegmentMarker item={item} />
      </AppProvider>,
    );

    expect(screen.getByLabelText("Runtime segment 2")).toHaveTextContent(
      "Runtime segment 2 · grok-4.6 · grok",
    );
    expect(screen.getByLabelText("Runtime segment 2")).toHaveTextContent("recipe:xai-grok-native");
    expect(screen.getByLabelText("Runtime segment 2")).toHaveTextContent("session-…");
    expect(screen.getByLabelText("Runtime segment 2")).toHaveTextContent("entity-a…");
    expect(screen.getByLabelText("Runtime segment 2")).toHaveTextContent(
      "nativeSessionRef=native-s…",
    );
  });
});
