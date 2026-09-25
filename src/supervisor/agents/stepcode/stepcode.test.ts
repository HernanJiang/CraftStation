import { describe, expect, it } from "vitest";
import type { ProjectLocation, ThreadConfig } from "@/shared/contracts";
import { createKnownSessionRef } from "../base";
import { stepCodeDefaultCapabilities, stepCodeDetectionSpec } from "./detection";
import { createStepCodeAdapter } from "./index";

const location = { kind: "posix", path: "/tmp/step-project" } as ProjectLocation;

describe("Step Code provider metadata", () => {
  const adapter = createStepCodeAdapter();

  it("declares terminal and structured RPC chat without inventing modes", () => {
    expect(adapter).toMatchObject({ kind: "stepcode", label: "Step Code", binary: "step" });
    expect(adapter.capabilities).toMatchObject({
      presentationMode: "terminal",
      presentationModes: ["terminal", "gui"],
      modes: [],
      approvalPolicies: [],
      supportsResume: true,
      supportsOneShot: true,
      mcpScope: { terminal: "none", gui: "launch" },
      defaultApprovalPolicy: "never",
    });
    expect(typeof adapter.createStructuredSession).toBe("function");
  });

  it("uses Step Code and shared Agent Skills roots with skill invocation", () => {
    expect(adapter.skillSupport).toEqual({
      roots: [
        {
          id: "stepcode",
          label: "Step Code",
          globalPath: ".stepcode/agent/skills",
          projectPath: ".stepcode/skills",
          globalOverride: { env: "STEP_CODING_AGENT_DIR", path: "skills" },
        },
        {
          id: "agents",
          label: "Shared agent skills",
          globalPath: ".agents/skills",
          projectPath: ".agents/skills",
        },
      ],
      invocation: "skill",
      precedence: { global: ["stepcode", "agents"], project: ["stepcode", "agents"] },
    });
  });

  it("wires the official `step update` self updater and login command", () => {
    expect(adapter.update).toMatchObject({ builtIn: { binary: "step", args: ["update"] } });
    expect(stepCodeDetectionSpec.loginCommand).toBe("step login");
  });
});

describe("Step Code CLI argv", () => {
  const adapter = createStepCodeAdapter();

  it("launches the step binary with auto-approve, model and prompt", () => {
    expect(
      adapter.buildLaunchArgv(location, { model: "step/step-5-preview" } as ThreadConfig, "go"),
    ).toEqual({
      binary: "step",
      args: ["--approve", "--model", "step/step-5-preview", "go"],
    });
  });

  it("resumes the exact Step Code session id", () => {
    expect(
      adapter.buildResumeArgv(
        location,
        { model: "step/step-5-preview", effort: "high" } as ThreadConfig,
        "continue",
        createKnownSessionRef("0198-session"),
      ).args,
    ).toEqual([
      "--approve",
      "--session",
      "0198-session",
      "--model",
      "step/step-5-preview",
      "--thinking",
      "high",
      "continue",
    ]);
  });

  it("builds a text-only one-shot command on the step binary", () => {
    expect(adapter.buildOneShotCommand?.("step/step-5-preview", "low", "reply OK")).toEqual({
      command: "step",
      args: [
        "--approve",
        "--model",
        "step/step-5-preview",
        "--thinking",
        "low",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "-p",
        "reply OK",
      ],
      stdin: "",
    });
  });

  it("formats attachments with the @path syntax", () => {
    const formatted = adapter.formatPromptSegments?.([
      { kind: "text", content: "Review these" },
      { kind: "attachment", path: "/tmp/spec.md" },
    ]);
    expect(formatted).toBe("Review these\n\n@/tmp/spec.md");
  });
});

describe("Step Code capability defaults", () => {
  it("seeds the StepFun flagship as the default model", () => {
    expect(stepCodeDefaultCapabilities.models).toEqual([
      { id: "step/step-5-preview", label: "Step 5 Preview" },
    ]);
  });
});

describe("Step Code terminal behavior", () => {
  const adapter = createStepCodeAdapter();

  it("submits direct input after the paste guard window", () => {
    expect(adapter.buildDirectInput?.("hello")).toEqual(["hello", "@wait:150", "\r"]);
  });

  it("recognizes the Step Code editor placeholder as prompt-ready", () => {
    expect(
      adapter.isReadyForInitialPrompt?.(
        "Ask Step to do anything (/ for commands, @ for files, ! for shell)",
      ),
    ).toBe(true);
  });
});
