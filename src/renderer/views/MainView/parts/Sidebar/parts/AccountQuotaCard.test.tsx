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
