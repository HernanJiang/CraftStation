import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AccountView, TokenUsageResponse, UsageSnapshot } from "@/shared/contracts";
import { useTokenUsageStore } from "@/renderer/state/tokenUsageStore";
import { AccountQuotaCard, ProviderQuotaCard } from "./AccountQuotaCard";

function compatibleAccount(overrides: Partial<AccountView> = {}): AccountView {
  return {
    accountId: "openai-compatible:chiral",
    provider: "openai-compatible",
    label: "Chiral",
    createdAt: 1,
    enabled: true,
    selected: false,
    order: 0,
    status: "available",
    credentialScopeRef: "managed:openai-compatible:chiral",
    ...overrides,
  };
}

function tokenResponse(accountId: string, input: number, output: number): TokenUsageResponse {
  const total = input + output;
  return {
    summaries: [
      {
        period: "allTime",
        source: "runtime-ledger",
        quality: "exact",
        observedAt: 1,
        coverage: { from: 0, to: 1, complete: true },
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: total,
        byTool: [],
        byModel: [],
        byProject: [],
        bySession: [],
        byAccount: [
          {
            key: accountId,
            label: accountId,
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            totalTokens: total,
          },
        ],
      },
    ],
    sources: [{ source: "runtime-ledger", quality: "exact", available: true }],
  };
}

function okEmptySnapshot(): UsageSnapshot {
  return { providerId: "opencode", status: "ok", plan: "Go", windows: [], fetchedAt: 1 };
}

describe("AccountQuotaCard openai-compatible", () => {
  beforeEach(() => {
    useTokenUsageStore.getState().reset();
  });

  it("omits quota windows and reset times for third-party compatible accounts", () => {
    render(<AccountQuotaCard account={compatibleAccount()} />);
    expect(screen.queryByText("暂无可用额度数据。")).not.toBeInTheDocument();
    expect(screen.queryByText(/恢复时间未知/)).not.toBeInTheDocument();
    expect(screen.getByTestId("account-meta-openai-compatible:chiral")).toHaveTextContent(
      "总用量 — · 输入 — · 输出 —",
    );
  });

  it("shows total, input, and output tokens when ledger data exists", () => {
    const account = compatibleAccount();
    useTokenUsageStore.getState().setResponse(tokenResponse(account.accountId, 1200, 340));
    render(<AccountQuotaCard account={account} />);
    expect(screen.getByTestId("account-meta-openai-compatible:chiral")).toHaveTextContent(
      "总用量 1.5k · 输入 1.2k · 输出 340",
    );
  });

  it("renders a real balance bar and amounts when the provider reports one", () => {
    // StepFun-style prepaid balance: ¥3 remaining of ¥15 granted → 80% used.
    const account = compatibleAccount({
      quotaWindows: [
        {
          id: "balance",
          label: "余额",
          usedPercent: 80,
          remaining: 3,
          limit: 15,
          used: 12,
          currency: "CNY",
        },
      ],
    });
    render(<AccountQuotaCard account={account} />);
    expect(screen.getByRole("progressbar", { name: "余额" })).toHaveAttribute(
      "aria-valuenow",
      "80",
    );
    const meta = screen.getByTestId("account-meta-openai-compatible:chiral");
    expect(meta).toHaveTextContent("余额");
    expect(meta).toHaveTextContent("总用量");
    // No fake reset countdown for a balance window.
    expect(meta).not.toHaveTextContent("恢复时间未知");
  });

  it("keeps the token-only row when the channel reports no quota", () => {
    render(<AccountQuotaCard account={compatibleAccount({ quotaWindows: [] })} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByTestId("account-meta-openai-compatible:chiral")).toHaveTextContent("总用量");
  });
});

describe("AccountQuotaCard reset card", () => {
  it("shows an unused reset card separately from the 100% weekly meter", () => {
    const onRedeem = vi.fn<(account: AccountView) => void>();
    const account: AccountView = {
      accountId: "codex:plus",
      provider: "codex",
      label: "Codex",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "quota-exhausted",
      credentialScopeRef: "managed:codex:plus",
      quotaWindows: [
        { id: "weekly", label: "Weekly", usedPercent: 100 },
        { id: "codex:reset-credits", label: "重置卡", usedPercent: 0, limit: 3 },
      ],
    };
    render(<AccountQuotaCard account={account} onRedeemResetCredit={onRedeem} />);
    expect(screen.getByRole("progressbar", { name: "Weekly" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.queryByRole("progressbar", { name: "重置卡" })).toBeNull();
    expect(screen.getByText(/重置卡 3 张未使用/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "使用重置卡" }));
    expect(onRedeem).toHaveBeenCalledWith(account);
  });
});

describe("ProviderQuotaCard connect action", () => {
  it("offers the connect action for authorized-but-meterless snapshots", () => {
    const onConnect = vi.fn<() => void>();
    render(
      <ProviderQuotaCard
        providerId="opencode"
        snapshot={okEmptySnapshot()}
        onConnectUsageSession={onConnect}
        connectLabel="连接 OpenCode 显示额度"
      />,
    );
    const button = screen.getByRole("button", { name: "连接 OpenCode 显示额度" });
    fireEvent.click(button);
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("hides the connect action once windows exist", () => {
    const onConnect = vi.fn<() => void>();
    render(
      <ProviderQuotaCard
        providerId="opencode"
        snapshot={{
          ...okEmptySnapshot(),
          windows: [{ id: "session-5h", label: "Rolling", usedPercent: 10 }],
        }}
        onConnectUsageSession={onConnect}
        connectLabel="连接 OpenCode 显示额度"
      />,
    );
    expect(screen.queryByRole("button", { name: "连接 OpenCode 显示额度" })).toBeNull();
  });

  it("hides the connect action for non-ok snapshots", () => {
    const onConnect = vi.fn<() => void>();
    render(
      <ProviderQuotaCard
        providerId="opencode"
        snapshot={{ ...okEmptySnapshot(), status: "auth-missing" }}
        onConnectUsageSession={onConnect}
        connectLabel="连接 OpenCode 显示额度"
      />,
    );
    expect(screen.queryByRole("button", { name: "连接 OpenCode 显示额度" })).toBeNull();
  });

  it("keeps the legacy empty text when no handler is provided", () => {
    render(<ProviderQuotaCard providerId="opencode" snapshot={okEmptySnapshot()} />);
    // Rendered twice: the empty-windows block and the meta line.
    expect(screen.getAllByText("暂无额度窗口")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the paste fallback next to the connect action", () => {
    const onConnect = vi.fn<() => void>();
    const onPaste = vi.fn<() => void>();
    render(
      <ProviderQuotaCard
        providerId="opencode"
        snapshot={okEmptySnapshot()}
        onConnectUsageSession={onConnect}
        connectLabel="连接 OpenCode 显示额度"
        onPasteCookie={onPaste}
      />,
    );
    const paste = screen.getByRole("button", { name: "改用粘贴 Cookie" });
    fireEvent.click(paste);
    expect(onPaste).toHaveBeenCalledOnce();
    expect(onConnect).not.toHaveBeenCalled();
  });
});
