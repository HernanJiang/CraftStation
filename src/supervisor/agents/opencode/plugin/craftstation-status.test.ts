import { afterEach, describe, expect, it } from "vitest";
// The plugin is a plain ESM module default-exporting the OpenCode V1 plugin
// shape; import it directly to exercise the in-process hook callbacks.
// @ts-ignore - plain .mjs without type declarations
import plugin from "./craftstation-status.mjs";

const ARG = "__craftstation_provider_session_id" as const;

type Args = Record<string, unknown>;
type BeforeHook = (input: unknown, output: { args: Args }) => Promise<void>;

function hookInput(tool: string, sessionID = "ses_test-session"): Record<string, unknown> {
  return { tool, sessionID };
}

async function runBefore(input: Record<string, unknown>, output: { args: Args }): Promise<void> {
  const server = (await (plugin as { server: () => Promise<unknown> }).server()) as Record<
    string,
    BeforeHook | undefined
  >;
  const hook = server["tool.execute.before"];
  if (!hook) throw new Error("tool.execute.before hook missing");
  await hook(input, output);
}

describe("craftstation-status OpenCode plugin session routing", () => {
  const originalRouting = process.env.CRAFTSTATION_OPENCODE_SESSION_ROUTING;
  const originalHookUrl = process.env.CRAFTSTATION_HOOK_URL;
  const originalHookSecret = process.env.CRAFTSTATION_HOOK_SECRET;

  afterEach(() => {
    if (originalRouting === undefined) delete process.env.CRAFTSTATION_OPENCODE_SESSION_ROUTING;
    else process.env.CRAFTSTATION_OPENCODE_SESSION_ROUTING = originalRouting;
    if (originalHookUrl === undefined) delete process.env.CRAFTSTATION_HOOK_URL;
    else process.env.CRAFTSTATION_HOOK_URL = originalHookUrl;
    if (originalHookSecret === undefined) delete process.env.CRAFTSTATION_HOOK_SECRET;
    else process.env.CRAFTSTATION_HOOK_SECRET = originalHookSecret;
  });

  function enableRouting() {
    process.env.CRAFTSTATION_OPENCODE_SESSION_ROUTING = "1";
    delete process.env.CRAFTSTATION_HOOK_URL;
    delete process.env.CRAFTSTATION_HOOK_SECRET;
  }

  it("injects the real session id into CraftStation-owned MCP tool calls", async () => {
    enableRouting();
    for (const tool of [
      "crossagents_send_message",
      "crossagents_ask",
      "craftstation_send_thread_message",
      "craftstation_get_current_thread",
      "Schedule_create",
      "schedule_list_runs",
    ]) {
      const output: { args: Args } = { args: { name: "x" } };
      await runBefore(hookInput(tool), output);
      expect(output.args[ARG]).toBe(`ses_test-session [${tool}]`.split(" ")[0]);
    }
  });

  it("overwrites a model-supplied session arg with the trusted tool context", async () => {
    enableRouting();
    const output: { args: Args } = { args: { [ARG]: "ses_spoofed-by-model" } };
    await runBefore(hookInput("Schedule_create"), output);
    expect(output.args[ARG]).toBe("ses_test-session");
  });

  it("leaves unrelated tools and missing sessions untouched", async () => {
    enableRouting();
    const bashOutput: { args: Args } = { args: { command: "ls" } };
    await runBefore(hookInput("bash"), bashOutput);
    expect(bashOutput.args).not.toHaveProperty(ARG);

    const noSessionOutput: { args: Args } = { args: {} };
    await runBefore({ tool: "Schedule_create" }, noSessionOutput);
    expect(noSessionOutput.args).not.toHaveProperty(ARG);
  });

  it("does nothing when session routing is not enabled on the sidecar", async () => {
    delete process.env.CRAFTSTATION_OPENCODE_SESSION_ROUTING;
    const output: { args: Args } = { args: {} };
    await runBefore(hookInput("Schedule_create"), output);
    expect(output.args).not.toHaveProperty(ARG);
  });
});
