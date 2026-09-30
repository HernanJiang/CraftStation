// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { AgentStatus, GenerateTitlePayload } from "@/shared/contracts";
import { generateTitleWithFallback, getTitleGenCandidates } from "./titleGen";
import "./claude";
import "./codex";
import "./gemini";

const codexStatus: AgentStatus = {
  kind: "codex",
  label: "Codex",
  installed: true,
  authState: "authenticated",
  capabilities: {
    models: [
      { id: "gpt-5.6-luna", label: "5.6 Luna" },
      { id: "gpt-5.5", label: "5.5" },
    ],
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "high",
    modelEfforts: {},
    modes: ["agent", "plan"],
    approvalPolicies: [{ id: "on-request", label: "On Request" }],
    sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
    supportsResume: true,
    supportsOneShot: true,
    supportsDirectInput: true,
    liveInputMode: "server",
    presentationMode: "terminal",
    settingDefs: [],
  },
};

const claudeStatus: AgentStatus = {
  kind: "claude",
  label: "Claude Code",
  installed: true,
  authState: "authenticated",
  capabilities: {
    models: [
      { id: "sonnet", label: "Sonnet" },
      { id: "haiku", label: "Haiku" },
    ],
    efforts: ["low", "medium", "high"],
    defaultEffort: "high",
    modelEfforts: { haiku: ["low", "medium"] },
    modes: ["agent", "plan"],
    approvalPolicies: [{ id: "default", label: "Default" }],
    sandboxModes: [],
    settingDefs: [],
    supportsResume: true,
    supportsOneShot: true,
    supportsDirectInput: true,
    liveInputMode: "terminal",
    presentationMode: "terminal",
  },
};

describe("generateTitleWithFallback preferred agent", () => {
  const projectLocation = { kind: "windows" as const, path: "C:\\repo" };
  type Invoker = (payload: GenerateTitlePayload) => Promise<{ title: string }>;

  it("tries the thread's own agent first when preferredAgentKind is set", async () => {
    const invoke = vi.fn<Invoker>().mockResolvedValue({ title: "fix sidebar layout" });

    await expect(
      generateTitleWithFallback({
        projectLocation,
        agentStatuses: [codexStatus, claudeStatus],
        provider: "auto",
        model: "",
        effort: "",
        preferredAgentKind: "claude",
        prompt: "hello",
        invoke,
      }),
    ).resolves.toBe("fix sidebar layout");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ agentKind: "claude", model: "haiku", effort: "low" }),
    );
  });

  it("falls back to the next candidate when the preferred agent fails", async () => {
    const invoke = vi.fn<Invoker>();
    invoke.mockRejectedValueOnce(new Error("claude CLI not found"));
    invoke.mockResolvedValueOnce({ title: "thread topic" });

    await expect(
      generateTitleWithFallback({
        projectLocation,
        agentStatuses: [codexStatus, claudeStatus],
        provider: "auto",
        model: "",
        effort: "",
        preferredAgentKind: "claude",
        prompt: "hello",
        invoke,
      }),
    ).resolves.toBe("thread topic");

    expect(invoke).toHaveBeenNthCalledWith(1, expect.objectContaining({ agentKind: "claude" }));
    expect(invoke).toHaveBeenNthCalledWith(2, expect.objectContaining({ agentKind: "codex" }));
  });

  it("keeps the default ordering when no preferred agent is given", async () => {
    const invoke = vi.fn<Invoker>().mockResolvedValue({ title: "topic" });
    const [first] = getTitleGenCandidates([codexStatus, claudeStatus], "auto");

    await generateTitleWithFallback({
      projectLocation,
      agentStatuses: [codexStatus, claudeStatus],
      provider: "auto",
      model: "",
      effort: "",
      prompt: "hello",
      invoke,
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ agentKind: first?.kind }));
  });

  it("does not fall back when a specific provider is selected", async () => {
    const invoke = vi.fn<Invoker>().mockRejectedValue(new Error("codex CLI not found"));

    await expect(
      generateTitleWithFallback({
        projectLocation,
        agentStatuses: [codexStatus, claudeStatus],
        provider: "codex",
        model: "",
        effort: "",
        preferredAgentKind: "claude",
        prompt: "hello",
        invoke,
      }),
    ).rejects.toThrow("codex CLI not found");

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
