import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Input, Label, Modal, TextField, toast } from "@heroui/react";
import {
  GripVertical,
  Pencil,
  Power,
  RefreshCw,
  Settings,
  Trash2,
  UserRoundPlus,
  X,
} from "lucide-react";
import { useShallow } from "zustand/shallow";
import "@/renderer/components/providers/bootstrap";
import { ProviderBrandBadge, providerLabel } from "./providerBrands";
import {
  cookiePasteUrl,
  needsBrowserSessionForUsage,
  resolveDisplayedProviders,
} from "@/renderer/components/providers/usageProviders";
import { openExternalWithFeedback } from "@/renderer/utils/openExternal";
import { useUsageProviderLogin } from "@/renderer/components/providers/useUsageProviderLogin";
import {
  createAndRunCodexProfileLogin,
  createAndRunGrokProfileLogin,
  createAndRunKimiProfileLogin,
  runAgentLoginCommand,
  runCodexProfileLogin,
  runKimiProfileLogin,
  signInAndImportAntigravityAccount,
} from "@/renderer/actions/agentLoginActions";
import { autoProvisionVolcengineArkChannel } from "@/renderer/actions/volcengineArkChannel";
import { refreshAndMergeProviderUsage } from "@/renderer/components/providers/refreshProviderUsageSnapshot";
import { useProviderUsage, useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useTokenUsageStore } from "@/renderer/state/tokenUsageStore";
import {
  setAccountsUnlessEmptyWipe,
  useUsageAccountsStore,
} from "@/renderer/state/usageAccountsStore";
import {
  flushSharedSettings,
  useSharedSettings,
  waitForPendingSharedSettings,
} from "@/renderer/state/sharedSettingsStore";
import {
  accountQuotaFailureMessage,
  hasAccountQuotaValue,
  type AccountUsageQueryState,
} from "./AccountUsageGrid";
import { readBridge } from "@/renderer/bridge";
import brandLogoUrl from "@/renderer/assets/craftstation-logo.png";
import { currentWslDistros } from "@/renderer/utils/acpRegistryAuth";
import { usePanelStore, type ModelUsageWorkspaceTab } from "@/renderer/state/panelStore";
import {
  useHasStoredSession,
  useUsageLoginStateStore,
} from "@/renderer/state/usageLoginStateStore";
import type { AccountView, UsageSnapshot } from "@/shared/contracts";
import { AccountQuotaCard, ProviderQuotaCard } from "./AccountQuotaCard";
import { ModelManagementPage } from "./ModelManagementPage";
import { UsageStatsPage } from "./UsageStatsPage";
import { CraftingWorkbenchPage } from "@/renderer/components/crafting/CraftingWorkbenchPage";
import { resolveConfiguredProviderIds } from "@/renderer/crafting/configuredProviders";
import { MyRecipesPage } from "@/renderer/components/crafting/MyRecipesPage";

const CLI_LOGIN_COMMANDS: Record<string, string> = {
  claude: "claude auth login",
  gemini: "gemini /auth",
  cursor: "cursor-agent login",
  kimi: "kimi acp --login",
  // CLI v1.38.2 的真实登录命令（"cmdc auth login" 是其内部过时提示，会报参数错误）。
  commandcode: "cmdc login",
  // Official OpenCode login writes ~/.local/share/opencode/auth.json. Cookie
  // paste remains a last-resort fallback, not the primary path.
  opencode: "opencode auth login",
  devin: "devin auth login",
};

function isAuthorizedUsageStatus(status: string | undefined): boolean {
  return status === "ok" || status === "quota-hit" || status === "rate-limited";
}

function hasProviderIdentity(snapshot: UsageSnapshot | undefined): boolean {
  return Boolean(snapshot?.authenticatedAs?.trim() || snapshot?.plan?.trim());
}

function accountIdentity(account: AccountView): string {
  return account.providerAccountId?.trim() || account.maskedIdentity?.trim() || "账号身份未知";
}

/**
 * Kimi 账号池默认标签（创建/导入时写入）。命中这些标签说明用户还没写备注，
 * 行标题继续显示接口身份；一旦用户自定义备注就优先显示备注。
 */
const DEFAULT_KIMI_LABELS = new Set(["New Kimi", "本机 Kimi"]);

async function submitKimiApiKey(input: {
  apiKey: string;
  onImported?: ((accountId: string) => void) | undefined;
}): Promise<boolean> {
  const key = input.apiKey.trim();
  if (!key) return false;
  try {
    const account = await readBridge().importKimiApiKey({ label: "New Kimi", apiKey: key });
    const refreshed = await readBridge().listAccounts({ provider: "kimi" });
    const current = useUsageAccountsStore.getState().accounts;
    useUsageAccountsStore
      .getState()
      .setAccounts([...current.filter((row) => row.provider !== "kimi"), ...refreshed]);
    await refreshAndMergeProviderUsage("kimi");
    toast.success("已用 API Key 添加 Kimi Code 账号");
    if (account.accountId) input.onImported?.(account.accountId);
    return true;
  } catch (error) {
    toast.danger(error instanceof Error ? error.message : "无法保存 Kimi API Key。");
    return false;
  }
}

/**
 * 池行主标题。Kimi 官方接口（已对 live 用量端点 + JWT claims 实测）不返回账号
 * 邮箱，只有不透明 user_id；用户在创建时填写的备注（建议邮箱）是行内唯一可读
 * 身份，因此 Kimi 行优先显示自定义备注，其他渠道保持接口身份不变。
 */
function poolRowTitle(account: AccountView): string {
  const identity = accountIdentity(account);
  const label = account.label.trim();
  if (
    account.provider === "kimi" &&
    label &&
    !DEFAULT_KIMI_LABELS.has(label) &&
    label !== identity
  ) {
    return label;
  }
  return identity;
}

/**
 * An account row without any resolvable identity is a stale cache left by an
 * interrupted login (seen on OpenCode): it can never select a working session,
 * so it must render as an inert, removable row instead of a normal entry.
 * A row whose auth merely expired stays recoverable through its 登录授权
 * action, so only rows where nothing ever resolved (no identity, never
 * available, never probed) count as stale.
 */
function isStaleCachedAccount(account: AccountView): boolean {
  return !account.providerAccountId?.trim() && !account.maskedIdentity?.trim();
}

/**
 * One reorderable channel card in the authorized grid. Providers with managed
 * pool accounts render as wide pool sections; the rest as compact cards. Both
 * kinds share a single drag order driven by `usage.providerOrder`.
 */
interface AuthorizedChannel {
  kind: "pool" | "card";
  id: string;
  label: string;
}

function accountPlan(account: AccountView): string {
  return account.plan?.trim() || "套餐未知";
}

async function removeAccountBoundCustomModels(input: {
  accountIds: readonly string[];
  provider?: string;
}): Promise<void> {
  const accountIds = new Set(input.accountIds);
  const settings = useSharedSettings.getState();
  const nextModels = settings.customModels.filter(
    (model) =>
      !(
        (model.accountId !== undefined && accountIds.has(model.accountId)) ||
        (input.provider !== undefined && model.provider === input.provider)
      ),
  );
  if (nextModels.length === settings.customModels.length) return;
  settings.setCustomModels(nextModels);
  await waitForPendingSharedSettings();
  await flushSharedSettings();
}

/**
 * OpenAI 兼容 API 设置卡：ccswitch 风格表单（提供商名称 / Base URL / API Key /
 * 模型名称 / 模型展示名称），验证通过后导入为号池账号；支持多个提供商，卡片
 * 第一行即自定义提供商名称。
 */
function OpenAiCompatibleCard(props: { onOpenForm: () => void }) {
  return (
    <article
      data-testid="provider-card-openai-compatible"
      data-grid-span="1"
      className="col-span-1 self-start rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] p-3"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <ProviderBrandBadge id="openai-compatible" label="OpenAI 兼容 API" size="compact" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">OpenAI 兼容 API</h3>
          <p className="mt-0.5 truncate text-[10px] text-muted">自定义提供商 · 支持添加多个</p>
        </div>
        <button
          type="button"
          onClick={props.onOpenForm}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] font-medium text-foreground hover:bg-[var(--row-hover)]"
        >
          <UserRoundPlus className="size-3.5" /> 添加账号
        </button>
      </div>
    </article>
  );
}

interface OpenAiCompatibleFormValues {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  displayName: string;
}

const EMPTY_OPENAI_FORM: OpenAiCompatibleFormValues = {
  providerName: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  displayName: "",
};

