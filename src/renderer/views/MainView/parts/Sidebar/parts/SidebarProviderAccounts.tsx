import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Dropdown, Label, Modal, toast } from "@heroui/react";
import {
  Check,
  GripVertical,
  LogOut,
  MoreHorizontal,
  Power,
  RefreshCw,
  Settings2,
  Trash2,
  UserRoundPlus,
  X,
} from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useShallow } from "zustand/shallow";
import antigravityLogo from "@/renderer/assets/provider-logos/antigravity.png";
import claudeLogo from "@/renderer/assets/provider-logos/claude.png";
import commandCodeLogo from "@/renderer/assets/provider-logos/command-code.png";
import cursorLogo from "@/renderer/assets/provider-logos/cursor.svg";
import factoryDroidLogo from "@/renderer/assets/provider-logos/factory-droid.svg";
import geminiLogo from "@/renderer/assets/provider-logos/gemini.svg";
import githubCopilotLogo from "@/renderer/assets/provider-logos/github-copilot.svg";
import kimiCodeLogo from "@/renderer/assets/provider-logos/kimi-code.png";
import openAiLogo from "@/renderer/assets/provider-logos/openai.svg";
import openCodeLogo from "@/renderer/assets/provider-logos/opencode.png";
import qwenLogo from "@/renderer/assets/provider-logos/qwen.png";
import zaiLogo from "@/renderer/assets/provider-logos/zai.svg";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import {
  USAGE_PROVIDERS,
  type UsageProvider,
} from "@/renderer/components/providers/usageProviders";
import { useUsageProviderLogin } from "@/renderer/components/providers/useUsageProviderLogin";
import {
  createAndRunCodexProfileLogin,
  createAndRunGrokProfileLogin,
  runAgentLoginCommand,
  runCodexProfileLogin,
} from "@/renderer/actions/agentLoginActions";
import { refreshAndMergeProviderUsage } from "@/renderer/components/providers/refreshProviderUsageSnapshot";
import { useProviderUsage, useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { readBridge } from "@/renderer/bridge";
import { usePanelStore } from "@/renderer/state/panelStore";
import type { AccountView, UsageStatus } from "@/shared/contracts";

const PREFERRED_PROVIDER_ORDER = [
  "codex",
  "claude",
  "gemini",
  "copilot",
  "cursor",
  "grok",
  "kimi",
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  grok: "Grok",
  kimi: "Kimi Code",
};

type ProviderBrand = {
  background: string;
  logo: string;
  logoClassName?: string;
};

const PROVIDER_BRANDS: Record<string, ProviderBrand> = {
  "openai-compatible": {
    background: "#10A37F",
    logo: openAiLogo,
    logoClassName: "size-[66%] brightness-0 invert",
  },
  codex: {
    background: "#050505",
    logo: openAiLogo,
    logoClassName: "size-[66%] brightness-0 invert",
  },
  claude: {
    background: "#30211f",
    logo: claudeLogo,
    logoClassName: "size-[74%]",
  },
  gemini: {
    background: "#15161b",
    logo: geminiLogo,
    logoClassName: "size-[74%]",
  },
  copilot: {
    background: "#f6f8fa",
    logo: githubCopilotLogo,
    logoClassName: "size-[68%]",
  },
  cursor: {
    background: "#f7f7f4",
    logo: cursorLogo,
    logoClassName: "size-full",
  },
  grok: {
    background: "#000000",
    // Keep the original CraftStation Grok glyph instead of the x.ai favicon.
    logo: "",
  },
  kimi: {
    background: "#f8f8f8",
    logo: kimiCodeLogo,
    logoClassName: "size-full",
  },
  antigravity: {
    background: "#15161b",
    logo: antigravityLogo,
    logoClassName: "size-[82%]",
  },
  commandcode: {
    background: "#000000",
    logo: commandCodeLogo,
    logoClassName: "size-full",
  },
  factory: {
    background: "#020202",
    logo: factoryDroidLogo,
    logoClassName: "size-full",
  },
  opencode: {
    background: "#121112",
    logo: openCodeLogo,
    logoClassName: "size-full",
  },
  zai: {
    background: "#2d2d2f",
    logo: zaiLogo,
    logoClassName: "size-full",
  },
  qwen: {
    background: "#f2f5ff",
    logo: qwenLogo,
    logoClassName: "size-[72%]",
  },
};

const FALLBACK_PROVIDER_BRAND: ProviderBrand = {
  background: "#202126",
  logo: "",
};

const DEFAULT_AVATAR_PROVIDER_IDS = ["codex", "claude", "gemini"] as const;
const AUTHORIZED_USAGE_STATUSES = new Set<UsageStatus>([
  "ok",
  "app-not-running",
  "rate-limited",
  "quota-hit",
  "error",
]);
const CODEX_LOGIN_REQUIRED_STATUSES = new Set(["auth-expired", "unavailable", "error"]);

/**
 * Usage cards also act as the entry point to the provider's real auth flow.
 * These providers authenticate through their CLI rather than the browser
 * usage-session collector, so the card must open the same login terminal used
 * by Settings instead of falling through to a dead placeholder.
 */
const CLI_LOGIN_COMMANDS: Record<string, string> = {
  claude: "claude auth login",
  gemini: "gemini /auth",
  cursor: "cursor-agent login",
  kimi: "kimi acp --login",
  antigravity: "agy",
  commandcode: "command-code login",
  opencode: "opencode providers login",
};

function isAuthorizedUsageStatus(status: UsageStatus | undefined): boolean {
  return status !== undefined && AUTHORIZED_USAGE_STATUSES.has(status);
}

function sortProviders(providers: ReadonlyArray<UsageProvider>): UsageProvider[] {
  const priority = new Map<string, number>(
    PREFERRED_PROVIDER_ORDER.map((id, index) => [id, index]),
  );
  return [...providers].sort((left, right) => {
    const leftPriority = priority.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priority.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.label.localeCompare(right.label);
  });
}

const SORTED_USAGE_PROVIDERS = sortProviders(USAGE_PROVIDERS);

function providerLabel(id: string, fallback?: string): string {
  return PROVIDER_LABELS[id] ?? fallback ?? id;
}

function ProviderBadge(props: {
  id: string;
  label: string;
  iconKind?: string;
  size?: "avatar" | "card";
  stackIndex?: number;
}) {
  const brand = PROVIDER_BRANDS[props.id] ?? FALLBACK_PROVIDER_BRAND;
  const isAvatar = props.size === "avatar";
  return (
    <span
      className={`craftstation-provider-brand flex shrink-0 items-center justify-center overflow-hidden rounded-full ${
        isAvatar
          ? `${props.stackIndex ? "-ml-1.5" : ""} size-[18px] border-[1.5px] border-[#121214]`
          : "size-10 border border-white/8"
      }`}
      style={
        {
          background: brand.background,
          zIndex: props.stackIndex == null ? undefined : 10 - props.stackIndex,
        } as CSSProperties
      }
      title={props.label}
      aria-hidden="true"
    >
      {brand.logo ? (
        <img
          src={brand.logo}
          alt=""
          draggable={false}
          data-provider-logo={props.id}
          className={`shrink-0 object-contain ${brand.logoClassName ?? "size-[70%]"}`}
        />
      ) : (
        <ProviderIcon
          kind={props.iconKind ?? props.id}
          fallbackLabel={props.label}
          className={isAvatar ? "size-2.5" : "size-5"}
        />
      )}
    </span>
  );
}

function AuthorizedModelsAvatarGroup() {
  const authorizedProviderIds = useProviderUsageStore(
    useShallow((state) =>
      SORTED_USAGE_PROVIDERS.flatMap((provider) =>
        isAuthorizedUsageStatus(state.snapshots[provider.id]?.status) ? [provider.id] : [],
      ),
    ),
  );
  const providerIds =
    authorizedProviderIds.length > 0 ? authorizedProviderIds : [...DEFAULT_AVATAR_PROVIDER_IDS];
  const visibleProviderIds = providerIds.slice(0, 3);
  const overflowCount = providerIds.length - visibleProviderIds.length;

  return (
    <span className="flex shrink-0 items-center" aria-hidden="true">
      {visibleProviderIds.map((id, index) => (
        <ProviderBadge
          key={id}
          id={id}
          label={providerLabel(
            id,
            SORTED_USAGE_PROVIDERS.find((provider) => provider.id === id)?.label,
          )}
          size="avatar"
          stackIndex={index}
        />
      ))}
      {overflowCount > 0 ? (
        <span
          className="-ml-1.5 flex size-[18px] items-center justify-center rounded-full border-[1.5px] border-[#121214] bg-[#292A30] text-[8px] font-semibold text-neutral-300"
          title={`另有 ${overflowCount} 个已授权模型`}
          style={{ zIndex: 6 }}
        >
          +{overflowCount}
        </span>
      ) : null}
    </span>
  );
}

function UsageBar(props: { label: string; value: number | null }) {
  const value = props.value == null ? null : Math.max(0, Math.min(100, Math.round(props.value)));
  return (
    <div className="grid grid-cols-[72px_1fr_36px] items-center gap-2 text-[10px] text-neutral-400">
      <span>{props.label}</span>
      <span className="h-[3.5px] overflow-hidden rounded-full bg-white/10">
        {value == null ? null : (
          <span
            className="block h-full rounded-full bg-neutral-300"
            style={{ width: `${value}%` }}
          />
        )}
      </span>
      <span className="text-right tabular-nums">{value == null ? "--%" : `${value}%`}</span>
    </div>
  );
}

function OpenAiCompatibleCard() {
  return (
    <article
      data-testid="provider-card-openai-compatible"
      data-grid-span="1"
      className="col-span-1 flex min-h-[88px] items-center gap-2.5 rounded-xl border border-white/5 bg-[#1c1d22] p-3"
    >
      <ProviderBadge id="openai-compatible" iconKind="codex" label="OpenAI 兼容账户" size="card" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-foreground">OpenAI 兼容账户</h3>
        <p className="mt-0.5 truncate text-[10px] text-neutral-400">自定义 Base URL 与 API Key</p>
      </div>
      <button
        type="button"
        onClick={() => usePanelStore.getState().openSettingsSection("agents")}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-white/5 px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-white/10"
      >
        <UserRoundPlus className="size-3.5" />
        登录/授权
      </button>
    </article>
  );
}

function ProviderCard(props: { id: string; label: string }) {
  const snapshot = useProviderUsage(props.id);
  const managedAccounts = useUsageAccountsStore(
    useShallow((state) =>
      props.id === "codex" || props.id === "grok"
        ? state.accounts.filter(
            (account) =>
              account.provider === props.id &&
              (Boolean(account.maskedIdentity) || Boolean(account.providerAccountId)),
          )
        : [],
    ),
  );
  const {
    canSignIn,
    canReauthenticate,
    canApiKeySignIn,
    canManageApiKey,
    apiKey,
    setApiKey,
    handleSubmitApiKey,
    canSignOut,
    handleSignOut,
    signingIn,
    handleSignIn,
  } = useUsageProviderLogin(props.id);
  const [cliSigningIn, setCliSigningIn] = useState(false);
  const [accountActionInFlight, setAccountActionInFlight] = useState<string | null>(null);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const connected =
    snapshot?.status === "ok" ||
    snapshot?.status === "quota-hit" ||
    snapshot?.status === "rate-limited";
  const fastWindow =
    snapshot?.windows.find((window) => window.id.includes("5h")) ?? snapshot?.windows[0];
  const longWindow =
    snapshot?.windows.find((window) => /week|month/i.test(window.id)) ?? snapshot?.windows[1];
  const label = providerLabel(props.id, props.label);
  const stateLabel =
    snapshot?.status === "quota-hit"
      ? "额度耗尽"
      : snapshot?.status === "rate-limited"
        ? "受限"
        : "活跃";
  const stateClass =
    snapshot?.status === "quota-hit"
      ? "bg-amber-400/10 text-amber-300"
      : snapshot?.status === "rate-limited"
        ? "bg-sky-400/10 text-sky-300"
        : "bg-emerald-400/10 text-emerald-300";

  const handleAccountAction = () => {
    if (props.id === "codex") {
      // Codex accounts must never use the process-global `codex login` path:
      // each account owns an isolated supervisor-managed CODEX_HOME.
      setCliSigningIn(true);
      void createAndRunCodexProfileLogin({ label: "New Codex" }).finally(() =>
        setCliSigningIn(false),
      );
      return;
    }
    if (props.id === "grok") {
      // Grok follows the same isolated-profile rule as Codex: the official
      // `grok login --device-auth` runs inside a pending managed GROK_HOME and
      // only becomes an account once the auth file carries an identity.
      setCliSigningIn(true);
      void createAndRunGrokProfileLogin({ label: "New Grok" }).finally(() =>
        setCliSigningIn(false),
      );
      return;
    }
    const cliCommand = CLI_LOGIN_COMMANDS[props.id];
    if (cliCommand) {
      // CLI-backed providers use the same login terminal as Settings. This is
      // a real command, not a placeholder notification.
      setCliSigningIn(true);
      const opened = runAgentLoginCommand({
        label,
        command: cliCommand,
        onCommandComplete: (exitCode) => {
          setCliSigningIn(false);
          if (exitCode === 0) void refreshAndMergeProviderUsage(props.id);
        },
      });
      if (!opened) setCliSigningIn(false);
      return;
    }
    if (canApiKeySignIn || canManageApiKey) {
      setApiKeyOpen(true);
      return;
    }
    if (canSignIn || canReauthenticate) {
      void handleSignIn();
      return;
    }
    toast.info(`${label} 当前没有可用的登录方式，请先在设置中配置授权。`);
    usePanelStore.getState().openSettingsSection("usage");
  };

  const refreshManagedAccounts = async () => {
    const next = await readBridge().listAccounts({ provider: props.id });
    const current = useUsageAccountsStore.getState().accounts;
    useUsageAccountsStore
      .getState()
      .setAccounts([...current.filter((account) => account.provider !== props.id), ...next]);
  };

  const selectCompactAccount = async (account: AccountView) => {
    setAccountActionInFlight(account.accountId);
    try {
      await readBridge().setAccountEnabled({ accountId: account.accountId, enabled: true });
      await readBridge().selectAccount({ accountId: account.accountId });
      await refreshManagedAccounts();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "无法选择账号。");
    } finally {
      setAccountActionInFlight(null);
    }
  };

  const renameCompactAccount = async (account: AccountView) => {
    const nextLabel = window.prompt("重命名账号", account.label);
    if (nextLabel === null) return;
    const normalizedLabel = nextLabel.trim();
    if (!normalizedLabel) {
      toast.danger("账号名称不能为空。");
      return;
    }
    setAccountActionInFlight(account.accountId);
    try {
      await readBridge().renameAccount({
        accountId: account.accountId,
        label: normalizedLabel,
      });
      await refreshManagedAccounts();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "无法重命名账号。");
    } finally {
      setAccountActionInFlight(null);
    }
  };

  return (
    <article
      data-testid={`provider-card-${props.id}`}
      data-grid-span={connected ? "2" : "1"}
      className={`rounded-xl border border-white/5 bg-[#1c1d22] p-3 transition-[min-height] duration-200 ${
        connected ? "col-span-2 min-h-[170px]" : "col-span-1 min-h-[76px]"
      }`}
    >
      <header className="flex items-center gap-3">
        <ProviderBadge id={props.id} label={label} size="card" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">{label}</h3>
          {connected && snapshot?.plan ? (
            <p className="mt-0.5 truncate text-[10px] text-neutral-400">{snapshot.plan}</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={signingIn || cliSigningIn}
          onClick={handleAccountAction}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-white/5 px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          <UserRoundPlus className="size-3.5" />
          {cliSigningIn || signingIn
            ? "登录中…"
            : connected || canReauthenticate
              ? apiKeyOpen
                ? "收起"
                : "添加账号"
              : "登录/授权"}
        </button>
      </header>

      {managedAccounts.length > 0 ? (
        <div className="mt-2 space-y-1 rounded-lg border border-white/5 bg-black/10 p-1.5">
          {managedAccounts.map((account) => (
            <div
              key={account.accountId}
              data-testid={`compact-account-row-${account.accountId}`}
              role="button"
              tabIndex={0}
              aria-label={`${account.label} ${label}账号`}
              onClick={() => void selectCompactAccount(account)}
              onContextMenu={(event) => {
                event.preventDefault();
                void renameCompactAccount(account);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void selectCompactAccount(account);
                }
              }}
              className={`flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-white/5 ${accountActionInFlight === account.accountId ? "opacity-60" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate text-[9px] text-neutral-400">
                {account.label}
              </span>
              {CODEX_LOGIN_REQUIRED_STATUSES.has(account.status) ? (
                <button
                  type="button"
                  disabled={cliSigningIn || accountActionInFlight !== null || !account.enabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    setCliSigningIn(true);
                    const login =
                      props.id === "grok"
                        ? createAndRunGrokProfileLogin({ label: account.label })
                        : runCodexProfileLogin({
                            accountId: account.accountId,
                            label: account.label,
                          });
                    void login.finally(() => setCliSigningIn(false));
                  }}
                  className="shrink-0 rounded-md bg-white/5 px-1.5 py-1 text-[9px] text-neutral-300 hover:bg-white/10 disabled:opacity-50"
                  aria-label={`${account.label} 登录授权`}
                >
                  登录授权
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {connected ? (
        <div className="mt-3 rounded-xl border border-white/5 bg-[#17181c] p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {snapshot?.authenticatedAs ?? "已绑定账户"}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${stateClass}`}>
              {stateLabel}
            </span>
            <Dropdown>
              <Dropdown.Trigger
                aria-label={`${label} account actions`}
                className="rounded-lg p-1 text-neutral-400 hover:bg-white/5 hover:text-foreground"
              >
                <MoreHorizontal className="size-3.5" />
              </Dropdown.Trigger>
              <Dropdown.Popover placement="bottom end" className="min-w-[180px] rounded-[14px]">
                <Dropdown.Menu
                  aria-label={`${label} account actions`}
                  onAction={(key) => {
                    if (key === "refresh") {
                      void refreshAndMergeProviderUsage(props.id);
                    } else if (key === "remove" && canSignOut) {
                      void handleSignOut();
                    } else if (key === "preferred") {
                      toast.success(`${label} 当前授权已作为默认使用方式。`);
                    }
                  }}
                >
                  <Dropdown.Item id="preferred" textValue="设为首选">
                    <Check className="size-4 text-muted" />
                    <Label>设为首选</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="refresh" textValue="刷新状态">
                    <RefreshCw className="size-4 text-muted" />
                    <Label>刷新状态</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="remove" textValue="移除账号">
                    <LogOut className="size-4 text-muted" />
                    <Label>移除账号</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
          <div className="mt-2 space-y-1.5">
            <UsageBar label="5h 限额" value={fastWindow?.usedPercent ?? null} />
            <UsageBar label="周/月限额" value={longWindow?.usedPercent ?? null} />
          </div>
        </div>
      ) : null}
      {apiKeyOpen ? (
        <form
          className="mt-3 flex items-center gap-2 rounded-xl border border-white/5 bg-[#17181c] p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmitApiKey().then((success) => {
              if (success) setApiKeyOpen(false);
            });
          }}
        >
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={`粘贴 ${label} API Key`}
            aria-label={`${label} API Key`}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-white/25"
          />
          <button
            type="submit"
            disabled={signingIn || apiKey.trim().length === 0}
            className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] text-foreground hover:bg-white/15 disabled:opacity-50"
          >
            {signingIn ? "保存中…" : "保存授权"}
          </button>
        </form>
      ) : null}
    </article>
  );
}

