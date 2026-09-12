import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UsageSnapshot } from "@/shared/contracts";
import { ProviderQuotaCard } from "./AccountQuotaCard";

function okEmptySnapshot(): UsageSnapshot {
  return { providerId: "opencode", status: "ok", plan: "Go", windows: [], fetchedAt: 1 };
}

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