/** ccswitch 风格表单卡：新建或编辑一个 OpenAI 兼容提供商。 */
function OpenAiCompatibleFormCard(props: {
  accountId?: string | undefined;
  onCancel: () => void;
  onSaved: (account: AccountView) => void;
}) {
  const [values, setValues] = useState<OpenAiCompatibleFormValues>(EMPTY_OPENAI_FORM);
  const [loading, setLoading] = useState(Boolean(props.accountId));
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  // Validation gate: only `verified` (with inputs unchanged since the probe)
  // may proceed to Add/Save. Any edit to Base URL / Key / Model resets to
  // `unverified` — a stale result is never reused.
  const [validation, setValidation] = useState<
    | { status: "unverified" }
    | { status: "verifying" }
    | {
        status: "verified";
        protocol: "responses" | "chat_completions";
        baseUrl: string;
        apiKey: string;
        model: string;
      }
    | { status: "failed"; error: string }
  >({ status: "unverified" });
  const [lastVerifiedLabel, setLastVerifiedLabel] = useState<string | null>(null);
  const set = (key: keyof OpenAiCompatibleFormValues) => (value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Base URL / Key / Model invalidate a previous verification immediately.
    if (key === "baseUrl" || key === "apiKey" || key === "model") {
      setValidation((current) =>
        current.status === "verified" || current.status === "failed"
          ? { status: "unverified" }
          : current,
      );
    }
  };

  useEffect(() => {
    if (!props.accountId) return;
    let cancelled = false;
    void (async () => {
      try {
        const config = await readBridge().getOpenAiCompatibleProfile({
          accountId: props.accountId!,
        });
        if (cancelled) return;
        setValues({
          providerName: config.providerName ?? "",
          baseUrl: config.baseUrl ?? "",
          apiKey: "",
          model: config.model ?? "",
          displayName: config.displayName ?? "",
        });
        if (config.validatedProtocol) {
          setLastVerifiedLabel(
            config.validatedProtocol === "responses" ? "Responses API" : "Chat Completions",
          );
        }
      } catch (error) {
        toast.danger(error instanceof Error ? error.message : "无法读取该提供商配置。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.accountId]);

  const canVerify =
    !verifying &&
    !saving &&
    !loading &&
    values.baseUrl.trim() !== "" &&
    values.apiKey.trim() !== "" &&
    values.model.trim() !== "";
  const canSave = !verifying && !saving && !loading && validation.status === "verified";

  const verify = async () => {
    if (!canVerify) {
      if (!values.model.trim()) toast.danger("请填写 Model Name，验证通过后才能添加。");
      else if (!values.baseUrl.trim() || !values.apiKey.trim())
        toast.danger("Base URL 与 API Key 为必填项。");
      return;
    }
    setVerifying(true);
    setValidation({ status: "verifying" });
    try {
      // Real compatibility probe (Responses-first, minimal fixed prompt, no
      // tools, no user content). GET /models alone never counts as verified.
      const outcome = await readBridge().submitOpenAiCompatibleCredentials({
        baseUrl: values.baseUrl.trim(),
        apiKey: values.apiKey.trim(),
        ...(values.providerName.trim() ? { providerName: values.providerName.trim() } : {}),
        ...(values.model.trim() ? { model: values.model.trim() } : {}),
        ...(values.displayName.trim() ? { displayName: values.displayName.trim() } : {}),
      });
      if (!outcome.ok || !outcome.validatedProtocol) {
        setValidation({ status: "failed", error: outcome.error ?? "验证失败，请检查后重试。" });
        return;
      }
      setValidation({
        status: "verified",
        protocol: outcome.validatedProtocol,
        baseUrl: values.baseUrl.trim(),
        apiKey: values.apiKey.trim(),
        model: values.model.trim(),
      });
    } catch (error) {
      setValidation({
        status: "failed",
        error: error instanceof Error ? error.message : "验证失败，请检查后重试。",
      });
    } finally {
      setVerifying(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || verifying || loading) return;
    // Add/Save gate: only a fresh `verified` result for the CURRENT inputs
    // may be imported. The supervisor re-checks staging validation as well.
    if (
      validation.status !== "verified" ||
      validation.baseUrl !== values.baseUrl.trim() ||
      validation.apiKey !== values.apiKey.trim() ||
      validation.model !== values.model.trim()
    ) {
      toast.danger("请先验证通过（Base URL + API Key + Model），验证通过后才能保存。");
      return;
    }
    setSaving(true);
    try {
      const account = await readBridge().importOpenAiCompatibleProfile(
        props.accountId ? { accountId: props.accountId } : {},
      );
      await readBridge()
        .refreshAccountQuota({ accountId: account.accountId })
        .catch(() => undefined);
      const accounts = await readBridge().listAccounts({});
      useUsageAccountsStore.getState().setAccounts(accounts);
      useUsageLoginStateStore.getState().setStored("openai-compatible", true);
      toast.success(props.accountId ? "OpenAI 兼容提供商已更新。" : "OpenAI 兼容提供商已添加。");
      props.onSaved(account);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "OpenAI 兼容 API 保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-lg border border-[color:var(--field-border)] bg-[var(--field-background)] px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-[color:var(--hairline-strong)]";
  return (
    <Modal.Backdrop isOpen onOpenChange={(next) => !next && props.onCancel()}>
      <Modal.Container placement="center" size="md">
        <Modal.Dialog className="sm:max-w-[560px]" data-testid="openai-compatible-form">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              {props.accountId ? "编辑 OpenAI 兼容提供商" : "添加 OpenAI 兼容提供商"}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 pb-2 pt-2">
            {loading ? (
              <p className="text-[10px] text-muted">加载中…</p>
            ) : (
              <form
                id="openai-compatible-credential-form"
                className="space-y-2"
                onSubmit={(event) => void submit(event)}
              >
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] text-muted">提供商名称（卡片显示）</span>
                    <input
                      value={values.providerName}
                      onChange={(e) => set("providerName")(e.target.value)}
                      placeholder="例如 My Relay"
                      aria-label="OpenAI 兼容提供商名称"
                      className={field}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-muted">Base URL *</span>
                    <input
                      value={values.baseUrl}
                      onChange={(e) => set("baseUrl")(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      aria-label="OpenAI 兼容 API Base URL"
                      autoComplete="url"
                      className={field}
                    />
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-[10px] text-muted">
                    API Key *{props.accountId ? "（编辑时留空表示保持不变）" : ""}
                  </span>
                  <input
                    type="password"
                    value={values.apiKey}
                    onChange={(e) => set("apiKey")(e.target.value)}
                    placeholder="sk-..."
                    aria-label="OpenAI 兼容 API Key"
                    autoComplete="off"
                    className={field}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] text-muted">模型名称</span>
                    <input
                      value={values.model}
                      onChange={(e) => set("model")(e.target.value)}
                      placeholder="例如 gpt-5.6-sol"
                      aria-label="OpenAI 兼容模型名称"
                      className={field}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-muted">模型展示名称</span>
                    <input
                      value={values.displayName}
                      onChange={(e) => set("displayName")(e.target.value)}
                      placeholder="例如 GPT-5.6"
                      aria-label="OpenAI 兼容模型展示名称"
                      className={field}
                    />
                  </label>
                </div>
              </form>
            )}
          </Modal.Body>
          <Modal.Footer className="flex-wrap gap-2">
            <p className="min-w-0 flex-1 text-[10px] leading-4 text-muted" aria-live="polite">
              {validation.status === "unverified" &&
                (lastVerifiedLabel
                  ? `未验证（上次已验证 · ${lastVerifiedLabel}，修改后需重新验证）。`
                  : "未验证：保存前必须先验证 Base URL + Key + Model。")}
              {validation.status === "verifying" && "验证中…正在做最小真实请求探测。"}
              {validation.status === "verified" &&
                (validation.protocol === "responses"
                  ? "✓ 已验证 · Responses API"
                  : "✓ 已验证 · Chat Completions")}
              {validation.status === "failed" && `✕ 验证失败：${validation.error}`}
            </p>
            <button
              type="button"
              onClick={props.onCancel}
              className="rounded-lg px-3 py-2 text-sm text-muted"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void verify()}
              disabled={!canVerify}
              aria-label="验证 Base URL 与模型"
              className="rounded-lg border border-[color:var(--hairline)] px-3 py-2 text-sm text-foreground hover:bg-[var(--row-hover)] disabled:opacity-50"
            >
              {validation.status === "verifying" ? "验证中…" : "验证"}
            </button>
            <button
              type="submit"
              form="openai-compatible-credential-form"
              disabled={!canSave}
              aria-label={props.accountId ? "保存提供商" : "添加提供商"}
              title={!canSave ? "验证通过后才能保存" : undefined}
              className="rounded-lg bg-[var(--row-active)] px-3 py-2 text-sm text-foreground disabled:opacity-50"
            >
              {saving ? "保存中…" : props.accountId ? "保存" : "添加"}
            </button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function KimiApiKeyDialog(props: {
  onClose: () => void;
  onImported?: ((accountId: string) => void) | undefined;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const field =
    "w-full rounded-lg border border-[color:var(--field-border)] bg-[var(--field-background)] px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-[color:var(--hairline-strong)]";
  return (
    <Modal.Backdrop isOpen onOpenChange={(next) => !next && props.onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[420px]" data-testid="kimi-api-key-form">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Kimi Code API Key</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 pb-2 pt-2">
            <form
              id="kimi-api-key-form"
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (saving) return;
                setSaving(true);
                void submitKimiApiKey({
                  apiKey,
                  onImported: props.onImported,
                })
                  .then((success) => {
                    if (success) props.onClose();
                  })
                  .finally(() => setSaving(false));
              }}
            >
              <p className="text-[10px] leading-4 text-muted">保存前会验证 API Key 并导入账号。</p>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="粘贴 Kimi Code API Key"
                aria-label="Kimi Code API Key"
                autoComplete="off"
                className={field}
              />
            </form>
          </Modal.Body>
          <Modal.Footer>
            <p className="min-w-0 flex-1 text-[10px] leading-4 text-muted" aria-live="polite">
              {saving ? "验证中…" : "未验证"}
            </p>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg px-3 py-2 text-sm text-muted"
            >
              取消
            </button>
            <button
              type="submit"
              form="kimi-api-key-form"
              disabled={saving || apiKey.trim().length === 0}
              className="rounded-lg bg-[var(--row-active)] px-3 py-2 text-sm text-foreground disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

const CREDENTIAL_FIELD_CLASS =
  "w-full rounded-lg border border-[color:var(--field-border)] bg-[var(--field-background)] px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-[color:var(--hairline-strong)]";

function VolcengineCredentialDialog(props: {
  apiKey: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  saving: boolean;
  onApiKeyChange: (value: string) => void;
  onAccessKeyIdChange: (value: string) => void;
  onSecretAccessKeyChange: (value: string) => void;
  onRegionChange: (value: string) => void;
  onClose: () => void;
  onSavingChange: (saving: boolean) => void;
}) {
  return (
    <Modal.Backdrop isOpen onOpenChange={(next) => !next && props.onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[520px]" data-testid="volcengine-credential-form">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>火山方舟 Volcengine Ark</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 pb-2 pt-2">
            <form
              id="volcengine-credential-form"
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (props.saving) return;
                const submittedApiKey = props.apiKey.trim();
                const hasAccessKey = props.accessKeyId.trim().length > 0;
                const hasSecretKey = props.secretAccessKey.trim().length > 0;
                if (!submittedApiKey && (hasAccessKey || hasSecretKey)) {
                  toast.danger("填写 AK/SK 时必须同时填写 Ark API Key；该 Key 用于调用模型。");
                  return;
                }
                if (hasAccessKey !== hasSecretKey) {
                  toast.danger("AK 与 SK 必须同时填写。");
                  return;
                }
                props.onSavingChange(true);
                void (async () => {
                  const bridge = readBridge();
                  const outcome = await bridge.submitVolcengineCredentials({
                    ...(submittedApiKey ? { apiKey: submittedApiKey } : {}),
                    ...(props.accessKeyId.trim() ? { accessKeyId: props.accessKeyId.trim() } : {}),
                    ...(props.secretAccessKey.trim()
                      ? { secretAccessKey: props.secretAccessKey.trim() }
                      : {}),
                    region: props.region.trim() || "cn-beijing",
                  });
                  if (!outcome.ok) {
                    toast.danger(outcome.error ?? "无法保存火山方舟凭据。");
                    return;
                  }
                  useUsageLoginStateStore.getState().setStored("volcengine", true);
                  props.onApiKeyChange("");
                  props.onAccessKeyIdChange("");
                  props.onSecretAccessKeyChange("");
                  props.onClose();
                  await refreshAndMergeProviderUsage("volcengine");
                  toast.success("火山方舟凭据已保存。");
                  if (submittedApiKey && outcome.arkModel) {
                    await autoProvisionVolcengineArkChannel({
                      apiKey: submittedApiKey,
                      model: outcome.arkModel,
                    }).catch((error) =>
                      toast.warning(
                        `额度已登录；火山方舟模型渠道自动创建失败（${error instanceof Error ? error.message : "未知错误"}），可在「OpenAI 兼容 API」手动添加。`,
                      ),
                    );
                  } else if (submittedApiKey && !outcome.arkModel) {
                    toast.warning(
                      "Ark API Key 已保存，但验证没有返回可用模型，暂未创建模型渠道。请确认该 Key 有 Ark 推理权限，或在「OpenAI 兼容 API」手动添加。",
                    );
                  } else if (!submittedApiKey) {
                    const hasArkChannel = useUsageAccountsStore
                      .getState()
                      .accounts.some(
                        (account) =>
                          account.provider === "openai-compatible" &&
                          [account.providerAccountId, account.label, account.plan].some(
                            (value) => value?.trim() === "Volcengine Ark",
                          ),
                      );
                    if (!hasArkChannel) {
                      toast.info(
                        "火山额度已登录；如需在「管理模型」中使用火山方舟模型，请再填写 Ark API Key（将自动创建模型渠道）。",
                      );
                    }
                  }
                })()
                  .catch((error) =>
                    toast.danger(error instanceof Error ? error.message : "无法保存火山方舟凭据。"),
                  )
                  .finally(() => props.onSavingChange(false));
              }}
            >
              <p className="text-[10px] leading-4 text-muted">
                Ark API Key 用于调用模型（保存后自动创建渠道）；AK + SK 用于显示 Coding Plan / Agent
                Plan 额度。填写 AK/SK 时，三项凭据必须同时填写。
              </p>
              <input
                type="password"
                value={props.apiKey}
                onChange={(event) => props.onApiKeyChange(event.target.value)}
                placeholder="Ark API Key（模型调用 Key）"
                aria-label="Volcengine Ark API Key"
                required
                autoComplete="off"
                className={CREDENTIAL_FIELD_CLASS}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={props.accessKeyId}
                  onChange={(event) => props.onAccessKeyIdChange(event.target.value)}
                  placeholder="Access Key ID (AKLT...)"
                  aria-label="Volcengine Access Key ID"
                  autoComplete="off"
                  className={CREDENTIAL_FIELD_CLASS}
                />
                <input
                  type="password"
                  value={props.secretAccessKey}
                  onChange={(event) => props.onSecretAccessKeyChange(event.target.value)}
                  placeholder="Secret Access Key"
                  aria-label="Volcengine Secret Access Key"
                  autoComplete="off"
                  className={CREDENTIAL_FIELD_CLASS}
                />
              </div>
              <input
                value={props.region}
                onChange={(event) => props.onRegionChange(event.target.value)}
                placeholder="cn-beijing"
                aria-label="Volcengine Region"
                className={CREDENTIAL_FIELD_CLASS}
              />
            </form>
          </Modal.Body>
          <Modal.Footer>
            <p className="min-w-0 flex-1 text-[10px] leading-4 text-muted" aria-live="polite">
              {props.saving ? "验证中…" : "保存前会验证 Ark Key / AK/SK。"}
            </p>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg px-3 py-2 text-sm text-muted"
            >
              取消
            </button>
            <button
              type="submit"
              form="volcengine-credential-form"
              disabled={
                props.saving ||
                props.apiKey.trim().length === 0 ||
                Boolean(props.accessKeyId.trim()) !== Boolean(props.secretAccessKey.trim())
              }
              className="rounded-lg bg-[var(--row-active)] px-3 py-2 text-sm text-foreground disabled:opacity-50"
            >
              {props.saving ? "保存中…" : "保存"}
            </button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function ApiKeyCredentialDialog(props: {
  label: string;
  apiKey: string;
  saving: boolean;
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => Promise<boolean>;
}) {
  return (
    <Modal.Backdrop isOpen onOpenChange={(next) => !next && props.onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[420px]" data-testid="api-key-credential-form">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{props.label} API Key</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 pb-2 pt-2">
            <form
              id="api-key-credential-form"
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (props.saving) return;
                void props.onSubmit().then((success) => {
                  if (success) {
                    props.onApiKeyChange("");
                    props.onClose();
                  }
                });
              }}
            >
              <p className="text-[10px] leading-4 text-muted">保存前会验证 API Key。</p>
              <input
                type="password"
                value={props.apiKey}
                onChange={(event) => props.onApiKeyChange(event.target.value)}
                placeholder={`粘贴 ${props.label} API Key`}
                aria-label={`${props.label} API Key`}
                autoComplete="off"
                className={CREDENTIAL_FIELD_CLASS}
              />
            </form>
          </Modal.Body>
          <Modal.Footer>
            <p className="min-w-0 flex-1 text-[10px] leading-4 text-muted" aria-live="polite">
              {props.saving ? "验证中…" : "未验证"}
            </p>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg px-3 py-2 text-sm text-muted"
            >
              取消
            </button>
            <button
              type="submit"
              form="api-key-credential-form"
              disabled={props.saving || props.apiKey.trim().length === 0}
              className="rounded-lg bg-[var(--row-active)] px-3 py-2 text-sm text-foreground disabled:opacity-50"
            >
              {props.saving ? "保存中…" : "保存"}
            </button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function CookieCredentialDialog(props: {
  label: string;
  cookie: string;
  saving: boolean;
  hint: string;
  onCookieChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => Promise<boolean>;
}) {
  return (
    <Modal.Backdrop isOpen onOpenChange={(next) => !next && props.onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[480px]" data-testid="cookie-credential-form">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{props.label} Cookie</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 pb-2 pt-2">
            <form
              id="cookie-credential-form"
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (props.saving) return;
                void props.onSubmit().then((success) => {
                  if (success) props.onClose();
                });
              }}
            >
              <p className="text-[10px] leading-4 text-muted">{props.hint}</p>
              <input
                type="password"
                value={props.cookie}
                onChange={(event) => props.onCookieChange(event.target.value)}
                placeholder={"粘贴 " + props.label + " 的 Cookie"}
                aria-label={props.label + " Cookie"}
                autoComplete="off"
                className={CREDENTIAL_FIELD_CLASS}
              />
            </form>
          </Modal.Body>
          <Modal.Footer>
            <p className="min-w-0 flex-1 text-[10px] leading-4 text-muted" aria-live="polite">
              {props.saving ? "验证中…" : "保存前会验证会话 Cookie。"}
            </p>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg px-3 py-2 text-sm text-muted"
            >
              取消
            </button>
            <button
              type="submit"
              form="cookie-credential-form"
              disabled={props.saving || props.cookie.trim().length === 0}
              className="rounded-lg bg-[var(--row-active)] px-3 py-2 text-sm text-foreground disabled:opacity-50"
            >
              {props.saving ? "保存中…" : "保存"}
            </button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function ProviderCard(props: {
  id: string;
  label: string;
  index?: number;
  onDragStartProvider?: (p: string) => void;
  onDropProvider?: (t: string) => void;
  onRenameAccount?: (account: AccountView) => void;
  onImportAccount?: () => void;
  onKimiApiKeyImported?: (accountId: string) => void;
}) {
  const snapshot = useProviderUsage(props.id);
  const managedAccounts = useUsageAccountsStore(
    useShallow((state) => state.accounts.filter((account) => account.provider === props.id)),
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
    cookie,
    setCookie,
    externalLoginUrl,
    handleSubmitCookie,
  } = useUsageProviderLogin(props.id);
  const [cliSigningIn, setCliSigningIn] = useState(false);
  const [accountActionInFlight, setAccountActionInFlight] = useState<string | null>(null);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [volcengineAccessKeyId, setVolcengineAccessKeyId] = useState("");
  const [volcengineSecretAccessKey, setVolcengineSecretAccessKey] = useState("");
  const [volcengineRegion, setVolcengineRegion] = useState("cn-beijing");
  const [credentialSaving, setCredentialSaving] = useState(false);
  const storedDisabled = useSharedSettings((state) =>
    state.usage.disabledProviders.includes(props.id),
  );
  const setUsageSetting = useSharedSettings((state) => state.setUsageSetting);
  const hasStoredSession = useHasStoredSession(props.id);
  // Raw authorization drives whether the quota block renders; a paused
  // provider keeps the block (dimmed, frozen) so the pause can be reverted
  // from the card itself.
  const authorized =
    snapshot?.status === "ok" ||
    snapshot?.status === "quota-hit" ||
    snapshot?.status === "rate-limited";
  // Antigravity is live-LS-only. After the app closes, UsageService keeps the
  // last verified identity/plan but marks the snapshot app-not-running. Keep
  // that identity card on the left (with an unavailable state) instead of
  // making a previously known full email disappear into the setup column.
  const hasRememberedIdentity = hasProviderIdentity(snapshot);
  // Only an actually-authorized provider may sit in the paused state. A stale
  // disabled flag on a never-configured provider must NOT render the bogus
  // "已暂停跟踪，点击恢复" row (user acceptance defect #4). A stored secret
  // alone is not enough either — the provider must also have a remembered
  // identity/plan, otherwise an unconfigured card reads as paused.
  const pauseAllowed = authorized || (hasStoredSession && hasProviderIdentity(snapshot));
  const providerPaused = storedDisabled && pauseAllowed;
  const showProviderCard =
    authorized || hasRememberedIdentity || providerPaused || hasStoredSession;
  const connected = authorized && !providerPaused;
  const label = providerLabel(props.id, props.label);
  /**
   * Authorized but meterless with a browser-session-gated usage backend
   * (today only OpenCode: local Go plan badge, meters live behind the
   * opencode.ai cookie). Deliberately independent of the persisted
   * stored-session flag — a dead/lost cookie with a stale flag must still
   * offer the reconnect path instead of a dead "暂无额度窗口" card.
   */
  const needsUsageSessionConnect =
    needsBrowserSessionForUsage(props.id) &&
    snapshot?.status === "ok" &&
    (snapshot.windows?.length ?? 0) === 0;
  const connectUsageSession = () => {
    if (externalLoginUrl) setCookieOpen(true);
    void handleSignIn();
  };
  /**
   * Manual paste escape hatch (OpenCode): the primary path is the embedded
   * overlay capture, but if that view ever fails the OAuth provider check the
   * user can still finish in their own browser and paste the cookie back.
   */
  const pasteUrl = cookiePasteUrl(props.id);
  const openPasteFallback = () => {
    if (pasteUrl) {
      openExternalWithFeedback(pasteUrl, {
        successMessage: "已在默认浏览器打开登录页面。登录完成后请返回粘贴 Cookie。",
      });
    }
    setCookieOpen(true);
  };
  const toggleProviderPaused = () => {
    const current = useSharedSettings.getState().usage.disabledProviders;
    const next = providerPaused
      ? current.filter((id) => id !== props.id)
      : [...new Set([...current, props.id])];
    setUsageSetting("disabledProviders", next);
    if (providerPaused) void refreshAndMergeProviderUsage(props.id);
  };
  const handleRemoveAuthorization = () => {
    void (async () => {
      const hostBoundAccounts = useUsageAccountsStore
        .getState()
        .accounts.filter((account) => account.provider === props.id);
      try {
        const bridge = readBridge() as unknown as {
          removeAccount: (p: { accountId: string }) => Promise<void>;
          listAccounts: (p: unknown) => Promise<AccountView[]>;
        };
        if (hostBoundAccounts.length > 0 && typeof bridge.removeAccount === "function") {
          for (const account of hostBoundAccounts) {
            await bridge.removeAccount({ accountId: account.accountId });
            useUsageAccountsStore.getState().removeAccount(account.accountId);
            await removeAccountBoundCustomModels({ accountIds: [account.accountId] });
          }
          if (typeof bridge.listAccounts === "function") {
            const next = await bridge.listAccounts({});
            setAccountsUnlessEmptyWipe(next);
          } else {
            useUsageAccountsStore
              .getState()
              .setAccounts(
                useUsageAccountsStore
                  .getState()
                  .accounts.filter((account) => account.provider !== props.id),
              );
          }
        }
        await removeAccountBoundCustomModels({
          accountIds: hostBoundAccounts.map((account) => account.accountId),
          provider: props.id,
        });
        if (
          canSignOut ||
          canReauthenticate ||
          canApiKeySignIn ||
          canManageApiKey ||
          hostBoundAccounts.length === 0
        ) {
          if (providerPaused) toggleProviderPaused();
          await handleSignOut();
        }
        // The deleted provider must not keep a remembered identity/plan from the
        // previous snapshot, or the card resurrects after the removal.
        useUsageLoginStateStore.getState().setStored(props.id, false);
        useProviderUsageStore.getState().removeSnapshot(props.id);
        await refreshAndMergeProviderUsage(props.id);
        toast.success(label + " 授权已删除。");
      } catch (error) {
        toast.danger(error instanceof Error ? error.message : label + " 授权删除失败。");
      }
    })();
  };

  const handleAccountAction = () => {
    if (cookieOpen) {
      setCookieOpen(false);
      return;
    }
    if (props.id === "codex") {
      setCliSigningIn(true);
      void createAndRunCodexProfileLogin({ label: "New Codex" }).finally(() =>
        setCliSigningIn(false),
      );
      return;
    }
    if (props.id === "grok") {
      setCliSigningIn(true);
      void createAndRunGrokProfileLogin({ label: "New Grok" }).finally(() =>
        setCliSigningIn(false),
      );
      return;
    }
    if (props.id === "kimi") {
      setCliSigningIn(true);
      void createAndRunKimiProfileLogin({ label: "New Kimi" }).finally(() =>
        setCliSigningIn(false),
      );
      return;
    }
    // commandcode 有意落入下方的 CLI 登录分支：官方 `cmdc auth login` 会把
    // {apiKey, userId, userName} 写进 ~/.commandcode/auth.json，采集器随后
    // 直接读它出额度与身份；浏览器 Cookie 粘贴流程对 CLI 用户不可用。
    if (props.id === "antigravity" && (canSignIn || canReauthenticate)) {
      setCliSigningIn(true);
      void signInAndImportAntigravityAccount().finally(() => setCliSigningIn(false));
      return;
    }
    // 已登录但没有额度窗口、且额度必须走浏览器会话的渠道（OpenCode）：
    // CLI 登录只能恢复 Go key，补 Cookie 会话才是正路。窄门控——只在 ok 且
    // 窗口为空时劫持，其他状态（未登录/失效）继续走原有分支。
    if (needsUsageSessionConnect) {
      connectUsageSession();
      return;
    }
    const cliCommand = CLI_LOGIN_COMMANDS[props.id];
    if (cliCommand) {
      setCliSigningIn(true);
      const opened = runAgentLoginCommand({
        label,
        command: cliCommand,
        onCommandComplete: (exitCode) => {
          setCliSigningIn(false);
          if (exitCode !== 0) return;
          useUsageLoginStateStore.getState().setStored(props.id, true);
          void refreshAndMergeProviderUsage(props.id);
          void readBridge().refreshAgentStatuses?.(currentWslDistros(), {
            agentKinds: [props.id],
          });
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
      if (externalLoginUrl) setCookieOpen(true);
      void handleSignIn();
      return;
    }
    toast.info(label + " 当前没有可用的登录方式，请先在设置中配置授权。");
    usePanelStore.getState().openSettingsSection("usage");
  };

  const refreshManagedAccounts = async () => {
    const bridge = readBridge() as unknown as {
      listAccounts: (p: unknown) => Promise<AccountView[]>;
    };
    const next = await bridge.listAccounts({ provider: props.id });
    const current = useUsageAccountsStore.getState().accounts;
    useUsageAccountsStore
      .getState()
      .setAccounts([...current.filter((account) => account.provider !== props.id), ...next]);
  };

  const selectCompactAccount = async (account: AccountView) => {
    setAccountActionInFlight(account.accountId);
    try {
      const bridge = readBridge() as unknown as {
        setAccountEnabled: (p: { accountId: string; enabled: boolean }) => Promise<void>;
      };
      await bridge.setAccountEnabled({ accountId: account.accountId, enabled: true });
      useUsageAccountsStore.getState().setNextSessionAccount(account.accountId);
      await refreshManagedAccounts();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "无法选择账号。");
    } finally {
      setAccountActionInFlight(null);
    }
  };

  /** Purge a stale identity-less cache row from the pool and the renderer store. */
  const removeCompactAccount = async (account: AccountView) => {
    setAccountActionInFlight(account.accountId);
    try {
      const bridge = readBridge() as unknown as {
        removeAccount: (p: { accountId: string }) => Promise<void>;
      };
      await bridge.removeAccount({ accountId: account.accountId });
      useUsageAccountsStore.getState().removeAccount(account.accountId);
      await removeAccountBoundCustomModels({ accountIds: [account.accountId], provider: props.id });
      await refreshManagedAccounts();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "无法删除账号。");
    } finally {
      setAccountActionInFlight(null);
    }
  };

  return (
    <div
      data-testid={"provider-card-" + props.id}
      data-grid-span={connected ? "1" : "1"}
      role="button"
      aria-label={label}
      tabIndex={0}
      draggable={props.index != null}
      onDragStart={
        props.index != null && props.onDragStartProvider
          ? (event) => {
              (
                event as unknown as { dataTransfer?: { setData: (a: string, b: string) => void } }
              ).dataTransfer?.setData("text/plain", props.id);
              props.onDragStartProvider?.(props.id);
            }
          : undefined
      }
      onDragOver={
        props.index != null && props.onDropProvider ? (event) => event.preventDefault() : undefined
      }
      onDrop={
        props.index != null && props.onDropProvider
          ? (event) => {
              event.preventDefault();
              props.onDropProvider?.(props.id);
            }
          : undefined
      }
      className={
        "col-span-1 self-start h-fit min-h-0 rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] p-3 " +
        (authorized ? "min-h-[170px]" : "min-h-[76px]")
      }
    >
      <header className="flex items-center gap-3">
        <ProviderBrandBadge id={props.id} label={label} size="compact" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold text-foreground">{label}</h3>
        </div>
        <button
          type="button"
          disabled={signingIn || cliSigningIn}
          onClick={handleAccountAction}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-[var(--row-hover)] disabled:opacity-50"
        >
          <UserRoundPlus className="size-3.5" />
          {cliSigningIn || signingIn
            ? "登录中…"
            : connected || managedAccounts.length > 0 || hasStoredSession || hasRememberedIdentity
              ? needsUsageSessionConnect
                ? "连接额度"
                : "添加账号"
              : "登录/授权"}
        </button>
        {props.onImportAccount ? (
          <button
            type="button"
            disabled={signingIn || cliSigningIn}
            onClick={props.onImportAccount}
            className="inline-flex h-8 shrink-0 items-center rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-[var(--row-hover)] disabled:opacity-50"
            aria-label={label + " 导入本机登录"}
          >
            导入
          </button>
        ) : null}
        {props.id === "kimi" || props.id === "devin" ? (
          <button
            type="button"
            disabled={signingIn || cliSigningIn}
            onClick={() => {
              setCookieOpen(false);
              setApiKeyOpen(true);
            }}
            className="inline-flex h-8 shrink-0 items-center rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-[var(--row-hover)] disabled:opacity-50"
            aria-label={props.id === "devin" ? "使用 Devin API Key 授权" : "使用 Kimi API Key 授权"}
          >
            API Key
          </button>
        ) : null}
      </header>

      {managedAccounts.length > 0 ? (
        <div className="mt-2 space-y-1 rounded-lg border border-[color:var(--hairline)] bg-black/5 dark:bg-black/20 p-1.5">
          {managedAccounts.map((account) =>
            !isStaleCachedAccount(account) ? (
              <div
                key={account.accountId}
                data-testid={"compact-account-row-" + account.accountId}
                role="button"
                tabIndex={0}
                aria-label={account.label + " " + label + "账号"}
                onClick={() => void selectCompactAccount(account)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  props.onRenameAccount?.(account);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void selectCompactAccount(account);
                  }
                }}
                className={
                  "flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--row-hover)] " +
                  (accountActionInFlight === account.accountId ? "opacity-60" : "")
                }
              >
                <span
                  className="min-w-0 flex-1 break-all text-[9px] leading-4 text-muted"
                  title={accountIdentity(account)}
                >
                  {poolRowTitle(account)}
                </span>
                {account.status === "auth-expired" ||
                account.status === "unavailable" ||
                account.status === "error" ? (
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
                      void (login as Promise<unknown>).finally(() => setCliSigningIn(false));
                    }}
                    className="shrink-0 rounded-md bg-black/5 dark:bg-white/5 px-1.5 py-1 text-[9px] text-muted hover:bg-[var(--row-hover)] disabled:opacity-50"
                    aria-label={account.label + " 登录授权"}
                  >
                    登录授权
                  </button>
                ) : null}
              </div>
            ) : (
              <div
                key={account.accountId}
                data-testid={"compact-account-row-stale-" + account.accountId}
                className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 opacity-60"
              >
                <span
                  className="min-w-0 flex-1 break-all text-[9px] leading-4 text-neutral-500"
                  title="缓存残留：未解析到账号身份"
                >
                  账号身份未知（已失效）
                </span>
                <button
                  type="button"
                  disabled={accountActionInFlight === account.accountId}
                  onClick={() => void removeCompactAccount(account)}
                  className="shrink-0 rounded-md bg-black/5 dark:bg-white/5 px-1.5 py-1 text-[9px] text-muted hover:bg-[var(--row-hover)] disabled:opacity-50"
                  aria-label={"删除失效的 " + account.label + " 缓存"}
                >
                  删除
                </button>
              </div>
            ),
          )}
        </div>
      ) : null}

      {showProviderCard ? (
        <div
          className={
            "mt-3 rounded-xl border border-[color:var(--hairline)] bg-[var(--surface-secondary)] dark:bg-[#17181c] p-3" +
            (providerPaused ? " opacity-50" : "")
          }
        >
          <div className="flex min-w-0 items-start gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <span className="shrink-0">
                <ProviderBrandBadge id={props.id} label={label} size="row" />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  data-testid={"provider-identity-" + props.id}
                  className="break-all text-[11px] font-medium leading-4 text-foreground"
                  title={snapshot?.authenticatedAs ?? undefined}
                >
                  {snapshot?.authenticatedAs?.trim() ||
                    managedAccounts
                      .find((account) => account.provider === props.id)
                      ?.providerAccountId?.trim() ||
                    managedAccounts
                      .find((account) => account.provider === props.id)
                      ?.maskedIdentity?.trim() ||
                    (isAuthorizedUsageStatus(snapshot?.status) ? "已登录" : label)}
                </p>
                <p className="break-words text-[9px] leading-4 text-neutral-500">
                  {snapshot?.plan ?? "套餐未知"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 self-start">
              {props.id === "volcengine" ? (
                <button
                  type="button"
                  aria-label="编辑 Volcengine Ark Token Plan"
                  onClick={() => setApiKeyOpen(true)}
                  className="rounded p-1 text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
                >
                  <Settings className="size-3" />
                </button>
              ) : props.id === "qwen" ? (
                <button
                  type="button"
                  aria-label="编辑阿里 Token Plan"
                  onClick={() => void handleSignIn()}
                  className="rounded p-1 text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
                >
                  <Settings className="size-3" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={label + " 刷新状态"}
                onClick={() => void refreshAndMergeProviderUsage(props.id)}
                className="rounded p-1 text-muted hover:bg-[var(--row-hover)] disabled:opacity-50"
              >
                <RefreshCw className="size-3" />
              </button>
              {pauseAllowed ? (
                <button
                  type="button"
                  aria-label={providerPaused ? "恢复使用" : "暂停使用"}
                  onClick={toggleProviderPaused}
                  className="rounded p-1 text-muted hover:bg-[var(--row-hover)] disabled:opacity-50"
                >
                  <Power className={"size-3 " + (providerPaused ? "" : "text-emerald-300")} />
                </button>
              ) : null}
              <button
                type="button"
                aria-label="移除账号"
                onClick={handleRemoveAuthorization}
                className="rounded p-1 text-muted hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          </div>
          {snapshot ? (
            <ProviderQuotaCard
              providerId={props.id}
              snapshot={snapshot}
              {...(needsUsageSessionConnect
                ? {
                    onConnectUsageSession: connectUsageSession,
                    connectLabel: `连接 ${label} 显示额度`,
                    ...(pasteUrl ? { onPasteCookie: openPasteFallback } : {}),
                  }
                : {})}
            />
          ) : null}
        </div>
      ) : null}
      {apiKeyOpen && props.id === "volcengine" ? (
        <VolcengineCredentialDialog
          apiKey={apiKey}
          accessKeyId={volcengineAccessKeyId}
          secretAccessKey={volcengineSecretAccessKey}
          region={volcengineRegion}
          saving={credentialSaving}
          onApiKeyChange={setApiKey}
          onAccessKeyIdChange={setVolcengineAccessKeyId}
          onSecretAccessKeyChange={setVolcengineSecretAccessKey}
          onRegionChange={setVolcengineRegion}
          onClose={() => setApiKeyOpen(false)}
          onSavingChange={setCredentialSaving}
        />
      ) : apiKeyOpen ? (
        <ApiKeyCredentialDialog
          label={label}
          apiKey={apiKey}
          saving={signingIn || cliSigningIn}
          onApiKeyChange={setApiKey}
          onClose={() => setApiKeyOpen(false)}
          onSubmit={() => {
            if (props.id === "kimi") {
              setCliSigningIn(true);
              return submitKimiApiKey({
                apiKey,
                onImported: props.onKimiApiKeyImported,
              }).finally(() => setCliSigningIn(false));
            }
            return handleSubmitApiKey();
          }}
        />
      ) : null}
      {!authorized && providerPaused ? (
        <button
          type="button"
          onClick={toggleProviderPaused}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 px-2 py-1 text-[10px] text-muted transition-colors hover:bg-[var(--row-hover)]"
        >
          <Power className="size-3" /> 已暂停跟踪，点击恢复
        </button>
      ) : null}
      {cookieOpen && (externalLoginUrl ?? pasteUrl) ? (
        <CookieCredentialDialog
          label={label}
          cookie={cookie}
          saving={signingIn}
          hint={
            externalLoginUrl
              ? "已在你的默认浏览器打开登录页。登录完成后，从浏览器开发者工具（F12 → 应用/网络） 复制会话 Cookie（完整 Cookie 请求头或会话 Cookie 的 name=value）粘贴到下面："
              : "在你自己的浏览器中登录后，从开发者工具（F12 → 应用/网络）复制会话 Cookie（完整 Cookie 请求头或会话 Cookie 的 name=value）粘贴到下面："
          }
          onCookieChange={setCookie}
          onClose={() => setCookieOpen(false)}
          onSubmit={handleSubmitCookie}
        />
      ) : null}
    </div>
  );
}

function AccountRow(props: {
  account: AccountView;
  queryState?: AccountUsageQueryState | undefined;
  busy: boolean;
  /** 池内优先级（1 = 最高，按卡片排序）；单账号卡不显示。 */
  priorityRank?: number;
  onEdit?: ((a: AccountView) => void) | undefined;
  onReauth: ((a: AccountView) => void) | undefined;
  onApplyHostLogin?: ((a: AccountView) => void) | undefined;
  onSelect: (a: AccountView) => void;
  onRename: (a: AccountView) => void;
  onRefresh: (a: AccountView) => void;
  onToggleEnabled: (a: AccountView) => void;
  onRemove: (a: AccountView) => void;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const { account, busy, onReauth } = props;
  return (
    <div
      key={account.accountId}
      draggable
      onDragStart={() => props.onDragStart(account.accountId)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => props.onDrop(account.accountId)}
      onClick={() => props.onSelect(account)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onRename(account);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect(account);
        }
      }}
      role="button"
      tabIndex={0}
      data-account-id={account.accountId}
      className="self-start h-fit rounded-xl border border-[color:var(--hairline)] bg-[var(--surface-secondary)] dark:bg-[#17181c] p-3"
    >
      <div className="flex min-w-0 items-start gap-2">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-neutral-500" aria-label="拖拽排序" />
        <span data-testid={"account-provider-icon-" + account.accountId} className="shrink-0">
          <ProviderBrandBadge
            id={account.provider}
            label={providerLabel(account.provider, undefined)}
            size="row"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p
            data-testid={"account-identity-" + account.accountId}
            className="break-all text-[11px] font-medium leading-4 text-foreground"
            title={account.providerAccountId ?? account.maskedIdentity ?? account.label}
          >
            {poolRowTitle(account)}
          </p>
          <p className="break-words text-[9px] leading-4 text-neutral-500">
            {accountPlan(account)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 self-start">
          {props.priorityRank ? (
            <span
              title={`第 ${props.priorityRank} 优先级：排在前面的账号优先调度，可拖拽调整顺序`}
              className="shrink-0 rounded bg-black/5 dark:bg-white/5 px-1.5 py-0.5 text-[9px] leading-4 text-muted tabular-nums"
            >
              第{props.priorityRank}优先
            </span>
          ) : null}
          {props.onEdit ? (
            <button
              type="button"
              disabled={busy}
              aria-label={"编辑 " + (account.providerAccountId ?? account.label)}
              onClick={(e) => {
                e.stopPropagation();
                props.onEdit?.(account);
              }}
              className="rounded p-1 text-muted hover:bg-[var(--row-hover)] hover:text-foreground disabled:opacity-50"
            >
              <Pencil className="size-3" />
            </button>
          ) : null}
          {account.status === "auth-expired" && account.enabled && onReauth ? (
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                onReauth(account);
              }}
              className="rounded px-1.5 py-1 text-[9px] text-muted hover:bg-[var(--row-hover)] disabled:opacity-50"
              aria-label={account.label + " 登录授权"}
            >
              登录授权
            </button>
          ) : null}
          {props.onApplyHostLogin ? (
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                props.onApplyHostLogin?.(account);
              }}
              className="rounded px-1.5 py-1 text-[9px] text-muted hover:bg-[var(--row-hover)] disabled:opacity-50"
              title="将该账号设为本机 agy 登录（会替换本机当前登录）"
              aria-label={account.label + " 设为本机登录"}
            >
              设为本机
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              props.onRefresh(account);
            }}
            className="rounded p-1 text-muted hover:bg-[var(--row-hover)] disabled:opacity-50"
            aria-label="刷新账号配额"
          >
            <RefreshCw className="size-3" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleEnabled(account);
            }}
            className="rounded p-1 text-muted hover:bg-[var(--row-hover)] disabled:opacity-50"
            aria-label={account.enabled ? "禁用账号" : "启用账号"}
          >
            <Power className={"size-3 " + (account.enabled ? "text-emerald-300" : "")} />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              props.onRemove(account);
            }}
            className="rounded p-1 text-muted hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
            aria-label="移除账号"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
      <div className="mt-2">
        <AccountQuotaCard account={account} queryState={props.queryState} />
      </div>
    </div>
  );
}

function PoolSchedulingControl(props: { providerId: string }) {
  const [value, setValue] = useState<string>("priority");
  useEffect(() => {
    let cancelled = false;
    const bridge = readBridge() as unknown as {
      getAccountPoolScheduling?: (p: { provider: string }) => Promise<{ scheduling: string }>;
    };
    if (!bridge.getAccountPoolScheduling) return;
    bridge
      .getAccountPoolScheduling({ provider: props.providerId })
      .then((res) => {
        if (!cancelled) setValue(res.scheduling);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.providerId]);
  return (
    <select
      data-testid={"account-scheduling-" + props.providerId}
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        const bridge = readBridge() as unknown as {
          setAccountPoolScheduling?: (p: {
            provider: string;
            scheduling: string;
          }) => Promise<unknown>;
        };
        void bridge.setAccountPoolScheduling?.({
          provider: props.providerId,
          scheduling: next as "priority" | "round-robin" | "random",
        });
      }}
      className="h-7 rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] text-foreground"
    >
      <option value="priority">按优先级（排前优先）</option>
      <option value="round-robin">循环轮换</option>
      <option value="random">随机</option>
    </select>
  );
}

function ManagedAccountPool(props: {
  providerId: string;
  title: string;
  badgeLabel: string;
  addAriaLabel: string;
  accounts: AccountView[];
  queryStates: Record<string, AccountUsageQueryState>;
  busy: boolean;
  actionError: string | null;
  onAdd: () => void;
  onImport?: () => void;
  importAriaLabel?: string;
  onAddApiKey?: () => void;
  addApiKeyAriaLabel?: string;
  onReauth: ((a: AccountView) => void) | undefined;
  onApplyHostLogin?: ((a: AccountView) => void) | undefined;
  onSelect: (a: AccountView) => void;
  onRename: (a: AccountView) => void;
  onRefresh: (a: AccountView) => void;
  onToggleEnabled: (a: AccountView) => void;
  onEdit?: ((a: AccountView) => void) | undefined;
  onRemove: (a: AccountView) => void;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
  /** When set, the whole pool card participates in channel drag ordering. */
  index?: number;
  onDragStartProvider?: (p: string) => void;
  onDropProvider?: (t: string) => void;
}) {
  const { providerId, title, badgeLabel, addAriaLabel, accounts, busy, actionError } = props;
  // 单账号时渲染成和 ChatGPT/Command Code 一样的紧凑卡片（占半列）；
  // 只有 ≥2 个账号才展开成宽的多行号池布局。
  const single = accounts.length === 1;
  const header = single ? (
    <div className="flex items-center gap-3">
      <ProviderBrandBadge id={providerId} label={badgeLabel} size="compact" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-foreground">{badgeLabel}</h3>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={props.onAdd}
        aria-label={addAriaLabel}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-[var(--row-hover)] disabled:opacity-50"
      >
        <UserRoundPlus className="size-3.5" /> 添加账号
      </button>
      {props.onImport ? (
        <button
          type="button"
          disabled={busy}
          onClick={props.onImport}
          aria-label={props.importAriaLabel}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-[var(--row-hover)] disabled:opacity-50"
        >
          导入
        </button>
      ) : null}
      {props.onAddApiKey ? (
        <button
          type="button"
          disabled={busy}
          onClick={props.onAddApiKey}
          aria-label={props.addApiKeyAriaLabel ?? "使用 API Key 添加账号"}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-[var(--row-hover)] disabled:opacity-50"
        >
          API Key
        </button>
      ) : null}
    </div>
  ) : (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex min-w-0 items-center gap-2.5">
        <ProviderBrandBadge id={providerId} label={badgeLabel} size="compact" />
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 truncate text-[10px] text-muted">新会话按账号池规则调度</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <PoolSchedulingControl providerId={providerId} />
        <button
          type="button"
          disabled={busy}
          onClick={props.onAdd}
          aria-label={addAriaLabel}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] text-foreground hover:bg-[var(--row-hover)] disabled:opacity-50"
        >
          <UserRoundPlus className="size-3" /> 添加账号
        </button>
        {props.onImport ? (
          <button
            type="button"
            disabled={busy}
            onClick={props.onImport}
            aria-label={props.importAriaLabel}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] text-foreground hover:bg-[var(--row-hover)] disabled:opacity-50"
          >
            导入本机登录
          </button>
        ) : null}
        {props.onAddApiKey ? (
          <button
            type="button"
            disabled={busy}
            onClick={props.onAddApiKey}
            aria-label={props.addApiKeyAriaLabel ?? "使用 API Key 添加账号"}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 px-2 text-[10px] text-foreground hover:bg-[var(--row-hover)] disabled:opacity-50"
          >
            API Key
          </button>
        ) : null}
      </div>
    </div>
  );
  return (
    <section
      data-testid={"provider-card-" + providerId}
      data-grid-span={single ? "1" : "2"}
      draggable={props.index != null}
      onDragStart={
        props.index != null && props.onDragStartProvider
          ? (event) => {
              event.dataTransfer.setData("text/plain", providerId);
              props.onDragStartProvider?.(providerId);
            }
          : undefined
      }
      onDragOver={
        props.index != null && props.onDropProvider ? (event) => event.preventDefault() : undefined
      }
      onDrop={
        props.index != null && props.onDropProvider
          ? (event) => {
              event.preventDefault();
              props.onDropProvider?.(providerId);
            }
          : undefined
      }
      className={
        (single ? "col-span-1" : "col-span-2") +
        " self-start h-fit rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] p-3"
      }
    >
      {header}
      {actionError ? <p className="mb-2 text-[10px] text-red-300">{actionError}</p> : null}
      {accounts.length === 0 ? (
        <p className="rounded-lg bg-black/5 dark:bg-black/20 p-3 text-[10px] text-muted">
          尚未添加 {badgeLabel} 账号
        </p>
      ) : single ? (
        <div className="mt-2">
          <AccountRow
            account={accounts[0]!}
            queryState={props.queryStates[accounts[0]!.accountId]}
            busy={busy}
            onEdit={props.onEdit}
            onReauth={props.onReauth}
            onApplyHostLogin={props.onApplyHostLogin}
            onSelect={props.onSelect}
            onRename={props.onRename}
            onRefresh={props.onRefresh}
            onToggleEnabled={props.onToggleEnabled}
            onRemove={props.onRemove}
            onDragStart={props.onDragStart}
            onDrop={props.onDrop}
          />
        </div>
      ) : (
        <div
          data-testid={"account-grid-" + providerId}
          className="grid grid-cols-2 items-start content-start auto-rows-max gap-2"
        >
          {accounts.map((account, index) => (
            <AccountRow
              key={account.accountId}
              account={account}
              queryState={props.queryStates[account.accountId]}
              busy={busy}
              priorityRank={index + 1}
              onEdit={props.onEdit}
              onReauth={props.onReauth}
              onApplyHostLogin={props.onApplyHostLogin}
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

export function ModelUsageWorkspace(props: { onClose?: () => void } = {}) {
  const open = usePanelStore((state) => state.modelUsageDialogOpen);
  const closeModelUsageDialog = usePanelStore((state) => state.closeModelUsageDialog);
  const close = props.onClose ?? closeModelUsageDialog;
  const accounts = useUsageAccountsStore((state) => state.accounts);
  const usageSnapshots = useProviderUsageStore((state) => state.snapshots);
  const providerOrder = useSharedSettings((state) => state.usage.providerOrder);
  const storedLogin = useUsageLoginStateStore((state) => state.stored);
  const setUsageSetting = useSharedSettings((state) => state.setUsageSetting);
  const [draggedProviderId, setDraggedProviderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({});
  const [draggedAccountId, setDraggedAccountId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AccountView | null>(null);
  const [renameLabel, setRenameLabel] = useState("");
  /** 改名弹框下的补充说明（Kimi 新账号引导填邮箱备注时使用，关闭即清）。 */
  const [renameHint, setRenameHint] = useState<string | null>(null);
  /** OpenAI 兼容表单：null 关闭；{accountId?} 新建/编辑。 */
  const [openAiCompatibleForm, setOpenAiCompatibleForm] = useState<{ accountId?: string } | null>(
    null,
  );
  const [kimiApiKeyForm, setKimiApiKeyForm] = useState(false);
  // The active tab lives in the panel store (persisted): reopening the page
  // restores the last-visited tab, and explicit deep links keep working.
  const workspaceTab = usePanelStore((state) => state.modelUsageWorkspaceTab);
  const setWorkspaceTabAndEntry = (tab: ModelUsageWorkspaceTab) => {
    usePanelStore.getState().openModelUsageWorkspace({ tab });
  };
  const customModels = useSharedSettings((state) => state.customModels);
  const setCustomModels = useSharedSettings((state) => state.setCustomModels);
  const [accountQueryStates, setAccountQueryStates] = useState<
    Record<string, AccountUsageQueryState>
  >({});

  useEffect(() => {
    if (!open) {
      setAccountQueryStates({});
      return;
    }
    let cancelled = false;
    const bridge = readBridge() as unknown as {
      listAccounts: (p: unknown) => Promise<AccountView[]>;
      getProviderUsage: (p: unknown) => Promise<{ snapshots: UsageSnapshot[] }>;
      refreshAccountQuota: (p: { accountId: string }) => Promise<AccountView>;
      refreshTokenUsage: (p: {
        periods: string[];
      }) => Promise<import("@/shared/contracts").TokenUsageResponse>;
    };
    if (!bridge || typeof bridge.listAccounts !== "function") return;
    // Hydrate cached provider snapshots on open so authorized providers land on
    // the left immediately instead of waiting for the next auto-refresh tick.
    if (typeof bridge.getProviderUsage === "function") {
      void bridge
        .getProviderUsage({})
        .then((res) => {
          if (cancelled) return;
          const store = useProviderUsageStore.getState();
          for (const snapshot of res.snapshots) store.mergeSnapshot(snapshot);
        })
        .catch(() => undefined);
    }
    if (typeof (bridge as { getUsageLoginState?: unknown }).getUsageLoginState === "function") {
      void (
        bridge as unknown as {
          getUsageLoginState: (payload: Record<string, never>) => Promise<{
            stored: Record<string, boolean>;
          }>;
        }
      )
        .getUsageLoginState({})
        .then((res) => {
          if (!cancelled) useUsageLoginStateStore.getState().setAll(res.stored);
        })
        .catch(() => undefined);
    }
    const errorMessage = (error: unknown): string =>
      error instanceof Error ? error.message : String(error);
    const setQueryState = (accountId: string, patch: Partial<AccountUsageQueryState>): void => {
      if (cancelled) return;
      setAccountQueryStates((prev) => ({
        ...prev,
        [accountId]: { quota: "idle", token: "idle", ...prev[accountId], ...patch },
      }));
    };
    const refreshUsage = async (): Promise<void> => {
      setActionErrors({});
      let initialAccounts: AccountView[];
      try {
        initialAccounts = await bridge.listAccounts({});
      } catch (error) {
        if (!cancelled) setActionErrors({ "*": errorMessage(error) });
        return;
      }
      if (cancelled) return;
      setAccountsUnlessEmptyWipe(initialAccounts);
      const managedAccounts = (
        initialAccounts.length > 0 ? initialAccounts : useUsageAccountsStore.getState().accounts
      ).filter((account) => Boolean(account.maskedIdentity) || Boolean(account.providerAccountId));
      if (managedAccounts.length === 0) {
        useTokenUsageStore.getState().reset();
        setAccountQueryStates({});
        return;
      }
      setAccountQueryStates(
        Object.fromEntries(
          managedAccounts.map((a) => [
            a.accountId,
            { quota: "loading", token: "loading" } as AccountUsageQueryState,
          ]),
        ),
      );
      useTokenUsageStore.getState().setLoading(true);
      const applyQuotaResult = (account: AccountView, refreshed: AccountView | undefined): void => {
        const effective = refreshed ?? account;
        if (refreshed) useUsageAccountsStore.getState().upsertAccount(refreshed);
        const statusFailure =
          effective.status === "error" ||
          effective.status === "unavailable" ||
          effective.status === "auth-expired";
        if (hasAccountQuotaValue(effective) && !statusFailure)
          setQueryState(account.accountId, { quota: "success" });
        else
          setQueryState(account.accountId, {
            quota: "error",
            quotaError: accountQuotaFailureMessage(effective),
          });
      };
      const quotaRefresh = Promise.all(
        managedAccounts.map(async (account) => {
          try {
            const refreshed = await bridge.refreshAccountQuota({ accountId: account.accountId });
            if (cancelled) return;
            applyQuotaResult(account, refreshed);
          } catch (error) {
            setQueryState(account.accountId, { quota: "error", quotaError: errorMessage(error) });
          }
        }),
      );
      const tokenRefresh = bridge
        .refreshTokenUsage({ periods: ["today", "month", "allTime"] })
        .then((response) => {
          if (cancelled) return;
          useTokenUsageStore.getState().setResponse(response);
          for (const account of managedAccounts)
            setQueryState(account.accountId, { token: "success" });
        })
        .catch((error) => {
          const message = errorMessage(error);
          if (cancelled) return;
          useTokenUsageStore.getState().setError(message);
          for (const account of managedAccounts)
            setQueryState(account.accountId, { token: "error", tokenError: message });
        });
      await Promise.all([quotaRefresh, tokenRefresh]);
      if (cancelled) return;
      try {
        const refreshedAccounts = await bridge.listAccounts({});
        if (!cancelled) {
          setAccountsUnlessEmptyWipe(refreshedAccounts);
          for (const account of managedAccounts) {
            const refreshed = refreshedAccounts.find((c) => c.accountId === account.accountId);
            if (!refreshed) continue;
            const hasMeaningful =
              hasAccountQuotaValue(refreshed) ||
              Boolean(refreshed.lastError) ||
              refreshed.status === "error" ||
              refreshed.status === "unavailable" ||
              refreshed.status === "auth-expired";
            if (!hasMeaningful) continue;
            applyQuotaResult(account, refreshed);
          }
        }
      } catch (error) {
        if (!cancelled) setActionErrors({ "*": errorMessage(error) });
      }
    };
    void refreshUsage();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const accountActions = async (action: () => Promise<unknown>, providerId?: string) => {
    setBusy(true);
    if (providerId) setActionErrors((prev) => ({ ...prev, [providerId]: null }));
    else setActionErrors({});
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (providerId) setActionErrors((prev) => ({ ...prev, [providerId]: message }));
      else setActionErrors({ "*": message });
    } finally {
      setBusy(false);
    }
  };

  const codexAccounts = accounts.filter((a) => a.provider === "codex");
  const grokAccounts = accounts.filter((a) => a.provider === "grok");
  const kimiAccounts = accounts.filter((a) => a.provider === "kimi");
  const signedInCodexAccounts = useMemo(
    () => codexAccounts.filter((a) => Boolean(a.maskedIdentity) || Boolean(a.providerAccountId)),
    [codexAccounts],
  );
  const signedGrokAccounts = useMemo(
    () => grokAccounts.filter((a) => Boolean(a.maskedIdentity) || Boolean(a.providerAccountId)),
    [grokAccounts],
  );
  const signedKimiAccounts = useMemo(
    () => kimiAccounts.filter((a) => Boolean(a.maskedIdentity) || Boolean(a.providerAccountId)),
    [kimiAccounts],
  );
  const antigravityAccounts = accounts.filter((a) => a.provider === "antigravity");
  const signedAntigravityAccounts = useMemo(
    () =>
      antigravityAccounts.filter((a) => Boolean(a.maskedIdentity) || Boolean(a.providerAccountId)),
    [antigravityAccounts],
  );
  const signedOpenAiCompatibleAccounts = useMemo(
    () =>
      accounts.filter((a) => a.provider === "openai-compatible" && Boolean(a.providerAccountId)),
    [accounts],
  );
  const otherDisplayedProviders = useMemo(
    () =>
      resolveDisplayedProviders(providerOrder, []).filter(
        // codex/grok/antigravity render as managed pools; openai-compatible has
        // its own dedicated credential card and must not duplicate as a
        // subscription card.
        (p) =>
          p.id !== "codex" &&
          p.id !== "grok" &&
          p.id !== "kimi" &&
          p.id !== "antigravity" &&
          p.id !== "openai-compatible",
      ),
    [providerOrder],
  );
  const authenticatedOtherProviders = useMemo(
    () =>
      otherDisplayedProviders.filter(
        (p) =>
          isAuthorizedUsageStatus(usageSnapshots[p.id]?.status) ||
          hasProviderIdentity(usageSnapshots[p.id]) ||
          storedLogin[p.id] === true,
      ),
    [otherDisplayedProviders, usageSnapshots, storedLogin],
  );
  const unauthenticatedOtherProviders = useMemo(
    () =>
      otherDisplayedProviders.filter(
        (p) =>
          !isAuthorizedUsageStatus(usageSnapshots[p.id]?.status) &&
          !hasProviderIdentity(usageSnapshots[p.id]) &&
          storedLogin[p.id] !== true,
      ),
    [otherDisplayedProviders, usageSnapshots, storedLogin],
  );
  const codexSnapshotConnected = isAuthorizedUsageStatus(usageSnapshots["codex"]?.status);
  const grokSnapshotConnected = isAuthorizedUsageStatus(usageSnapshots["grok"]?.status);
  const antigravitySnapshotConnected = isAuthorizedUsageStatus(
    usageSnapshots["antigravity"]?.status,
  );
  // Left grid cards share one drag order. codex/grok/antigravity render as plain
  // cards only when the host session is authorized but no managed pool account
  // exists; otherwise their account-pool section renders above these cards.
  const leftCardProviders = useMemo(() => {
    const present = new Set<string>();
    if (
      signedInCodexAccounts.length === 0 &&
      (codexSnapshotConnected || hasProviderIdentity(usageSnapshots.codex) || storedLogin.codex)
    )
      present.add("codex");
    if (
      signedGrokAccounts.length === 0 &&
      (grokSnapshotConnected || hasProviderIdentity(usageSnapshots.grok) || storedLogin.grok)
    )
      present.add("grok");
    if (
      signedAntigravityAccounts.length === 0 &&
      (antigravitySnapshotConnected ||
        hasProviderIdentity(usageSnapshots.antigravity) ||
        storedLogin.antigravity)
    )
      present.add("antigravity");
    for (const provider of authenticatedOtherProviders) present.add(provider.id);
    return resolveDisplayedProviders(providerOrder, []).filter((p) => present.has(p.id));
  }, [
    providerOrder,
    authenticatedOtherProviders,
    signedInCodexAccounts.length,
    signedGrokAccounts.length,
    signedAntigravityAccounts.length,
    codexSnapshotConnected,
    grokSnapshotConnected,
    antigravitySnapshotConnected,
    usageSnapshots,
    storedLogin,
  ]);
  // The authorized grid renders exactly these channels, in `providerOrder`
  // sequence, so dragging any card (pool or compact) reorders the whole board.
  const authorizedChannels = useMemo<AuthorizedChannel[]>(() => {
    const channels = new Map<string, AuthorizedChannel>();
    if (signedInCodexAccounts.length > 0)
      channels.set("codex", { kind: "pool", id: "codex", label: "ChatGPT" });
    if (signedGrokAccounts.length > 0)
      channels.set("grok", { kind: "pool", id: "grok", label: "Grok" });
    if (signedKimiAccounts.length > 0)
      channels.set("kimi", { kind: "pool", id: "kimi", label: "Kimi Code" });
    if (signedAntigravityAccounts.length > 0)
      channels.set("antigravity", { kind: "pool", id: "antigravity", label: "Antigravity" });
    if (signedOpenAiCompatibleAccounts.length > 0)
      channels.set("openai-compatible", {
        kind: "pool",
        id: "openai-compatible",
        label: "OpenAI 兼容 API",
      });
    for (const provider of leftCardProviders) {
      if (!channels.has(provider.id)) {
        channels.set(provider.id, {
          kind: "card",
          id: provider.id,
          label: provider.id === "codex" ? "ChatGPT" : provider.label,
        });
      }
    }
    return resolveDisplayedProviders(providerOrder, [])
      .map((p) => channels.get(p.id))
      .filter((channel): channel is AuthorizedChannel => channel !== undefined);
  }, [
    providerOrder,
    leftCardProviders,
    signedInCodexAccounts.length,
    signedGrokAccounts.length,
    signedKimiAccounts.length,
    signedAntigravityAccounts.length,
    signedOpenAiCompatibleAccounts.length,
  ]);

  const refreshAccountList = async () => {
    const bridge = readBridge() as unknown as {
      listAccounts: (p: unknown) => Promise<AccountView[]>;
    };
    const next = await bridge.listAccounts({});
    setAccountsUnlessEmptyWipe(next);
    return next;
  };
  // Trash removes only the CraftStation-managed account and its isolated
  // credential. Official CLI homes are independent import sources and must not
  // be signed out or overwritten by deleting a CraftStation row.
  // (The per-row "设为本机" action below is the explicit opt-in exception: it
  // overwrites the host `agy` login on purpose and says so in the UI.)
  const removePoolAccountCompletely = async (account: AccountView) => {
    const bridge = readBridge() as unknown as {
      removeAccount: (p: { accountId: string }) => Promise<void>;
      forgetProviderUsage?: (p: { providerId: string }) => Promise<unknown>;
    };
    await bridge.removeAccount({ accountId: account.accountId });
    useUsageAccountsStore.getState().removeAccount(account.accountId);
    await removeAccountBoundCustomModels({ accountIds: [account.accountId] });
    const next = await refreshAccountList();
    if (!next.some((entry) => entry.provider === account.provider)) {
      if (typeof bridge.forgetProviderUsage === "function") {
        await bridge.forgetProviderUsage({ providerId: account.provider }).catch(() => undefined);
      }
      useUsageLoginStateStore.getState().setStored(account.provider, false);
      // Last account of this provider is gone: drop the remembered identity and
      // the stale pause flag so nothing renders as a resurrected card.
      useProviderUsageStore.getState().removeSnapshot(account.provider);
      const disabled = useSharedSettings.getState().usage.disabledProviders;
      if (disabled.includes(account.provider)) {
        setUsageSetting(
          "disabledProviders",
          disabled.filter((id) => id !== account.provider),
        );
      }
    }
  };
  const openRenameAccount = (
    account: AccountView,
    options?: { prefill?: string; hint?: string },
  ) => {
    setRenameTarget(account);
    setRenameLabel(options?.prefill ?? account.label);
    setRenameHint(options?.hint ?? null);
  };
  const closeRenameAccount = () => {
    setRenameTarget(null);
    setRenameHint(null);
  };
  /** Kimi 新账号创建成功后引导填备注：官方接口不给邮箱，备注是唯一可读身份。 */
  const KIMI_REMARK_HINT =
    "Kimi 官方接口不返回账号邮箱，建议填入该账号的邮箱，方便区分多个账号（也可稍后右键改名）。";
  const promptNewKimiLabel = async (accountId: string) => {
    const next = await refreshAccountList().catch(() => []);
    const account = next.find((a) => a.accountId === accountId);
    if (!account) return;
    openRenameAccount(account, { prefill: "", hint: KIMI_REMARK_HINT });
  };
  // Explicit opt-in (mirrors `agm switch --target agy`): publish this pool
  // row as the host `agy` login, replacing whatever the host uses today, so
  // host/ambient sessions run as this account with a full model catalog.
  const applyAntigravityHostLogin = (account: AccountView) =>
    void accountActions(async () => {
      const result = await readBridge().applyAntigravityHostLogin({
        accountId: account.accountId,
      });
      await refreshAndMergeProviderUsage("antigravity");
      await readBridge()
        .refreshAgentStatuses?.(currentWslDistros(), { agentKinds: ["antigravity"] })
        .catch(() => undefined);
      toast.success(
        `已将 ${result.email ?? account.label} 设为本机 agy 登录（本机原登录已被替换）。`,
      );
    }, "antigravity");
  const renameAccount = async () => {
    const account = renameTarget;
    const label = renameLabel.trim();
    if (!account || !label) return;
    await accountActions(async () => {
      const bridge = readBridge() as unknown as {
        renameAccount: (p: { accountId: string; label: string }) => Promise<void>;
      };
      await bridge.renameAccount({ accountId: account.accountId, label });
      await refreshAccountList();
      closeRenameAccount();
    }, account.provider);
  };
  const chooseAccountForNextSession = async (account: AccountView) => {
    const bridge = readBridge() as unknown as {
      setAccountEnabled: (p: { accountId: string; enabled: boolean }) => Promise<void>;
    };
    await bridge.setAccountEnabled({ accountId: account.accountId, enabled: true });
    useUsageAccountsStore.getState().setNextSessionAccount(account.accountId);
    await refreshAccountList();
  };
  const createCodexProfile = async () => {
    await createAndRunCodexProfileLogin({ label: "New Codex" });
  };
  const createGrokProfile = async () => {
    await createAndRunGrokProfileLogin({ label: "New Grok" });
  };
  const importHostCodexLogin = async () => {
    const bridge = readBridge() as unknown as {
      importCodexProfile: (p: { label: string }) => Promise<AccountView>;
    };
    const account = await bridge.importCodexProfile({ label: "本机 Codex" });
    await refreshAccountList();
    toast.success(
      account.status === "available"
        ? "已导入本机 Codex / ChatGPT 登录"
        : "已创建账号，但本机 ~/.codex/auth.json 无法解析",
    );
  };
  const createKimiProfile = async () => {
    await createAndRunKimiProfileLogin({
      label: "New Kimi",
      onCreated: (accountId) => void promptNewKimiLabel(accountId),
    });
  };
  const importHostKimiLogin = async () => {
    const account = await readBridge().importKimiProfile({ label: "本机 Kimi" });
    await refreshAccountList();
    if (account?.accountId) {
      const fresh = useUsageAccountsStore
        .getState()
        .accounts.find((a) => a.accountId === account.accountId);
      if (fresh) openRenameAccount(fresh, { prefill: "", hint: KIMI_REMARK_HINT });
    }
    toast.success(
      account.status === "available"
        ? "已导入本机 Kimi Code 登录"
        : "已创建 Kimi 账号，但本机凭据无法解析",
    );
  };
  const handleProviderDrop = (targetId: string) => {
    if (!draggedProviderId || draggedProviderId === targetId) return;
    const displayed = resolveDisplayedProviders(providerOrder, []).map((p) => p.id);
    // Only cards actually on screen participate in a drop; providers hidden in
    // settings or rendered in the other column must not absorb a slot.
    const visible = new Set<string>([
      ...authorizedChannels.map((channel) => channel.id),
      ...unauthenticatedOtherProviders.map((p) => p.id),
    ]);
    const ordered = displayed.filter((id) => visible.has(id));
    const from = ordered.indexOf(draggedProviderId);
    const to = ordered.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved!);
    const position = new Map(ordered.map((id, index) => [id, index]));
    let cursor = 0;
    // Persist the complete new order; ids already present in providerOrder but
    // not on screen keep their old relative slots.
    setUsageSetting(
      "providerOrder",
      displayed.map((id) => (position.has(id) ? ordered[cursor++]! : id)),
    );
    setDraggedProviderId(null);
  };
  const reorder = (targetId: string, provider = "codex") => {
    if (!draggedAccountId || draggedAccountId === targetId) return;
    const pool =
      provider === "grok"
        ? grokAccounts
        : provider === "kimi"
          ? kimiAccounts
          : provider === "antigravity"
            ? antigravityAccounts
            : provider === "openai-compatible"
              ? signedOpenAiCompatibleAccounts
              : codexAccounts;
    const ordered = [...pool].sort((a, b) => a.order - b.order);
    const from = ordered.findIndex((a) => a.accountId === draggedAccountId);
    const to = ordered.findIndex((a) => a.accountId === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved!);
    void accountActions(async () => {
      const bridge = readBridge() as unknown as {
        reorderAccounts: (p: { provider: string; orderedAccountIds: string[] }) => Promise<void>;
      };
      await bridge.reorderAccounts({
        provider,
        orderedAccountIds: ordered.map((a) => a.accountId),
      });
      await refreshAccountList();
    }, provider);
  };

  const renderManagedPool = (poolProviderId: string, index: number): ReactNode => {
    const shared = {
      queryStates: accountQueryStates,
      busy,
      actionError: actionErrors[poolProviderId] ?? actionErrors["*"] ?? null,
      onSelect: (a: AccountView) =>
        void accountActions(() => chooseAccountForNextSession(a), poolProviderId),
      onRename: openRenameAccount,
      onRefresh: (a: AccountView) =>
        void accountActions(async () => {
          const bridge = readBridge() as unknown as {
            refreshAccountQuota: (p: { accountId: string }) => Promise<unknown>;
          };
          await bridge.refreshAccountQuota({ accountId: a.accountId });
          await refreshAccountList();
        }, poolProviderId),
      onToggleEnabled: (a: AccountView) =>
        void accountActions(async () => {
          const bridge = readBridge() as unknown as {
            setAccountEnabled: (p: { accountId: string; enabled: boolean }) => Promise<void>;
          };
          await bridge.setAccountEnabled({ accountId: a.accountId, enabled: !a.enabled });
          await refreshAccountList();
        }, poolProviderId),
      onRemove: (a: AccountView) =>
        void accountActions(() => removePoolAccountCompletely(a), poolProviderId),
      onDragStart: (id: string) => setDraggedAccountId(id),
      onDrop: (id: string) => reorder(id, poolProviderId),
      index,
      onDragStartProvider: (id: string) => setDraggedProviderId(id),
      onDropProvider: (t: string) => handleProviderDrop(t),
    };
    switch (poolProviderId) {
      case "codex":
        return (
          <ManagedAccountPool
            {...shared}
            providerId="codex"
            title="ChatGPT 账号池"
            badgeLabel="ChatGPT"
            addAriaLabel="添加 ChatGPT 账号"
            accounts={signedInCodexAccounts}
            onAdd={() => void accountActions(createCodexProfile, "codex")}
            onImport={() => void accountActions(importHostCodexLogin, "codex")}
            importAriaLabel="导入本机 Codex 登录"
            onReauth={(a) =>
              void accountActions(async () => {
                await runCodexProfileLogin({ accountId: a.accountId, label: a.label });
              }, "codex")
            }
          />
        );
      case "grok":
        return (
          <ManagedAccountPool
            {...shared}
            providerId="grok"
            title="Grok 账号池"
            badgeLabel="Grok"
            addAriaLabel="添加 Grok 账号"
            accounts={signedGrokAccounts}
            onAdd={() => void accountActions(createGrokProfile, "grok")}
            onReauth={(a) =>
              void accountActions(async () => {
                await createAndRunGrokProfileLogin({ label: a.label });
              }, "grok")
            }
          />
        );
      case "kimi":
        return (
          <ManagedAccountPool
            {...shared}
            providerId="kimi"
            title="Kimi Code 账号池"
            badgeLabel="Kimi Code"
            addAriaLabel="添加 Kimi Code 账号"
            accounts={signedKimiAccounts}
            onAdd={() => void accountActions(createKimiProfile, "kimi")}
            onImport={() => void accountActions(importHostKimiLogin, "kimi")}
            importAriaLabel="导入本机 Kimi Code 登录"
            onAddApiKey={() => setKimiApiKeyForm(true)}
            addApiKeyAriaLabel="使用 API Key 添加 Kimi Code 账号"
            onReauth={(a) =>
              void accountActions(
                () => runKimiProfileLogin({ accountId: a.accountId, label: a.label }),
                "kimi",
              )
            }
          />
        );
      case "antigravity":
        return (
          <ManagedAccountPool
            {...shared}
            providerId="antigravity"
            title="Antigravity 账号池"
            badgeLabel="Antigravity"
            addAriaLabel="添加 Antigravity 账号"
            accounts={signedAntigravityAccounts}
            onAdd={() =>
              void accountActions(() => signInAndImportAntigravityAccount(), "antigravity")
            }
            onReauth={(a) =>
              void accountActions(
                () => signInAndImportAntigravityAccount({ accountId: a.accountId }),
                "antigravity",
              )
            }
            onApplyHostLogin={applyAntigravityHostLogin}
          />
        );
      case "openai-compatible":
        return (
          <ManagedAccountPool
            {...shared}
            providerId="openai-compatible"
            title="OpenAI 兼容 API 账号池"
            badgeLabel="OpenAI 兼容 API"
            addAriaLabel="添加 OpenAI 兼容 API 账号"
            accounts={signedOpenAiCompatibleAccounts}
            onAdd={() => setOpenAiCompatibleForm({})}
            onEdit={(a) => setOpenAiCompatibleForm({ accountId: a.accountId })}
            onReauth={(a) => setOpenAiCompatibleForm({ accountId: a.accountId })}
          />
        );
      default:
        return null;
    }
  };

  if (!open) return null;

  const configuredProviderIds = new Set(
    resolveConfiguredProviderIds({
      accounts,
      storedLogin,
      usageSnapshots,
    }),
  );
  for (const provider of leftCardProviders) configuredProviderIds.add(provider.id);

  return (
    <div
      data-testid="model-usage-workspace"
      className="flex h-full min-h-0 flex-col bg-[var(--surface)]"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[color:var(--hairline)] px-4">
        <div className="flex items-center gap-3">
          <img
            src={brandLogoUrl}
            alt="CraftStation"
            draggable={false}
            className="size-5 shrink-0 rounded-[6px] object-contain"
          />
          <div
            role="tablist"
            aria-label="模型与用量视图"
            className="flex items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 p-1"
          >
            {(
              [
                ["usage", "渠道与额度"],
                ["models", "管理模型"],
                ["stats", "用量统计"],
                ["crafting", "合成台 / Harness"],
                ["recipes", "我的配方"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={workspaceTab === tab}
                onClick={() => setWorkspaceTabAndEntry(tab)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  workspaceTab === tab
                    ? "bg-[var(--row-active)] text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="关闭模型与用量"
          className="rounded-lg p-1.5 text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      {workspaceTab === "models" ? (
        <ModelManagementPage
          accounts={accounts}
          customModels={customModels}
          onUpdateCustomModels={setCustomModels}
          configuredProviderIds={[...configuredProviderIds]}
        />
      ) : workspaceTab === "crafting" ? (
        <CraftingWorkbenchPage
          accounts={accounts}
          customModels={customModels}
          onUpdateCustomModels={setCustomModels}
          configuredProviderIds={[...configuredProviderIds]}
          providerOrder={providerOrder}
          entryMode={usePanelStore.getState().modelUsageEntryMode ?? undefined}
        />
      ) : workspaceTab === "recipes" ? (
        <MyRecipesPage />
      ) : workspaceTab === "stats" ? (
        <UsageStatsPage />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-auto p-3">
          <div
            className="grid min-w-0 flex-1 grid-cols-2 items-start content-start auto-rows-max gap-3 overflow-y-auto pr-1"
            data-testid="authorized-provider-grid"
            data-layout="two-column"
          >
            {authorizedChannels.map((channel, index) => (
              <Fragment key={"provider-grid-" + channel.id}>
                {channel.kind === "pool" ? (
                  renderManagedPool(channel.id, index)
                ) : (
                  <ProviderCard
                    id={channel.id}
                    label={channel.label}
                    index={index}
                    onRenameAccount={openRenameAccount}
                    onDragStartProvider={(id) => setDraggedProviderId(id)}
                    onDropProvider={(t) => handleProviderDrop(t)}
                  />
                )}
              </Fragment>
            ))}
            {signedInCodexAccounts.length === 0 &&
            signedGrokAccounts.length === 0 &&
            signedKimiAccounts.length === 0 &&
            signedAntigravityAccounts.length === 0 &&
            signedOpenAiCompatibleAccounts.length === 0 &&
            leftCardProviders.length === 0 ? (
              <p className="rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] p-6 text-center text-sm text-muted">
                尚未绑定账号
              </p>
            ) : null}
          </div>
          <div
            className="grid min-w-0 w-[296px] shrink-0 grid-cols-1 items-start content-start auto-rows-max gap-3 overflow-y-auto pr-1"
            data-testid="unauthorized-provider-grid"
          >
            {signedInCodexAccounts.length === 0 &&
            !codexSnapshotConnected &&
            !hasProviderIdentity(usageSnapshots.codex) &&
            !storedLogin.codex ? (
              <ProviderCard id="codex" label="ChatGPT" />
            ) : null}
            {signedGrokAccounts.length === 0 &&
            !grokSnapshotConnected &&
            !hasProviderIdentity(usageSnapshots.grok) &&
            !storedLogin.grok ? (
              <ProviderCard id="grok" label="Grok" />
            ) : null}
            {signedKimiAccounts.length === 0 ? (
              <ProviderCard
                id="kimi"
                label="Kimi Code"
                onImportAccount={() => void accountActions(importHostKimiLogin, "kimi")}
                onKimiApiKeyImported={(accountId) => void promptNewKimiLabel(accountId)}
              />
            ) : null}
            {signedAntigravityAccounts.length === 0 &&
            !antigravitySnapshotConnected &&
            !hasProviderIdentity(usageSnapshots.antigravity) &&
            !storedLogin.antigravity ? (
              <ProviderCard id="antigravity" label="Antigravity" />
            ) : null}
            {signedOpenAiCompatibleAccounts.length === 0 ? (
              <OpenAiCompatibleCard onOpenForm={() => setOpenAiCompatibleForm({})} />
            ) : null}
            {unauthenticatedOtherProviders.map((provider, index) => (
              <ProviderCard
                key={provider.id}
                id={provider.id}
                label={provider.label}
                index={index}
                onRenameAccount={openRenameAccount}
                onDragStartProvider={(id) => setDraggedProviderId(id)}
                onDropProvider={(t) => handleProviderDrop(t)}
              />
            ))}
          </div>
        </div>
      )}
      <div data-testid="provider-grid" className="hidden" />
      {openAiCompatibleForm ? (
        <OpenAiCompatibleFormCard
          accountId={openAiCompatibleForm.accountId ?? undefined}
          onCancel={() => setOpenAiCompatibleForm(null)}
          onSaved={() => setOpenAiCompatibleForm(null)}
        />
      ) : null}
      {kimiApiKeyForm ? (
        <KimiApiKeyDialog
          onClose={() => setKimiApiKeyForm(false)}
          onImported={(accountId) => void promptNewKimiLabel(accountId)}
        />
      ) : null}
      <Modal.Backdrop
        isOpen={renameTarget !== null}
        onOpenChange={(next) => !next && closeRenameAccount()}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[420px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>重命名账号</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="px-5 pb-5 pt-2">
              {renameHint ? (
                <p className="mb-2 text-xs leading-5 text-muted">{renameHint}</p>
              ) : null}
              <TextField
                value={renameLabel}
                onChange={setRenameLabel}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && renameLabel.trim().length > 0 && !busy) {
                    void renameAccount();
                  }
                }}
              >
                <Label>账号名称</Label>
                <Input />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <button
                type="button"
                onClick={() => closeRenameAccount()}
                className="rounded-lg px-3 py-2 text-sm text-muted"
              >
                取消
              </button>
              <button
                type="button"
                disabled={renameLabel.trim().length === 0 || busy}
                onClick={() => void renameAccount()}
                className="rounded-lg bg-[var(--row-active)] px-3 py-2 text-sm text-foreground disabled:opacity-50"
              >
                保存
              </button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