interface AccountRowProps {
  account: AccountView;
  busy: boolean;
  onReauth?: ((account: AccountView) => void) | undefined;
  onSelect: (account: AccountView) => void;
  onRename: (account: AccountView) => void;
  onRefresh: (account: AccountView) => void;
  onToggleEnabled: (account: AccountView) => void;
  onRemove: (account: AccountView) => void;
  onDragStart: (accountId: string) => void;
  onDrop: (accountId: string) => void;
}

function AccountRow(props: AccountRowProps) {
  const { account, busy, onReauth } = props;
  return (
    <div
      key={account.accountId}
      draggable
      onDragStart={() => props.onDragStart(account.accountId)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => props.onDrop(account.accountId)}
      onClick={() => props.onSelect(account)}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onRename(account);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(account);
        }
      }}
      role="button"
      tabIndex={0}
      className="flex items-center gap-2 rounded-lg border border-white/5 bg-[#17181c] px-2 py-1.5"
    >
      <GripVertical className="size-3.5 shrink-0 text-neutral-500" aria-label="拖拽排序" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-foreground">{account.label}</p>
        <p className="truncate text-[9px] text-neutral-500">{account.maskedIdentity ?? "未认证"}</p>
      </div>
      <span className="text-[9px] text-neutral-400">{account.status}</span>
      {CODEX_LOGIN_REQUIRED_STATUSES.has(account.status) && account.enabled && onReauth ? (
        <button
          type="button"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onReauth(account);
          }}
          className="rounded px-1.5 py-1 text-[9px] text-neutral-300 hover:bg-white/10 disabled:opacity-50"
          aria-label={`${account.label} 登录授权`}
        >
          登录授权
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy || !account.enabled}
        onClick={(event) => {
          event.stopPropagation();
          props.onSelect(account);
        }}
        className="rounded px-1.5 py-1 text-[9px] text-neutral-300 hover:bg-white/10 disabled:opacity-50"
      >
        {account.selected ? "首选" : "设为首选"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          props.onRefresh(account);
        }}
        className="rounded p-1 text-neutral-400 hover:bg-white/10 disabled:opacity-50"
        aria-label="刷新账号配额"
      >
        <RefreshCw className="size-3" />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          props.onToggleEnabled(account);
        }}
        className="rounded p-1 text-neutral-400 hover:bg-white/10 disabled:opacity-50"
        aria-label={account.enabled ? "禁用账号" : "启用账号"}
      >
        <Power className={`size-3 ${account.enabled ? "text-emerald-300" : ""}`} />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          props.onRemove(account);
        }}
        className="rounded p-1 text-neutral-400 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
        aria-label="移除账号"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

