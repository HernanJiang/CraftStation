import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";

const bridge = vi.hoisted(() => ({
  startShell: vi.fn<(payload: unknown) => Promise<void>>(),
  closeThread: vi.fn<() => Promise<void>>(),
  createCodexProfile: vi.fn<() => Promise<unknown>>(),
  createKimiProfile: vi.fn<() => Promise<unknown>>(),
  removeAccount: vi.fn<(payload: unknown) => Promise<void>>(),
  startCodexProfileLogin: vi.fn<(payload: unknown) => Promise<unknown>>(),
  startKimiProfileLogin: vi.fn<(payload: unknown) => Promise<unknown>>(),
  completeKimiProfileLogin: vi.fn<(payload: unknown) => Promise<unknown>>(),
  createGrokProfileLogin: vi.fn<(payload: unknown) => Promise<unknown>>(),
  startGrokProfileLogin: vi.fn<(payload: unknown) => Promise<unknown>>(),
  pollGrokProfileLogin: vi.fn<(payload: unknown) => Promise<unknown>>(),
  completeGrokProfileLogin: vi.fn<(payload: unknown) => Promise<unknown>>(),
  cancelGrokProfileLogin: vi.fn<(payload: unknown) => Promise<unknown>>(),
  refreshAccountQuota: vi.fn<(payload: unknown) => Promise<unknown>>(),
  listAccounts: vi.fn<(payload: unknown) => Promise<unknown>>(),
  onSupervisorEvent: vi.fn<(handler: (event: SupervisorEvent) => void) => () => void>(),
  openExternal: vi.fn<(url: string) => Promise<void>>(),
  openExternalNative: vi.fn<(url: string) => Promise<void>>(),
}));

const supervisorHandlers = vi.hoisted(() => [] as Array<(event: SupervisorEvent) => void>);
const loginTerminalStore = vi.hoisted(() => ({
  open: vi.fn<(input: { shellId: string }) => void>(),
  close: vi.fn<() => void>(),
  markFailed: vi.fn<(shellId: string, exitCode: number) => void>(),
  active: undefined as { onForceClose?: () => void; shellId: string } | undefined,
}));
const writeScriptToShellMock = vi.hoisted(() => vi.fn<(shellId: string, script: string) => void>());
const startShellWithCurrentSettingsMock = vi.hoisted(() =>
  vi.fn<(payload: unknown) => Promise<void>>(),
);

vi.mock("@heroui/react", () => ({
  toast: {
    danger: vi.fn<(message: string) => void>(),
    success: vi.fn<(message: string) => void>(),
    warning: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
  },
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: {
    getState: () => ({ projects: [], threads: [], view: { kind: "draft", projectId: "project" } }),
  },
}));

vi.mock("@/renderer/state/devTerminalStore", () => ({
  useDevTerminalStore: {
    getState: () => ({ activeProjectId: undefined }),
  },
}));

vi.mock("@/renderer/state/loginTerminalStore", () => ({
  useLoginTerminalStore: {
    getState: () => loginTerminalStore,
  },
}));

vi.mock("@/renderer/state/panelStore", () => ({
  usePanelStore: {
    getState: () => ({ setRightPanelTab: vi.fn<(tab: string) => void>() }),
  },
}));

vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: {
    getState: () => ({ terminalPosition: "bottom" }),
  },
}));

vi.mock("@/renderer/utils/shellUtils", () => ({
  disposeRoutedShellSession: vi.fn<(shellId: string) => void>(),
  startShellWithCurrentSettings: startShellWithCurrentSettingsMock,
  writeScriptToShell: writeScriptToShellMock,
}));

import { toast } from "@heroui/react";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import {
  createAndRunCodexProfileLogin,
  createAndRunKimiProfileLogin,
  createAndRunGrokProfileLogin,
  runAgentInstallCommand,
  runAgentLoginCommand,
  runCodexProfileLogin,
  runKimiProfileLogin,
} from "./agentLoginActions";

