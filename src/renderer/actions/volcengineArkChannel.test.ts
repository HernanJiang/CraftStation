import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountView } from "@/shared/contracts";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { useUsageLoginStateStore } from "@/renderer/state/usageLoginStateStore";

const bridge = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  submitOpenAiCompatibleCredentials: vi.fn(),
  importOpenAiCompatibleProfile: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  danger: vi.fn(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));
vi.mock("@heroui/react", () => ({
  toast: toastMock,
}));

const {
  autoProvisionVolcengineArkChannel,
  VOLCENGINE_ARK_CHANNEL_LABEL,
  VOLCENGINE_ARK_CODING_BASE_URL,
} = await import("./volcengineArkChannel");

function arkAccount(): AccountView {
  return {
    accountId: "acc-1",
    provider: "openai-compatible",
    label: VOLCENGINE_ARK_CHANNEL_LABEL,
    providerAccountId: VOLCENGINE_ARK_CHANNEL_LABEL,
    status: "available",
    enabled: true,
  } as unknown as AccountView;
}

beforeEach(() => {
  vi.clearAllMocks();
  useUsageAccountsStore.getState().reset();
  useUsageLoginStateStore.getState().setAll({});
  bridge.listAccounts.mockResolvedValue([]);
  bridge.submitOpenAiCompatibleCredentials.mockResolvedValue({ ok: true });
  bridge.importOpenAiCompatibleProfile.mockResolvedValue(arkAccount());
});

describe("autoProvisionVolcengineArkChannel", () => {
  it("stages the Ark coding endpoint with the probed model and imports it", async () => {
    await autoProvisionVolcengineArkChannel({ apiKey: "ark-key", model: "doubao-seed-2.0-code" });
    expect(bridge.submitOpenAiCompatibleCredentials).toHaveBeenCalledWith({
      baseUrl: VOLCENGINE_ARK_CODING_BASE_URL,
      apiKey: "ark-key",
      providerName: VOLCENGINE_ARK_CHANNEL_LABEL,
      model: "doubao-seed-2.0-code",
    });
    expect(bridge.importOpenAiCompatibleProfile).toHaveBeenCalledWith({});
    expect(useUsageAccountsStore.getState().accounts).toEqual([]);
    expect(useUsageLoginStateStore.getState().stored["openai-compatible"]).toBe(true);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("skips creation when the channel already exists", async () => {
    bridge.listAccounts.mockResolvedValue([arkAccount()]);
    await autoProvisionVolcengineArkChannel({ apiKey: "ark-key", model: "doubao-seed-2.0-code" });
    expect(bridge.submitOpenAiCompatibleCredentials).not.toHaveBeenCalled();
    expect(bridge.importOpenAiCompatibleProfile).not.toHaveBeenCalled();
  });

  it("warns and keeps the login when the channel probe fails", async () => {
    bridge.submitOpenAiCompatibleCredentials.mockResolvedValue({ ok: false, error: "bad key" });
    await autoProvisionVolcengineArkChannel({ apiKey: "ark-key", model: "doubao-seed-2.0-code" });
    expect(bridge.importOpenAiCompatibleProfile).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