interface ManagedAccountPoolProps {
  providerId: string;
  title: string;
  badgeLabel: string;
  addAriaLabel: string;
  accounts: AccountView[];
  busy: boolean;
  actionError: string | null;
  onAdd: () => void;
  onImport?: () => void;
  importAriaLabel?: string;
  onReauth?: ((account: AccountView) => void) | undefined;
  onSelect: (account: AccountView) => void;
  onRename: (account: AccountView) => void;
  onRefresh: (account: AccountView) => void;
  onToggleEnabled: (account: AccountView) => void;
  onRemove: (account: AccountView) => void;
  onDragStart: (accountId: string) => void;
  onDrop: (accountId: string) => void;
}

function ManagedAccountPool(props: ManagedAccountPoolProps) {
  const { providerId, title, badgeLabel, addAriaLabel, accounts, busy, actionError } = props;
  return (
    <section
      data-testid={`provider-card-${providerId}`}
      data-grid-span="2"
      className="col-span-2 rounded-xl border border-white/5 bg-[#1c1d22] p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProviderBadge id={providerId} label={badgeLabel} size="card" />
          <div className="min-w-0">
            <h3 className="truncate text-xs font-semibold text-foreground">{title}</h3>
            <p className="mt-0.5 truncate text-[10px] text-neutral-400">首选账号与自动回退顺序</p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={props.onAdd}
          aria-label={addAriaLabel}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-white/5 px-2 text-[10px] text-foreground hover:bg-white/10 disabled:opacity-50"
        >
          <UserRoundPlus className="size-3" /> 添加账号
        </button>
        {props.onImport ? (
          <button
            type="button"
            disabled={busy}
            onClick={props.onImport}
            aria-label={props.importAriaLabel}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-white/5 px-2 text-[10px] text-foreground hover:bg-white/10 disabled:opacity-50"
          >
            导入本机登录
          </button>
        ) : null}
      </div>
      {actionError ? <p className="mb-2 text-[10px] text-red-300">{actionError}</p> : null}
      {accounts.length === 0 ? (
        <p className="rounded-lg bg-black/10 p-3 text-[10px] text-neutral-400">
          尚未添加 {badgeLabel} 账号
        </p>
      ) : (
        <div className="space-y-1.5">
          {accounts.map((account) => (
            <AccountRow
              key={account.accountId}
              account={account}
              busy={busy}
              onReauth={props.onReauth}
              onSelect={props.onSelect}
              onRename={props.onRename}
              onRefresh={props.onRefresh}
              onToggleEnabled={props.onToggleEnabled}
              onRemove={props.onRemove}
              onDragStart={props.onDragStart}
              onDrop={props.onDrop}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ModelUsageDialog() {
  const open = usePanelStore((state) => state.modelUsageDialogOpen);
  const close = usePanelStore((state) => state.closeModelUsageDialog);
  const accounts = useUsageAccountsStore((state) => state.accounts);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draggedAccountId, setDraggedAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const bridge = readBridge();
    if (!bridge || typeof bridge.listAccounts !== "function") return;
    void bridge
      .listAccounts({})
      .then((next) => useUsageAccountsStore.getState().setAccounts(next))
      .catch((error) => {
        setActionError(error instanceof Error ? error.message : String(error));
      });
  }, [open]);

  const accountActions = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const codexAccounts = accounts.filter((account) => account.provider === "codex");
  const grokAccounts = accounts.filter((account) => account.provider === "grok");
  const signedInCodexAccounts = useMemo(
    () =>
      codexAccounts.filter(
        (account) =>
          Boolean(account.credentialScopeRef) ||
          Boolean(account.maskedIdentity) ||
          Boolean(account.providerAccountId),
      ),
    [codexAccounts],
  );
  const signedGrokAccounts = useMemo(
    () =>
      grokAccounts.filter(
        (account) =>
          Boolean(account.credentialScopeRef) ||
          Boolean(account.maskedIdentity) ||
          Boolean(account.providerAccountId),
      ),
    [grokAccounts],
  );
  const refreshAccountList = async () => {
    const next = await readBridge().listAccounts({});
    useUsageAccountsStore.getState().setAccounts(next);
    return next;
  };
  const renameAccount = async (account: AccountView) => {
    const nextLabel = window.prompt("重命名账号", account.label);
    if (nextLabel === null) return;
    const label = nextLabel.trim();
    if (!label) throw new Error("账号名称不能为空。");
    await readBridge().renameAccount({ accountId: account.accountId, label });
    await refreshAccountList();
  };
  const selectAccount = async (account: AccountView) => {
    // Selecting a row is a recoverable user choice. Re-enable only this row
    // before making it selected; do not mutate the rest of the provider pool.
    await readBridge().setAccountEnabled({ accountId: account.accountId, enabled: true });
    await readBridge().selectAccount({ accountId: account.accountId });
    await refreshAccountList();
  };
  const createCodexProfile = async () => {
    await createAndRunCodexProfileLogin({ label: "New Codex" });
  };
  const createGrokProfile = async () => {
    await createAndRunGrokProfileLogin({ label: "New Grok" });
  };
  const importHostCodexLogin = async () => {
    const account = await readBridge().importCodexProfile({
      label: "本机 Codex",
    });
    await refreshAccountList();
    toast.success(
      account.status === "available"
        ? "已导入本机 Codex / ChatGPT 登录（开发期复用，不含 Codex-Router catalog）"
        : "已创建账号，但本机 ~/.codex/auth.json 无法解析",
    );
  };
  const reorder = (targetId: string, provider = "codex") => {
    if (!draggedAccountId || draggedAccountId === targetId) return;
    const pool = provider === "grok" ? grokAccounts : codexAccounts;
    const ordered = [...pool].sort((a, b) => a.order - b.order);
    const from = ordered.findIndex((account) => account.accountId === draggedAccountId);
    const to = ordered.findIndex((account) => account.accountId === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved!);
    void accountActions(async () => {
      await readBridge().reorderAccounts({
        provider,
        orderedAccountIds: ordered.map((account) => account.accountId),
      });
      await refreshAccountList();
    });
  };
  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <Modal.Container size="sm">
        <Modal.Dialog className="relative w-[calc(100vw-48px)] max-w-[1120px] overflow-hidden rounded-[20px] border border-white/7 bg-[#17181c]">
          <button
            type="button"
            onClick={close}
            aria-label="关闭模型与用量"
            className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
          <Modal.Header className="pr-14">
            <Modal.Icon className="bg-white/5 text-foreground">
              <span className="text-lg leading-none" aria-hidden="true">
                🔑
              </span>
            </Modal.Icon>
            <div>
              <Modal.Heading>模型与用量</Modal.Heading>
              <p className="mt-1 text-xs font-normal text-neutral-400">
                管理各厂商订阅与多账号池状态，并查看每个账户的独立用量。
              </p>
            </div>
          </Modal.Header>
          <Modal.Body className="max-h-[72vh] overflow-y-auto">
            <div className="grid grid-cols-4 gap-3" data-testid="provider-grid">
              {signedInCodexAccounts.length > 0 ? (
                <ManagedAccountPool
                  providerId="codex"
                  title="ChatGPT 账号池"
                  badgeLabel="ChatGPT"
                  addAriaLabel="添加 ChatGPT 账号"
                  accounts={signedInCodexAccounts}
                  busy={busy}
                  actionError={actionError}
                  onAdd={() => void accountActions(createCodexProfile)}
                  onImport={() => void accountActions(importHostCodexLogin)}
                  importAriaLabel="导入本机 Codex 登录"
                  onReauth={(account) =>
                    void accountActions(async () => {
                      await runCodexProfileLogin({
                        accountId: account.accountId,
                        label: account.label,
                      });
                    })
                  }
                  onSelect={(account) => void accountActions(() => selectAccount(account))}
                  onRename={(account) => void accountActions(() => renameAccount(account))}
                  onRefresh={(account) =>
                    void accountActions(async () => {
                      await readBridge().refreshAccountQuota({ accountId: account.accountId });
                      await refreshAccountList();
                    })
                  }
                  onToggleEnabled={(account) =>
                    void accountActions(async () => {
                      await readBridge().setAccountEnabled({
                        accountId: account.accountId,
                        enabled: !account.enabled,
                      });
                      await refreshAccountList();
                    })
                  }
                  onRemove={(account) =>
                    void accountActions(async () => {
                      await readBridge().removeAccount({ accountId: account.accountId });
                      await refreshAccountList();
                    })
                  }
                  onDragStart={(accountId) => setDraggedAccountId(accountId)}
                  onDrop={(accountId) => reorder(accountId, "grok")}
                />
              ) : (
                <ProviderCard id="codex" label="ChatGPT" />
              )}
              {signedGrokAccounts.length > 0 ? (
                <ManagedAccountPool
                  providerId="grok"
                  title="Grok 账号池"
                  badgeLabel="Grok"
                  addAriaLabel="添加 Grok 账号"
                  accounts={signedGrokAccounts}
                  busy={busy}
                  actionError={actionError}
                  onAdd={() => void accountActions(createGrokProfile)}
                  onReauth={(account) =>
                    void accountActions(async () => {
                      await createAndRunGrokProfileLogin({ label: account.label });
                    })
                  }
                  onSelect={(account) => void accountActions(() => selectAccount(account))}
                  onRename={(account) => void accountActions(() => renameAccount(account))}
                  onRefresh={(account) =>
                    void accountActions(async () => {
                      await readBridge().refreshAccountQuota({ accountId: account.accountId });
                      await refreshAccountList();
                    })
                  }
                  onToggleEnabled={(account) =>
                    void accountActions(async () => {
                      await readBridge().setAccountEnabled({
                        accountId: account.accountId,
                        enabled: !account.enabled,
                      });
                      await refreshAccountList();
                    })
                  }
                  onRemove={(account) =>
                    void accountActions(async () => {
                      await readBridge().removeAccount({ accountId: account.accountId });
                      await refreshAccountList();
                    })
                  }
                  onDragStart={(accountId) => setDraggedAccountId(accountId)}
                  onDrop={(accountId) => reorder(accountId)}
                />
              ) : (
                <ProviderCard id="grok" label="Grok" />
              )}
              <OpenAiCompatibleCard />
              {SORTED_USAGE_PROVIDERS.filter(
                (provider) => provider.id !== "codex" && provider.id !== "grok",
              ).map((provider) => (
                <ProviderCard key={provider.id} id={provider.id} label={provider.label} />
              ))}
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function SidebarProviderAccounts() {
  const { t } = useLingui();

  return (
    <>
      <div className="shrink-0 border-t border-[var(--hairline)] px-1 pb-1 pt-1.5">
        <div className="flex items-center gap-1 rounded-xl py-1">
          <button
            type="button"
            onClick={() => usePanelStore.getState().openModelUsageDialog()}
            aria-label={t`Provider accounts`}
            className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--row-hover)]"
          >
            <AuthorizedModelsAvatarGroup />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-neutral-200 transition-colors group-hover:text-white">
                模型与用量
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-neutral-400 transition-colors group-hover:text-neutral-200">
                ✨ 添加新模型
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label={t`Settings`}
            onClick={() => usePanelStore.getState().openSettings()}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[11px] text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
          >
            <Settings2 className="size-3.5" />
            <span>{t`Settings`}</span>
          </button>
        </div>
      </div>
      <ModelUsageDialog />
    </>
  );
}