const wslProject: Project = {
  id: "project",
  name: "Project",
  location: {
    kind: "wsl",
    distro: "Ubuntu",
    linuxPath: "/home/demo/project",
    uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\project",
  },
  createdAt: new Date(0).toISOString(),
};

const windowsProject: Project = {
  id: "windows-project",
  name: "Windows Project",
  location: {
    kind: "windows",
    path: "C:\\repo",
  },
  createdAt: new Date(0).toISOString(),
};

const posixProject: Project = {
  id: "posix-project",
  name: "Posix Project",
  location: {
    kind: "posix",
    path: "/Users/demo/project",
  },
  createdAt: new Date(0).toISOString(),
};

function emit(event: SupervisorEvent) {
  for (const handler of supervisorHandlers) handler(event);
}

function unwrapBashScript(script: string): string {
  const prefix = "command bash -lc ";
  expect(script.startsWith(prefix)).toBe(true);
  const quoted = script.slice(prefix.length);
  expect(quoted.startsWith("'")).toBe(true);
  expect(quoted.endsWith("'")).toBe(true);
  return quoted.slice(1, -1).replaceAll("'\\''", "'");
}

describe("runAgentLoginCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    supervisorHandlers.length = 0;
    bridge.startShell.mockReset().mockResolvedValue(undefined);
    bridge.closeThread.mockReset().mockResolvedValue(undefined);
    bridge.createCodexProfile.mockReset();
    bridge.createKimiProfile.mockReset();
    bridge.removeAccount.mockReset().mockResolvedValue(undefined);
    bridge.startCodexProfileLogin.mockReset().mockResolvedValue({});
    bridge.startKimiProfileLogin.mockReset().mockResolvedValue({});
    bridge.completeKimiProfileLogin.mockReset().mockResolvedValue({});
    bridge.createGrokProfileLogin.mockReset().mockResolvedValue({
      pendingRef: "grok-pending:test",
      label: "New Grok",
    });
    bridge.startGrokProfileLogin.mockReset().mockResolvedValue({});
    bridge.pollGrokProfileLogin.mockReset().mockResolvedValue({ done: false });
    bridge.completeGrokProfileLogin.mockReset().mockResolvedValue({});
    bridge.cancelGrokProfileLogin.mockReset().mockResolvedValue(undefined);
    bridge.refreshAccountQuota.mockReset().mockResolvedValue({});
    bridge.listAccounts.mockReset().mockResolvedValue([]);
    bridge.openExternal.mockReset().mockResolvedValue(undefined);
    bridge.openExternalNative.mockReset().mockResolvedValue(undefined);
    bridge.onSupervisorEvent.mockReset().mockImplementation((handler) => {
      supervisorHandlers.push(handler);
      return () => {
        const index = supervisorHandlers.indexOf(handler);
        if (index >= 0) supervisorHandlers.splice(index, 1);
      };
    });
    loginTerminalStore.open.mockReset();
    loginTerminalStore.close.mockReset();
    loginTerminalStore.markFailed.mockReset();
    loginTerminalStore.active = undefined;
    useUsageAccountsStore.getState().reset();
    writeScriptToShellMock.mockReset();
    startShellWithCurrentSettingsMock
      .mockReset()
      .mockImplementation((payload) => bridge.startShell(payload));
  });

  it("opens hard-wrapped WSL auth URLs in the native browser", () => {
    runAgentLoginCommand({
      label: "Grok",
      command: "grok login",
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;
    expect(shellId).toBeTruthy();
    const script = writeScriptToShellMock.mock.calls[0]?.[1] ?? "";
    const innerScript = unwrapBashScript(script);
    expect(script).not.toContain("cmd.exe /c start");
    expect(innerScript).toContain(
      "clear; BROWSER='/bin/true' DISPLAY='' WAYLAND_DISPLAY='' grok login",
    );

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: "Open https://auth.x.ai/oauth2/authorize?response_type=code\n",
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);
    expect(bridge.openExternalNative).not.toHaveBeenCalled();

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: "&client_id=grok-build\n&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fcallback\n",
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);

    expect(bridge.openExternalNative).toHaveBeenCalledWith(
      "https://auth.x.ai/oauth2/authorize?response_type=code&client_id=grok-build&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fcallback",
    );
  });

  it("opens complete long WSL auth URLs after suppressing the agent browser", () => {
    runAgentLoginCommand({
      label: "Grok",
      command: "grok login",
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;
    const url =
      "https://auth.x.ai/oauth2/authorize?response_type=code&client_id=b1a00492-073a-47ea-816f-4c329264a828&redirect_uri=http%3A%2F%2F127.0.0.1%3A45417%2Fcallback&scope=openid%20profile%20email%20offline_access%20grok-cli%3Aaccess%20api%3Aaccess&code_challenge=MDPixKrsA5K4QIgvDtSEPlQniofqpd2Rr8wT5HEzo5I&code_challenge_method=S256&state=019e5ddb-3198-7542-8504-714899198f01&nonce=019e5ddb-3198-7542-8504-7154a7bf6c98";

    expect(unwrapBashScript(writeScriptToShellMock.mock.calls[0]?.[1] ?? "")).toContain(
      "clear; BROWSER='/bin/true' DISPLAY='' WAYLAND_DISPLAY='' grok login",
    );

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: `Open this URL to sign in:\n  ${url}\n`,
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);

    expect(bridge.openExternalNative).toHaveBeenCalledWith(url);
  });

  it("opens the Grok device-authorization URL from the official CLI, never grok.com", () => {
    runAgentLoginCommand({
      label: "Grok",
      command: "grok login --device-auth",
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;
    expect(shellId).toBeTruthy();
    const script = writeScriptToShellMock.mock.calls[0]?.[1] ?? "";
    expect(unwrapBashScript(script)).toContain(
      "clear; BROWSER='/bin/true' DISPLAY='' WAYLAND_DISPLAY='' grok login --device-auth",
    );

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: "To authenticate, please visit:\n  https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH-1234-5678\n",
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);

    expect(bridge.openExternalNative).toHaveBeenCalledWith(
      "https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH",
    );
    expect(bridge.openExternalNative.mock.calls.map((call) => call[0]).join(" ")).not.toContain(
      "grok.com",
    );
  });

  it("sets profile env via PowerShell assignments on native Windows, not a POSIX prefix", () => {
    runAgentLoginCommand({
      label: "Claude Code",
      command: "claude auth login",
      env: { CLAUDE_CONFIG_DIR: "C:\\Users\\sdsle\\.craftstation\\claude-profiles\\home" },
      project: windowsProject,
    });

    const script = writeScriptToShellMock.mock.calls[0]?.[1] ?? "";
    // PowerShell can't run `KEY=value command`; it must assign $env: first.
    expect(script).toContain(
      "Clear-Host; $env:CLAUDE_CONFIG_DIR = 'C:\\Users\\sdsle\\.craftstation\\claude-profiles\\home'; claude auth login",
    );
    expect(script).not.toContain("CLAUDE_CONFIG_DIR=C:");
    expect(startShellWithCurrentSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectLocation: windowsProject.location,
        startInHome: true,
        windowsShellRuntime: "powershell",
      }),
    );
  });

  it("sets profile env via an inline POSIX prefix on WSL", () => {
    runAgentLoginCommand({
      label: "Claude Code",
      command: "claude auth login",
      env: { CLAUDE_CONFIG_DIR: "/home/demo/.claude-profiles/home" },
      project: wslProject,
    });

    const script = writeScriptToShellMock.mock.calls[0]?.[1] ?? "";
    expect(unwrapBashScript(script)).toContain(
      "clear; CLAUDE_CONFIG_DIR='/home/demo/.claude-profiles/home' BROWSER='/bin/true' DISPLAY='' WAYLAND_DISPLAY='' claude auth login",
    );
  });

  it("does not intercept login URLs on native Windows so the CLI's own browser opener wins", () => {
    runAgentLoginCommand({
      label: "Grok",
      command: "grok login",
      project: windowsProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;
    const url =
      "https://auth.x.ai/oauth2/authorize?response_type=code&client_id=b1a00492-073a-47ea-816f-4c329264a828&redirect_uri=http%3A%2F%2F127.0.0.1%3A37155%2Fcallback&scope=openid%20profile%20email%20offline_access%20grok-cli%3Aaccess%20api%3Aaccess&code_challenge=XZGsVbiV8w8TRiC3gHnWDKL8TsuK2tFNeVR9md4tA34&code_challenge_method=S256&state=019e5e1e-040a-78c1-bbd6-1585cd381488&nonce=019e5e1e-040a-78c1-bbd6-159774c2afa3";

    // BROWSER override is WSL-only; Clear-Host runs as-is on native Windows.
    expect(writeScriptToShellMock.mock.calls[0]?.[1] ?? "").toContain("Clear-Host; grok login");

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: `\r\nSigning in with Grok...\r\n\r\nOpen this URL to sign in:\r\n  ${url}\r\n\r\nPaste the URL here if it doesn't connect:\r\n`,
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);

    expect(bridge.openExternalNative).not.toHaveBeenCalled();
  });

  it("does not append following prompt text to xAI device auth URLs", () => {
    runAgentLoginCommand({
      label: "Grok",
      command: "grok login --device-auth",
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: [
        "To sign in, open this URL in your browser:\n\n",
        "  https://accounts.x.ai/oauth2/device?user_code=E9YP-N7CQIf prompted, confirm this code:\n\n",
        "  E9YP-N7CQ\n",
      ].join(""),
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);

    expect(bridge.openExternalNative).toHaveBeenCalledWith(
      "https://accounts.x.ai/oauth2/device?user_code=E9YP-N7CQ",
    );
  });

  it("normalizes Codex device auth URLs when auto-opening from WSL output", () => {
    runAgentLoginCommand({
      label: "Codex",
      command: "codex login --device-auth",
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: "1. Open this link in your browser and sign in to your account\n   https://auth.openai.com/codex/device2. Enter this one-time code\n",
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);

    expect(bridge.openExternalNative).toHaveBeenCalledWith("https://auth.openai.com/codex/device");
  });

  it("does not auto-open Codex's local callback server URL", () => {
    runAgentLoginCommand({
      label: "Codex",
      command: "codex login",
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;
    const authUrl =
      "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback";

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: `Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\n${authUrl}\n`,
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);

    expect(bridge.openExternalNative).toHaveBeenCalledTimes(1);
    expect(bridge.openExternalNative).toHaveBeenCalledWith(authUrl);
  });

  it("opens Cursor WSL browser login URLs", () => {
    runAgentLoginCommand({
      label: "Cursor",
      command: "cursor-agent login",
      env: { NO_OPEN_BROWSER: "1" },
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;
    const url =
      "https://cursor.com/loginDeepControl?challenge=C_7tIakH9LsaJ5eBDQVlz6IYoQvg93TP5qmAkdBFFY&uuid=801340c1-2708-4d80-afaa-197f054a7e58&mode=login&redirectTarget=cli";

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: `Open a browser and navigate to this link: ${url}\n`,
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);

    expect(bridge.openExternalNative).toHaveBeenCalledWith(url);
  });

  it("keeps Kimi WSL login to one native browser launch", () => {
    runAgentLoginCommand({
      label: "Kimi Code",
      command: "'/home/demo/.kimi-code/bin/kimi' login",
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;
    expect(unwrapBashScript(writeScriptToShellMock.mock.calls[0]?.[1] ?? "")).toContain(
      "clear; BROWSER='/bin/true' DISPLAY='' WAYLAND_DISPLAY='' '/home/demo/.kimi-code/bin/kimi' login",
    );

    const url = "https://www.kimi.com/code/authorize_device?user_code=ABCD-EFGH";
    emit({
      type: "thread-output",
      threadId: shellId!,
      data: `Opening browser for Kimi device login: ${url}\n`,
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);
    emit({
      type: "thread-output",
      threadId: shellId!,
      data: `If the browser did not open, paste this URL: ${url}\n`,
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);

    expect(bridge.openExternalNative).toHaveBeenCalledTimes(1);
    expect(bridge.openExternalNative).toHaveBeenCalledWith(url);
  });

  it("does not auto-open Gemini WSL login links", () => {
    runAgentLoginCommand({
      label: "Gemini",
      command: "gemini /auth",
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;
    expect(unwrapBashScript(writeScriptToShellMock.mock.calls[0]?.[1] ?? "")).toContain(
      "clear; BROWSER='/bin/true' DISPLAY='' WAYLAND_DISPLAY='' gemini /auth",
    );

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: "https://geminicli.com/docs/resources/tos-privacy/%E2%94%82\n",
      outputLength: 0,
    });
    vi.advanceTimersByTime(250);

    expect(bridge.openExternalNative).not.toHaveBeenCalled();
  });

  it("marks the login overlay as failed when the command exits unsuccessfully", () => {
    runAgentLoginCommand({
      label: "Grok",
      command: "grok login",
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;
    const script = writeScriptToShellMock.mock.calls[0]?.[1] ?? "";
    const token = /craftstation-login-complete=([^:]+):/u.exec(script)?.[1];
    expect(token).toBeTruthy();

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: `\u001B]777;craftstation-login-complete=${token}:1\u0007`,
      outputLength: 0,
    });
    vi.advanceTimersByTime(1200);

    expect(loginTerminalStore.close).not.toHaveBeenCalled();
    expect(loginTerminalStore.markFailed).toHaveBeenCalledWith(shellId, 1);
    expect(toast.danger).not.toHaveBeenCalled();
  });

  it("auto-closes the login overlay after a successful command exit", () => {
    runAgentLoginCommand({
      label: "Grok",
      command: "grok login",
      project: wslProject,
    });

    const shellId = loginTerminalStore.open.mock.calls[0]?.[0].shellId;
    const script = writeScriptToShellMock.mock.calls[0]?.[1] ?? "";
    const token = /craftstation-login-complete=([^:]+):/u.exec(script)?.[1];
    expect(token).toBeTruthy();

    emit({
      type: "thread-output",
      threadId: shellId!,
      data: `\u001B]777;craftstation-login-complete=${token}:0\u0007`,
      outputLength: 0,
    });

    expect(loginTerminalStore.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1200);
    expect(loginTerminalStore.close).toHaveBeenCalledTimes(1);
  });

  it("wraps non-Windows install commands in bash so fish does not parse POSIX syntax", () => {
    runAgentInstallCommand({
      label: "OpenCode",
      command:
        "if command -v curl >/dev/null 2>&1; then curl -fsSL https://opencode.ai/install | bash; elif command -v brew >/dev/null 2>&1; then brew install anomalyco/tap/opencode; elif command -v npm >/dev/null 2>&1; then npm install -g opencode-ai; fi",
      project: posixProject,
    });

    const script = writeScriptToShellMock.mock.calls[0]?.[1] ?? "";
    expect(script).toMatch(/^command bash -lc '/u);

    const innerScript = unwrapBashScript(script);
    expect(innerScript).toContain("https://opencode.ai/install | bash");
    expect(innerScript).toContain("printf '\\033]777;craftstation-login-complete=lc_");
    expect(innerScript).toContain('"$__lc_exit"');
  });

  it("opens update commands with update-specific terminal state", () => {
    runAgentInstallCommand({
      label: "Update Cursor SDK",
      command: "npm install -g '@cursor/sdk@^1.0.24'",
      project: posixProject,
      purpose: "update",
    });

    expect(loginTerminalStore.open).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Update Cursor SDK",
        purpose: "update",
        shellId: expect.stringMatching(/^update:/u),
      }),
    );
    expect(startShellWithCurrentSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectLocation: posixProject.location,
        startInHome: true,
      }),
    );
    expect(startShellWithCurrentSettingsMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "windowsShellRuntime",
    );
  });

  it("creates a profile, starts its isolated login, and refreshes account state after completion", async () => {
    const account = {
      accountId: "codex:account-1",
      provider: "codex",
      label: "New Codex",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "unavailable",
      credentialScopeRef: "managed:codex:account-1",
    } as const;
    bridge.createCodexProfile.mockResolvedValue(account);
    const authorizedAccount = {
      ...account,
      status: "available" as const,
      maskedIdentity: "user@example.com",
    };
    bridge.listAccounts.mockResolvedValue([authorizedAccount]);

    const started = createAndRunCodexProfileLogin({ project: windowsProject });
    await vi.waitFor(() => expect(bridge.startCodexProfileLogin).toHaveBeenCalledOnce());

    const payload = bridge.startCodexProfileLogin.mock.calls[0]?.[0] as {
      accountId: string;
      shellId: string;
      completionToken: string;
    };
    expect(bridge.createCodexProfile).toHaveBeenCalledWith({ label: "New Codex" });
    expect(payload).toMatchObject({
      accountId: account.accountId,
      projectLocation: windowsProject.location,
      windowsShellRuntime: "powershell",
    });
    expect(payload.completionToken).toMatch(/^lc_[A-Za-z0-9_-]+$/u);

    emit({
      type: "thread-output",
      threadId: payload.shellId,
      data: `\u001B]777;craftstation-login-complete=${payload.completionToken}:0\u0007`,
      outputLength: 0,
    });
    await vi.waitFor(() => expect(bridge.refreshAccountQuota).toHaveBeenCalledOnce());
    await started;

    expect(bridge.refreshAccountQuota).toHaveBeenCalledWith({ accountId: account.accountId });
    expect(bridge.listAccounts).toHaveBeenCalledWith({ provider: "codex" });
    await vi.waitFor(() =>
      expect(useUsageAccountsStore.getState().accounts).toEqual([authorizedAccount]),
    );
    expect(bridge.removeAccount).not.toHaveBeenCalled();
    expect(loginTerminalStore.markFailed).not.toHaveBeenCalled();
  });

  it("does not keep an unauthenticated Codex profile after login fails", async () => {
    const account = {
      accountId: "codex:orphan",
      provider: "codex",
      label: "New Codex",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "unavailable",
      credentialScopeRef: "managed:codex:orphan",
    } as const;
    bridge.createCodexProfile.mockResolvedValue(account);
    useUsageAccountsStore.getState().setAccounts([account]);

    const started = createAndRunCodexProfileLogin({ project: windowsProject });
    await vi.waitFor(() => expect(bridge.startCodexProfileLogin).toHaveBeenCalledOnce());
    const payload = bridge.startCodexProfileLogin.mock.calls[0]?.[0] as {
      shellId: string;
      completionToken: string;
    };
    emit({
      type: "thread-output",
      threadId: payload.shellId,
      data: `\u001B]777;craftstation-login-complete=${payload.completionToken}:1\u0007`,
      outputLength: 0,
    });
    await expect(started).resolves.toBe(false);
    expect(bridge.removeAccount).toHaveBeenCalledWith({ accountId: account.accountId });
    expect(useUsageAccountsStore.getState().accounts).toEqual([]);
  });

  it("does not create an orphaned profile when no project can host the login", async () => {
    await expect(createAndRunCodexProfileLogin()).resolves.toBe(false);

    expect(bridge.createCodexProfile).not.toHaveBeenCalled();
    expect(bridge.startCodexProfileLogin).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalled();
  });

  it("marks an isolated profile login failed for a non-zero completion and for an unexpected shell exit", async () => {
    const firstPending = runCodexProfileLogin({
      accountId: "codex:account-2",
      label: "Existing",
      project: posixProject,
    });
    await vi.waitFor(() => expect(bridge.startCodexProfileLogin).toHaveBeenCalledOnce());
    const first = bridge.startCodexProfileLogin.mock.calls[0]?.[0] as {
      shellId: string;
      completionToken: string;
    };
    emit({
      type: "thread-output",
      threadId: first.shellId,
      data: `\u001B]777;craftstation-login-complete=${first.completionToken}:7\u0007`,
      outputLength: 0,
    });
    await vi.waitFor(() =>
      expect(loginTerminalStore.markFailed).toHaveBeenCalledWith(first.shellId, 7),
    );
    await firstPending;

    loginTerminalStore.active = undefined;
    loginTerminalStore.markFailed.mockReset();
    const secondPending = runCodexProfileLogin({
      accountId: "codex:account-3",
      label: "Crashes",
      project: posixProject,
    });
    await vi.waitFor(() => expect(bridge.startCodexProfileLogin).toHaveBeenCalledTimes(2));
    const second = bridge.startCodexProfileLogin.mock.calls[1]?.[0] as { shellId: string };
    emit({ type: "thread-exited", threadId: second.shellId, exitCode: 9 });
    await vi.waitFor(() =>
      expect(loginTerminalStore.markFailed).toHaveBeenCalledWith(second.shellId, 9),
    );
    await secondPending;
    expect(bridge.refreshAccountQuota).not.toHaveBeenCalled();
  });

  it("cancels the profile shell and prevents completion refresh", async () => {
    const pending = runCodexProfileLogin({
      accountId: "codex:account-cancel",
      label: "Cancel",
      project: posixProject,
    });
    await vi.waitFor(() => expect(loginTerminalStore.open).toHaveBeenCalledOnce());
    const opened = loginTerminalStore.open.mock.calls[0]?.[0] as {
      shellId: string;
      onForceClose?: () => void;
    };
    opened.onForceClose?.();
    await vi.waitFor(() => expect(bridge.closeThread).toHaveBeenCalled());
    expect(bridge.closeThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: opened.shellId }),
    );
    expect(bridge.refreshAccountQuota).not.toHaveBeenCalled();
    expect(bridge.listAccounts).not.toHaveBeenCalled();
    await expect(pending).resolves.toBe(false);
  });

  it("rejects repeated profile login starts and reports backend failures", async () => {
    loginTerminalStore.active = { shellId: "login:already-active" };
    await expect(
      runCodexProfileLogin({
        accountId: "codex:duplicate",
        label: "Duplicate",
        project: posixProject,
      }),
    ).resolves.toBe(false);
    loginTerminalStore.active = undefined;

    bridge.startCodexProfileLogin.mockRejectedValueOnce(new Error("ACCOUNT_NOT_FOUND"));
    await expect(
      runCodexProfileLogin({ accountId: "codex:unknown", label: "Unknown", project: posixProject }),
    ).resolves.toBe(false);
    expect(bridge.closeThread).toHaveBeenCalledWith({
      threadId: expect.stringMatching(/^login:/u),
    });
    expect(toast.danger).toHaveBeenCalledWith("ACCOUNT_NOT_FOUND");
  });

  it("creates a Kimi row, starts isolated login, and completes it after the native marker", async () => {
    const account = {
      accountId: "kimi:new",
      provider: "kimi",
      label: "New Kimi",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "unavailable" as const,
      credentialScopeRef: "managed:kimi:new",
    };
    const authorized = { ...account, status: "available" as const, maskedIdentity: "kimi-user" };
    bridge.createKimiProfile.mockResolvedValue(account);
    bridge.listAccounts.mockResolvedValue([authorized]);

    const pending = createAndRunKimiProfileLogin({ project: windowsProject });
    await vi.waitFor(() => expect(bridge.startKimiProfileLogin).toHaveBeenCalledOnce());

    const payload = bridge.startKimiProfileLogin.mock.calls[0]?.[0] as {
      accountId: string;
      shellId: string;
      completionToken: string;
      projectLocation: Project["location"];
      windowsShellRuntime: string;
    };
    expect(bridge.createKimiProfile).toHaveBeenCalledWith({ label: "New Kimi" });
    expect(payload).toMatchObject({
      accountId: account.accountId,
      projectLocation: windowsProject.location,
      windowsShellRuntime: "powershell",
    });
    expect(payload.completionToken).toMatch(/^lc_[A-Za-z0-9_-]+$/u);

    emit({
      type: "thread-output",
      threadId: payload.shellId,
      data: `\u001B]777;craftstation-login-complete=${payload.completionToken}:0\u0007`,
      outputLength: 0,
    });
    await expect(pending).resolves.toBe(true);

    expect(bridge.completeKimiProfileLogin).toHaveBeenCalledWith({ accountId: account.accountId });
    expect(bridge.listAccounts).toHaveBeenCalledWith({ provider: "kimi" });
    expect(bridge.removeAccount).not.toHaveBeenCalled();
    expect(useUsageAccountsStore.getState().accounts).toEqual([authorized]);
  });

  it("removes a newly-created Kimi row when identity completion fails", async () => {
    const account = {
      accountId: "kimi:orphan",
      provider: "kimi",
      label: "New Kimi",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "unavailable" as const,
      credentialScopeRef: "managed:kimi:orphan",
    };
    bridge.createKimiProfile.mockResolvedValue(account);
    bridge.completeKimiProfileLogin.mockRejectedValueOnce(
      new Error("ACCOUNT_IDENTITY_UNAVAILABLE"),
    );

    const pending = createAndRunKimiProfileLogin({ project: posixProject });
    await vi.waitFor(() => expect(bridge.startKimiProfileLogin).toHaveBeenCalledOnce());
    const payload = bridge.startKimiProfileLogin.mock.calls[0]?.[0] as {
      accountId: string;
      shellId: string;
      completionToken: string;
    };
    emit({
      type: "thread-output",
      threadId: payload.shellId,
      data: `\u001B]777;craftstation-login-complete=${payload.completionToken}:0\u0007`,
      outputLength: 0,
    });

    await expect(pending).resolves.toBe(false);
    expect(bridge.removeAccount).toHaveBeenCalledWith({ accountId: account.accountId });
    expect(useUsageAccountsStore.getState().accounts).toEqual([]);
  });

  it("closes a failed Kimi login shell when the Supervisor start call rejects", async () => {
    bridge.startKimiProfileLogin.mockRejectedValueOnce(new Error("ACCOUNT_RUNTIME_UNSUPPORTED"));
    const pending = runKimiProfileLogin({
      accountId: "kimi:existing",
      label: "Existing Kimi",
      project: windowsProject,
    });

    await expect(pending).resolves.toBe(false);
    expect(bridge.closeThread).toHaveBeenCalledWith({
      threadId: expect.stringMatching(/^login:/u),
    });
    expect(toast.danger).toHaveBeenCalledWith("ACCOUNT_RUNTIME_UNSUPPORTED");
  });

  it("promotes a Grok login once the pending auth.json carries an identity and closes the overlay", async () => {
    loginTerminalStore.open.mockImplementation((session) => {
      loginTerminalStore.active = {
        shellId: session.shellId,
      };
    });
    const account = {
      accountId: "grok:1",
      provider: "grok",
      label: "New Grok",
      maskedIdentity: "person***@example.com",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:1",
    };
    bridge.pollGrokProfileLogin.mockResolvedValueOnce({ done: false });
    bridge.pollGrokProfileLogin.mockResolvedValueOnce({ done: true, account });
    bridge.listAccounts.mockResolvedValueOnce([account]);

    const pending = createAndRunGrokProfileLogin({ project: posixProject });
    await vi.waitFor(() => expect(bridge.startGrokProfileLogin).toHaveBeenCalledOnce());

    // First tick: no identity yet. Second tick: identity arrives → complete.
    vi.advanceTimersByTime(1100);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(bridge.completeGrokProfileLogin).toHaveBeenCalledOnce());
    await expect(pending).resolves.toBe(true);

    vi.advanceTimersByTime(1300);
    expect(loginTerminalStore.close).toHaveBeenCalled();
  });
});
