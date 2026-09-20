import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import { toast } from "@heroui/react";
import type { AccountView, AgentCapability, LabeledOption } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ProviderBrandBadge } from "./providerBrands";
import { resolveDisplayedProviders } from "@/renderer/components/providers/usageProviders";
import { getSettingsInstalledAgents } from "@/shared/agentStatus";
import { resolveHiddenModelIds } from "@/shared/agentSelection";
import { expandAgentToVisibilityProviders } from "@/renderer/components/thread/buildModelPickerControls";
import { providerVisibilityKey } from "@/renderer/components/common/ProviderModelMenu/parts/providerIdentity";
import { currentWslDistros } from "@/renderer/utils/acpRegistryAuth";
import { runAgentLoginCommand } from "@/renderer/actions/agentLoginActions";
import {
  customModelId,
  parseEffortTiers,
  type CustomModel,
} from "@/renderer/components/thread/customModelCatalog";
import {
  CustomModelDialog,
  ModalityGroup,
  type CustomModelDialogValues,
} from "./CustomModelDialog";
import type { SharedSettings } from "@/shared/settings";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { resolveThirdPartyHarnessForModel } from "@/shared/thirdPartyRouting";

const inputClass =
  "w-full rounded-lg border border-[color:var(--field-border)] bg-[var(--field-background)] px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted focus:border-[color:var(--hairline-strong)]";
const bulkActionClass =
  "rounded-md border border-[color:var(--hairline)] px-2 py-1 text-[10px] text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

/** 左栏渠道条目：agent 渠道（与首页模型选择器同源）或 OpenAI 兼容自定义渠道。 */
type ChannelEntry = {
  key: string;
  kind: string;
  label: string;
  models: LabeledOption[];
  hiddenKey?: string;
  capabilities?: AgentCapability;
  accountId?: string;
};

/** 上下文徽标：纯数字按十进制缩写（1000000→1M），其余原样透出。 */
export function formatContextBadge(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) {
    const tokens = Number(raw);
    if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`;
    if (tokens >= 1_000 && tokens % 1_000 === 0) return `${tokens / 1_000}K`;
    return raw;
  }
  return raw;
}

/**
 * 上游模型列表拉取的客户端超时（supervisor 侧 ~12s 必返回，这里再加余量）。
 * IPC/主进程抖动时 promise 可能悬空：无超时则 spinner 常亮且重试按钮被隐藏，
 * 用户只能干等。超时转为可重试的错误态。
 */
export const CHANNEL_MODELS_TIMEOUT_MS = 30_000;

export async function listChannelModelsWithTimeout(
  accountId: string | undefined,
  timeoutMs = CHANNEL_MODELS_TIMEOUT_MS,
): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readBridge()
        .listChannelModels({
          provider: "openai-compatible",
          ...(accountId ? { accountId } : {}),
        })
        .then((response) => response.models),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("获取模型列表超时（30s），请重试。")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function CustomModelRow(props: {
  model: CustomModel;
  providerLabel: string;
  onUpdate: (patch: Partial<CustomModel>) => void;
  onRemove: () => void;
}) {
  const { model, providerLabel, onUpdate, onRemove } = props;
  const contextBadge = formatContextBadge(model.contextSize);
  // 行内配置（上下文 / 模态 / 思考强度）：与添加对话框同字段，直接写回 store。
  // 渠道模型的档位只有落到这里才会进 capabilities，决定首页有无强度下拉。
  const [expanded, setExpanded] = useState(false);
  const tiers = parseEffortTiers((model.efforts ?? []).join(","));
  return (
    <li
      className="rounded-lg border border-[color:var(--hairline)] bg-[var(--surface-secondary)] p-2"
      data-testid={`custom-model-${model.id}`}
    >
      <div className="flex items-center gap-2">
        <input
          aria-label="模型展示名称"
          value={model.displayName}
          onChange={(event) => onUpdate({ displayName: event.target.value })}
          className="min-w-0 flex-1 rounded-md border border-[color:var(--hairline)] bg-[var(--field-background)] px-2 py-1 text-[11px] text-foreground outline-none focus:border-[color:var(--hairline-strong)]"
        />
        {contextBadge ? (
          <span
            className="shrink-0 rounded-full border border-[color:var(--hairline)] bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[10px] text-muted"
            title={`上下文窗口 ${model.contextSize}`}
          >
            {contextBadge}
          </span>
        ) : null}
        <span className="shrink-0 text-[10px] text-muted">{providerLabel}</span>
        <span className="shrink-0 text-[10px] text-muted">{model.modelId}</span>
        <button
          type="button"
          aria-label={expanded ? `收起 ${model.displayName} 的配置` : `配置 ${model.displayName}`}
          aria-expanded={expanded}
          title="上下文 / 模态 / 思考强度"
          onClick={() => setExpanded((current) => !current)}
          className="shrink-0 rounded-md p-1 text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        <button
          type="button"
          aria-label={`移除 ${model.displayName}`}
          onClick={onRemove}
          className="shrink-0 rounded-md p-1 text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {expanded ? (
        <div className="mt-2 flex flex-col gap-2 border-t border-[color:var(--hairline)] pt-2">
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex flex-col gap-1 text-[10px] text-muted">
              上下文窗口
              <input
                aria-label="上下文窗口"
                value={model.contextSize}
                onChange={(event) => onUpdate({ contextSize: event.target.value })}
                placeholder="如 1000000 / 1M，空＝默认最高"
                className="rounded-md border border-[color:var(--hairline)] bg-[var(--field-background)] px-2 py-1 text-[11px] text-foreground outline-none focus:border-[color:var(--hairline-strong)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-muted">
              最大输出 Token
              <input
                aria-label="最大输出 Token"
                value={model.maxOutputTokens ?? ""}
                onChange={(event) => onUpdate({ maxOutputTokens: event.target.value })}
                placeholder="空＝默认"
                className="rounded-md border border-[color:var(--hairline)] bg-[var(--field-background)] px-2 py-1 text-[11px] text-foreground outline-none focus:border-[color:var(--hairline-strong)]"
              />
            </label>
          </div>
          <ModalityGroup
            legend="输入类型"
            values={model.inputModalities ?? ["text"]}
            locked={["text"]}
            onChange={(values) => onUpdate({ inputModalities: values })}
          />
          <ModalityGroup
            legend="输出类型"
            values={model.outputModalities ?? ["text"]}
            onChange={(values) => onUpdate({ outputModalities: values })}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex flex-col gap-1 text-[10px] text-muted">
              思考强度档位（逗号分隔）
              <input
                aria-label="思考强度档位"
                defaultValue={(model.efforts ?? []).join(", ")}
                key={`efforts-${model.id}-${(model.efforts ?? []).join(",")}`}
                onBlur={(event) => {
                  const next = parseEffortTiers(event.target.value);
                  onUpdate({
                    efforts: next,
                    ...(model.defaultEffort && !next.includes(model.defaultEffort)
                      ? { defaultEffort: "" }
                      : {}),
                  });
                }}
                placeholder="如 low, high, max"
                className="rounded-md border border-[color:var(--hairline)] bg-[var(--field-background)] px-2 py-1 text-[11px] text-foreground outline-none focus:border-[color:var(--hairline-strong)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-muted">
              默认思考强度
              <select
                aria-label="默认思考强度"
                value={model.defaultEffort ?? ""}
                onChange={(event) => onUpdate({ defaultEffort: event.target.value })}
                className="w-full rounded-md border border-[color:var(--hairline)] bg-[var(--field-background)] px-2 py-1 text-[11px] text-foreground outline-none focus:border-[color:var(--hairline-strong)]"
              >
                <option value="">跟随渠道默认</option>
                {tiers.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
                {model.defaultEffort && !tiers.includes(model.defaultEffort) ? (
                  <option value={model.defaultEffort}>{model.defaultEffort}</option>
                ) : null}
              </select>
            </label>
          </div>
          <p className="text-[10px] text-muted">档位留空则跟随渠道默认；改动即时保存。</p>
        </div>
      ) : null}
    </li>
  );
}
/**
 * 「管理模型」页：管理首页模型选择器的模型清单。
 * 左栏为渠道列表（与首页选择器同源的 agent 渠道 + OpenAI 兼容自定义渠道，
 * 全部带渠道 logo）；右栏为选中渠道的完整模型清单——每个模型的勾选状态即
 * 首页选择器是否显示（走 hiddenModels，与设置页/选择器同一套可见性机制），
 * 另可手动添加自定义模型（含上下文档位）。
 */
export function ModelManagementPage(props: {
  accounts: AccountView[];
  customModels: SharedSettings["customModels"];
  onUpdateCustomModels: (next: SharedSettings["customModels"]) => void;
  /** Providers configured in the usage workspace; installed-only CLIs stay out. */
  configuredProviderIds: readonly string[];
}) {
  const { accounts, customModels, onUpdateCustomModels, configuredProviderIds } = props;
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const hiddenModels = useSharedSettings((state) => state.hiddenModels);
  const setHiddenModels = useSharedSettings((state) => state.setHiddenModels);
  const shownModels = useSharedSettings((state) => state.shownModels);
  const setShownModels = useSharedSettings((state) => state.setShownModels);
  const providerOrder = useSharedSettings((state) => state.usage.providerOrder);
  const recipes = useCraftingWorkbenchStore((state) => state.recipes);
  const setRecipeHomepageVisible = useCraftingWorkbenchStore(
    (state) => state.setRecipeHomepageVisible,
  );
  const providerLabels = useMemo(
    () => new Map(resolveDisplayedProviders(providerOrder, []).map((p) => [p.id, p.label])),
    [providerOrder],
  );

  const compatibleAccounts = useMemo(
    () => accounts.filter((account) => account.provider === "openai-compatible"),
    [accounts],
  );
  const configuredProviders = useMemo(
    () => new Set(configuredProviderIds),
    [configuredProviderIds],
  );

  // 与首页模型选择器同源的 agent 渠道（每个模型可见面一个条目）。
  // 已配置（有账号/额度）的渠道即使暂时没有可用模型也保留：用户可以在此
  // 「获取模型」或手动添加，而不是看着渠道凭空消失。
  const agentChannels = useMemo(() => {
    const installed = getSettingsInstalledAgents(agentStatuses, wslAgentStatuses);
    return installed
      .flatMap(expandAgentToVisibilityProviders)
      .filter((provider) => configuredProviders.has(provider.kind))
      .map((provider) => {
        const models = provider.capabilities.models.filter((model) => model.id !== "auto");
        return {
          key: providerVisibilityKey(provider),
          kind: provider.kind,
          label: provider.label,
          models,
          hiddenKey: providerVisibilityKey(provider),
          capabilities: provider.capabilities,
        };
      });
  }, [agentStatuses, wslAgentStatuses, configuredProviders]);

  const channels: ChannelEntry[] = useMemo(() => {
    const entries: ChannelEntry[] = [...agentChannels];
    for (const account of compatibleAccounts) {
      const label = account.providerAccountId ?? account.label;
      entries.push({
        key: `openai-compatible:${account.accountId}`,
        kind: "openai-compatible",
        label,
        accountId: account.accountId,
        models: [],
      });
    }
    // 合成台「我的配方」：存过的配方可在此勾选进首页模型选择器。
    entries.push({
      key: "recipes",
      kind: "recipes",
      label: "我的配方",
      models: recipes.map((recipe) => ({
        id: recipe.id,
        label: recipe.alias?.trim() || recipe.systemName,
      })),
    });
    return entries;
  }, [agentChannels, compatibleAccounts, recipes]);

  const [selectedKey, setSelectedKey] = useState<string>("");
  useEffect(() => {
    if (channels.length === 0) return;
    if (!channels.some((channel) => channel.key === selectedKey)) {
      setSelectedKey(channels[0]!.key);
    }
  }, [channels, selectedKey]);

  const selected = channels.find((channel) => channel.key === selectedKey);
  // Built inline (not memoized upstream) so the memo below can list it as a
  // stable-primitive dependency instead of a fresh object identity per render.
  const selectedAgentChannel = useMemo(() => {
    const current = channels.find((channel) => channel.key === selectedKey);
    return current && current.hiddenKey && current.capabilities
      ? {
          hiddenKey: current.hiddenKey,
          capabilities: current.capabilities,
          models: current.models,
        }
      : undefined;
  }, [channels, selectedKey]);

  // —— 渠道内模型搜索 + 上游可用模型获取 ——
  const [modelQuery, setModelQuery] = useState("");
  const [refreshingKinds, setRefreshingKinds] = useState<Record<string, boolean>>({});
  const [actionHint, setActionHint] = useState<string | null>(null);
  useEffect(() => {
    setModelQuery("");
  }, [selectedKey]);
  const filteredChannelModels = useMemo(() => {
    if (!selectedAgentChannel) return [];
    const query = modelQuery.trim().toLowerCase();
    if (!query) return selectedAgentChannel.models;
    return selectedAgentChannel.models.filter(
      (model) =>
        model.id.toLowerCase().includes(query) || model.label.toLowerCase().includes(query),
    );
  }, [selectedAgentChannel, modelQuery]);

  const fetchChannelModels = async (kind: string, label?: string) => {
    if (refreshingKinds[kind]) return;
    setRefreshingKinds((current) => ({ ...current, [kind]: true }));
    setActionHint(null);
    // 本次拉取前已知的模型 id：拉取后新增的部分自动设为首页可见，
    // 否则「获取成功」了新模型却依然藏在隐藏名单里（尤其 OpenCode 这类
    // 默认全隐藏的渠道），看起来就像“显示成功但无法导入”。
    const knownBefore = new Set(
      [...agentStatuses, ...wslAgentStatuses]
        .filter((status) => status.kind === kind)
        .flatMap((status) => status.capabilities?.models?.map((model) => model.id) ?? []),
    );
    try {
      // 直接从上游获取该渠道当前可用的模型列表：重新运行 adapter 的原生能力
      // 探测（antigravity `agy models`、codex app-server `model/list`、
      // command-code `--list-models`、opencode provider inventory ……），
      // 用上游返回的最新目录替换渠道模型清单并列出来。
      const response = await readBridge().refreshAgentStatuses?.(currentWslDistros(), {
        agentKinds: [kind],
      });
      const statuses = [...(response?.windows ?? []), ...(response?.wsl ?? [])].filter(
        (status) => status.kind === kind,
      );
      const freshIds = statuses.flatMap((status) =>
        (status.capabilities?.models ?? [])
          .filter((model) => model.id !== "auto")
          .map((model) => model.id),
      );
      const modelCount = freshIds.length;
      const delta = [...new Set(freshIds)].filter((id) => !knownBefore.has(id));
      if (delta.length > 0) {
        // 仅把本次新发现的模型加入显式可见名单：用户亲手点的「获取模型」，
        // 新货就该直接出现在首页，而不是再藏一层。
        const hiddenKey =
          channels.find((channel) => channel.kind === kind)?.hiddenKey ??
          providerVisibilityKey({ kind });
        if (hiddenKey) {
          const hidden = new Set(hiddenModels[hiddenKey] ?? []);
          const shown = new Set(shownModels[hiddenKey] ?? []);
          let changed = false;
          for (const id of delta) {
            if (hidden.delete(id)) changed = true;
            if (!shown.has(id)) {
              shown.add(id);
              changed = true;
            }
          }
          if (changed) {
            setHiddenModels(hiddenKey, [...hidden]);
            setShownModels(hiddenKey, [...shown]);
          }
        }
      }
      const channelName = label ?? kind;
      setActionHint(
        modelCount > 0
          ? `已从上游获取 ${channelName} 的 ${modelCount} 个可用模型${delta.length > 0 ? `（${delta.length} 个新模型已加入首页）` : ""}`
          : `已从上游获取 ${channelName} 模型列表，暂无可用模型`,
      );
    } catch {
      setActionHint("获取模型列表失败，请重试");
    } finally {
      setRefreshingKinds((current) => ({ ...current, [kind]: false }));
    }
  };

  const openOpencodeModelSelector = () => {
    // Official OpenCode TUI as the selection surface — spawned by the supervisor
    // through the shared login-terminal overlay, never by the renderer.
    const opened = runAgentLoginCommand({
      label: "OpenCode 模型选择",
      command: "opencode",
      subtitle: "在 OpenCode TUI 内选择模型（/models）；退出后 CraftStation 自动获取模型目录",
      onCommandComplete: (exitCode) => {
        if (exitCode === 0) void fetchChannelModels("opencode", "OpenCode");
      },
    });
    if (!opened) setActionHint("请先添加一个项目，再打开 OpenCode 模型选择器。");
  };

  // 与设置页一致：可见性 = capabilities 默认 + 用户显式 hidden 列表的并集的反面。
  const selectedHiddenSet = selectedAgentChannel
    ? new Set(
        resolveHiddenModelIds(
          selectedAgentChannel.capabilities,
          hiddenModels[selectedAgentChannel.hiddenKey],
          shownModels[selectedAgentChannel.hiddenKey],
        ),
      )
    : new Set<string>();

  const toggleChannelModelVisible = (channel: ChannelEntry, modelId: string) => {
    if (!channel.hiddenKey || !channel.capabilities) return;
    const current = new Set(
      resolveHiddenModelIds(
        channel.capabilities,
        hiddenModels[channel.hiddenKey],
        shownModels[channel.hiddenKey],
      ),
    );
    const shown = new Set(shownModels[channel.hiddenKey] ?? []);
    if (current.has(modelId)) {
      // Explicitly shown: on curated-discovery channels (defaultHiddenModels)
      // visibility is driven by the shown set alone.
      current.delete(modelId);
      shown.add(modelId);
    } else {
      current.add(modelId);
      shown.delete(modelId);
    }
    setHiddenModels(channel.hiddenKey, [...current]);
    setShownModels(channel.hiddenKey, [...shown]);
  };

  const setChannelModelsVisible = (channel: ChannelEntry, visible: boolean) => {
    if (!channel.hiddenKey || !channel.capabilities) return;
    setHiddenModels(channel.hiddenKey, visible ? [] : channel.models.map((model) => model.id));
    // 全选 marks every catalog model as explicitly shown so future discoveries
    // on curated-discovery channels stay hidden until the user picks them.
    setShownModels(channel.hiddenKey, visible ? channel.models.map((model) => model.id) : []);
  };

  const setAllAgentModelsVisible = (visible: boolean) => {
    for (const channel of agentChannels) {
      setChannelModelsVisible(channel, visible);
    }
  };

  const toggleModelVisible = (modelId: string) => {
    if (!selectedAgentChannel) return;
    const channel = channels.find((entry) => entry.hiddenKey === selectedAgentChannel.hiddenKey);
    if (channel) toggleChannelModelVisible(channel, modelId);
  };

  const upsertCustomModel = (
    provider: string,
    modelId: string,
    displayName?: string,
    accountId?: string,
    channelLabel?: string,
    extra?: {
      contextSize?: string;
      maxOutputTokens?: string;
      inputModalities?: string[];
      outputModalities?: string[];
      efforts?: string[];
      defaultEffort?: string;
    },
  ) => {
    const trimmedId = modelId.trim();
    if (!trimmedId) return;
    const existing = customModels.find(
      (model) =>
        model.provider === provider && model.accountId === accountId && model.modelId === trimmedId,
    );
    if (existing) {
      onUpdateCustomModels(
        customModels.map((model) =>
          model.id === existing.id
            ? {
                ...model,
                displayName: displayName?.trim() || model.displayName,
                ...(extra?.contextSize !== undefined ? { contextSize: extra.contextSize } : {}),
                ...(extra?.maxOutputTokens !== undefined
                  ? { maxOutputTokens: extra.maxOutputTokens }
                  : {}),
                ...(extra?.inputModalities ? { inputModalities: extra.inputModalities } : {}),
                ...(extra?.outputModalities ? { outputModalities: extra.outputModalities } : {}),
                ...(extra?.efforts?.length ? { efforts: extra.efforts } : {}),
                ...(extra?.defaultEffort ? { defaultEffort: extra.defaultEffort } : {}),
              }
            : model,
        ),
      );
      return;
    }
    const entry: CustomModel = {
      id: customModelId(provider, trimmedId, accountId),
      provider,
      ...(accountId ? { accountId } : {}),
      ...(channelLabel ? { channelLabel } : {}),
      modelId: trimmedId,
      displayName: displayName?.trim() || trimmedId,
      contextSize: extra?.contextSize ?? "",
      ...(extra?.maxOutputTokens ? { maxOutputTokens: extra.maxOutputTokens } : {}),
      ...(extra?.inputModalities ? { inputModalities: extra.inputModalities } : {}),
      ...(extra?.outputModalities ? { outputModalities: extra.outputModalities } : {}),
      ...(extra?.efforts?.length ? { efforts: extra.efforts } : {}),
      ...(extra?.defaultEffort ? { defaultEffort: extra.defaultEffort } : {}),
    };
    onUpdateCustomModels([...customModels, entry]);
  };

  const removeCustomModel = (id: string) => {
    onUpdateCustomModels(customModels.filter((model) => model.id !== id));
  };

  // Third-party add gate: models on an openai-compatible account must pass a
  // real Responses-first probe (sealed key, supervisor-side) before joining
  // the homepage catalog. Native channel models come from official catalogs
  // and skip the gate.
  const [verifyingModelKey, setVerifyingModelKey] = useState<string | null>(null);
  const verifiedAdd = async (
    provider: string,
    modelId: string,
    displayName?: string,
    accountId?: string,
    channelLabel?: string,
    extra?: {
      contextSize?: string;
      maxOutputTokens?: string;
      inputModalities?: string[];
      outputModalities?: string[];
      efforts?: string[];
      defaultEffort?: string;
    },
  ): Promise<boolean> => {
    const trimmedId = modelId.trim();
    if (!trimmedId || verifyingModelKey) return false;
    if (!accountId) {
      upsertCustomModel(provider, trimmedId, displayName, accountId, channelLabel, extra);
      return true;
    }
    const key = `${accountId}:${trimmedId}`;
    setVerifyingModelKey(key);
    try {
      const verdict = await readBridge().verifyChannelModel({
        provider: "openai-compatible",
        accountId,
        model: trimmedId,
      });
      if (!verdict.ok) {
        toast.danger(verdict.error ?? "模型验证失败，未加入首页。");
        return false;
      }
      upsertCustomModel(provider, trimmedId, displayName, accountId, channelLabel, extra);
      toast.success(
        verdict.validatedProtocol === "chat_completions"
          ? `已验证 · Chat Completions，已加入首页。`
          : `已验证 · Responses API，已加入首页。`,
      );
      return true;
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "模型验证失败，未加入首页。");
      return false;
    } finally {
      setVerifyingModelKey(null);
    }
  };

  const updateCustomModel = (id: string, patch: Partial<CustomModel>) => {
    onUpdateCustomModels(
      customModels.map((model) => (model.id === id ? { ...model, ...patch } : model)),
    );
  };

  // —— OpenAI 兼容渠道的拉取与手动添加 ——
  const [fetched, setFetched] = useState<{ models: string[]; loading: boolean; error?: string }>({
    models: [],
    loading: false,
  });
  const [manualDraft, setManualDraft] = useState({ modelId: "", displayName: "" });
  // 添加模型对话框：从手动添加栏/渠道模型列表进入，带上下文与模态默认值。
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const fetchCompatibleModels = async (accountId = selected?.accountId) => {
    // 直接从上游获取该自定义渠道当前可用的模型列表（/models），列出来供用户添加。
    // supervisor 侧 12s 必返回，但 IPC/主进程抖动时 promise 可能悬空——客户端再加
    // 一道 30s 超时，转为可重试的错误态。否则 spinner 常亮且重试按钮被隐藏，用户
    // 只能干等（阶跃星辰渠道实测卡死即此形状）。
    setFetched((current) => ({ models: current.models, loading: true }));
    try {
      const models = await listChannelModelsWithTimeout(accountId);
      setFetched({ models, loading: false });
    } catch (error) {
      setFetched({
        models: [],
        loading: false,
        error: error instanceof Error ? error.message : "获取模型列表失败",
      });
    }
  };
  useEffect(() => {
    setFetched({ models: [], loading: false });
    if (selected?.kind === "openai-compatible") {
      void fetchCompatibleModels(selected.accountId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key]);
  const compatibleCustom = customModels.filter((model) => model.accountId === selected?.accountId);
  const compatibleListed = fetched.models.filter(
    (modelId) => !compatibleCustom.some((model) => model.modelId === modelId),
  );
  const selectedCustom = selected
    ? customModels.filter((model) =>
        selected.accountId
          ? model.accountId === selected.accountId
          : model.provider === selected.kind && !model.accountId,
      )
    : [];

  const totalVisible = channels.reduce((count, channel) => {
    if (channel.kind === "recipes")
      return count + recipes.filter((recipe) => recipe.homepageVisible === true).length;
    if (!channel.hiddenKey || !channel.capabilities)
      return (
        count +
        customModels.filter((model) =>
          channel.accountId
            ? model.accountId === channel.accountId
            : model.provider === channel.kind && !model.accountId,
        ).length
      );
    const hidden = new Set(
      resolveHiddenModelIds(
        channel.capabilities,
        hiddenModels[channel.hiddenKey],
        shownModels[channel.hiddenKey],
      ),
    );
    return count + channel.models.filter((model) => !hidden.has(model.id)).length;
  }, 0);

  // 右栏「已选模型名单」：所有渠道当前在首页选择器可见的模型 + 全部自定义模型。
  const roster = useMemo(() => {
    const agentItems = channels.flatMap((channel) => {
      if (!channel.hiddenKey || !channel.capabilities) return [];
      const hidden = new Set(
        resolveHiddenModelIds(
          channel.capabilities,
          hiddenModels[channel.hiddenKey],
          shownModels[channel.hiddenKey],
        ),
      );
      return channel.models
        .filter((model) => !hidden.has(model.id))
        .map((model) => ({
          type: "agent" as const,
          channelKey: channel.key,
          channelLabel: channel.label,
          kind: channel.kind,
          modelId: model.id,
          label: model.label,
        }));
    });
    const recipeItems = recipes
      .filter((recipe) => recipe.homepageVisible === true)
      .map((recipe) => ({
        type: "recipe" as const,
        id: recipe.id,
        label: recipe.alias?.trim() || recipe.systemName,
        sub: [recipe.lastKnownModel?.displayName, recipe.lastKnownHarness?.displayName]
          .filter(Boolean)
          .join(" · "),
      }));
    const activeAccountIds = new Set(accounts.map((account) => account.accountId));
    const customItems = customModels
      .filter((model) =>
        model.accountId
          ? activeAccountIds.has(model.accountId)
          : configuredProviders.has(model.provider),
      )
      .map((model) => ({
        type: "custom" as const,
        id: model.id,
        channelLabel: model.channelLabel ?? providerLabels.get(model.provider) ?? model.provider,
        kind: model.provider,
        displayName: model.displayName,
        modelId: model.modelId,
        contextSize: model.contextSize,
      }));
    return [...agentItems, ...customItems, ...recipeItems];
  }, [
    channels,
    hiddenModels,
    shownModels,
    customModels,
    providerLabels,
    accounts,
    configuredProviders,
    recipes,
  ]);

  return (
    <div
      data-testid="model-management-page"
      className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3"
    >
      <div
        className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto pr-1"
        data-testid="model-channel-rail"
      >
        <div className="rounded-lg bg-[var(--surface-secondary)] px-3 py-2">
          <p className="text-[11px] text-muted">
            共 {channels.length} 个渠道 · {totalVisible} 个模型在首页可选
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              aria-label="全选全部渠道模型"
              onClick={() => setAllAgentModelsVisible(true)}
              disabled={agentChannels.length === 0}
              className={bulkActionClass}
            >
              全部选中
            </button>
            <button
              type="button"
              aria-label="取消全部渠道模型"
              onClick={() => setAllAgentModelsVisible(false)}
              disabled={agentChannels.length === 0}
              className={bulkActionClass}
            >
              全部取消
            </button>
          </div>
        </div>
        {channels.map((channel) => {
          const visibleCount =
            channel.kind === "recipes"
              ? recipes.filter((recipe) => recipe.homepageVisible === true).length
              : channel.hiddenKey
                ? (() => {
                    if (!channel.capabilities) return 0;
                    const hidden = new Set(
                      resolveHiddenModelIds(
                        channel.capabilities,
                        hiddenModels[channel.hiddenKey],
                        shownModels[channel.hiddenKey],
                      ),
                    );
                    return channel.models.filter((model) => !hidden.has(model.id)).length;
                  })()
                : customModels.filter((model) =>
                    channel.accountId
                      ? model.accountId === channel.accountId
                      : model.provider === channel.kind && !model.accountId,
                  ).length;
          return (
            <button
              key={channel.key}
              type="button"
              onClick={() => setSelectedKey(channel.key)}
              aria-pressed={channel.key === selectedKey}
              className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                channel.key === selectedKey
                  ? "border-[color:var(--hairline-strong)] bg-[var(--row-active)]"
                  : "border-[color:var(--hairline)] bg-[var(--surface)] hover:bg-[var(--row-hover)]"
              }`}
            >
              <ProviderBrandBadge id={channel.kind} label={channel.label} size="compact" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {channel.label}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted">{visibleCount} 个可见</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto pr-1" data-testid="model-channel-detail">
        {!selected ? (
          <div className="rounded-xl border border-[color:var(--hairline)] bg-[var(--surface-secondary)] p-4 text-xs text-muted">
            还没有可用渠道。请先在「渠道与额度」页添加并登录渠道账号。
          </div>
        ) : (
          <section className="rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] p-3">
            <div className="flex items-center gap-2">
              <ProviderBrandBadge id={selected.kind} label={selected.label} size="compact" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-foreground">{selected.label}</h3>
                <p className="text-[11px] text-muted">
                  {selectedAgentChannel
                    ? "勾选的模型会显示在首页模型选择器"
                    : "自定义 API 渠道的模型列表"}
                </p>
              </div>
              {selectedAgentChannel ? (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {selected.kind === "opencode" ? (
                    <button
                      type="button"
                      aria-label="在 OpenCode 中选择模型"
                      title="打开官方 OpenCode TUI，用它自己的模型选择器选择模型"
                      onClick={openOpencodeModelSelector}
                      className="flex items-center gap-1 rounded-md border border-[color:var(--hairline)] px-2 py-1 text-[10px] text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
                    >
                      在 OpenCode 中选择模型
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`获取 ${selected.label} 渠道上游可用模型列表`}
                    title="直接从上游获取该渠道当前可用的模型列表"
                    onClick={() => void fetchChannelModels(selected.kind, selected.label)}
                    disabled={refreshingKinds[selected.kind] === true}
                    className="flex items-center gap-1 rounded-md border border-[color:var(--hairline)] px-2 py-1 text-[10px] text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {refreshingKinds[selected.kind] === true ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    获取模型
                  </button>
                  <button
                    type="button"
                    aria-label={`全选 ${selected.label} 渠道全部模型`}
                    onClick={() => setChannelModelsVisible(selected, true)}
                    className={bulkActionClass}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    aria-label={`取消 ${selected.label} 渠道全部模型`}
                    onClick={() => setChannelModelsVisible(selected, false)}
                    className={bulkActionClass}
                  >
                    全不选
                  </button>
                </div>
              ) : null}
            </div>

            {actionHint ? <p className="mt-2 text-[11px] text-amber-400">{actionHint}</p> : null}

            {selectedAgentChannel && selectedAgentChannel.models.length > 3 ? (
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                <input
                  aria-label={`搜索 ${selected.label} 渠道模型`}
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder="搜索模型 ID 或名称…"
                  className={`${inputClass} pl-8`}
                />
              </div>
            ) : null}

            {selectedAgentChannel && selectedAgentChannel.models.length === 0 ? (
              <p className="mt-3 rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-[11px] text-muted">
                该渠道暂无可用模型。点击右上「获取模型」直接从上游拉取，或在下方手动添加模型 ID。
              </p>
            ) : null}

            {selectedAgentChannel ? (
              <ul className="mt-3 flex flex-col gap-1" data-testid="agent-model-rows">
                {filteredChannelModels.map((model) => {
                  const isVisible = !selectedHiddenSet.has(model.id);
                  return (
                    <li key={model.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isVisible}
                        onClick={() => toggleModelVisible(model.id)}
                        className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-3 py-2.5 text-left hover:border-[color:var(--hairline)] hover:bg-[var(--row-hover)]"
                      >
                        <Check
                          className={`size-4 shrink-0 ${
                            isVisible ? "text-emerald-400" : "text-muted"
                          }`}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            isVisible ? "text-foreground" : "text-muted"
                          }`}
                        >
                          {model.label}
                        </span>
                        <span className="shrink-0 text-xs text-muted">{model.id}</span>
                      </button>
                    </li>
                  );
                })}
                {filteredChannelModels.length === 0 ? (
                  <li className="px-3 py-2 text-[11px] text-muted">
                    没有匹配「{modelQuery.trim()}」的模型。
                  </li>
                ) : null}
              </ul>
            ) : null}

            {selected?.kind === "recipes" ? (
              <ul className="mt-3 flex flex-col gap-1" data-testid="recipe-rows">
                {recipes.map((recipe) => {
                  const isVisible = recipe.homepageVisible === true;
                  const name = recipe.alias?.trim() || recipe.systemName;
                  const sub = [
                    recipe.lastKnownModel?.displayName,
                    recipe.lastKnownHarness?.displayName,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <li key={recipe.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isVisible}
                        onClick={() => setRecipeHomepageVisible(recipe.id, !isVisible)}
                        className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-3 py-2.5 text-left hover:border-[color:var(--hairline)] hover:bg-[var(--row-hover)]"
                      >
                        <Check
                          className={`size-4 shrink-0 ${
                            isVisible ? "text-emerald-400" : "text-muted"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm ${
                              isVisible ? "text-foreground" : "text-muted"
                            }`}
                          >
                            {name}
                          </span>
                          {sub ? (
                            <span className="block truncate text-[11px] text-muted">{sub}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {recipes.length === 0 ? (
                  <li className="px-3 py-2 text-[11px] text-muted">
                    还没有保存的配方。去「合成台 /
                    Harness」合成并保存后，可在这里勾选进首页模型选择器。
                  </li>
                ) : null}
              </ul>
            ) : null}

            {selectedCustom.length > 0 ? (
              <div className="mt-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                  自定义模型（已加入首页）
                </p>
                <ul className="mt-1 flex flex-col gap-2">
                  {selectedCustom.map((model) => (
                    <CustomModelRow
                      key={model.id}
                      model={model}
                      providerLabel={providerLabels.get(model.provider) ?? model.provider}
                      onUpdate={(patch) => updateCustomModel(model.id, patch)}
                      onRemove={() => removeCustomModel(model.id)}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            {selected.kind === "openai-compatible" ? (
              <div className="mt-3">
                {fetched.error ? <p className="text-[11px] text-red-400">{fetched.error}</p> : null}
                {fetched.loading ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted">
                    <Loader2 className="size-3 animate-spin" /> 正在获取模型列表…
                  </p>
                ) : null}
                {compatibleListed.length > 0 ? (
                  <>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                      渠道模型
                    </p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {compatibleListed.map((modelId) => (
                        <li
                          key={modelId}
                          className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-secondary)] px-2 py-1.5"
                        >
                          <span className="truncate text-[11px] text-foreground">{modelId}</span>
                          <button
                            type="button"
                            onClick={() =>
                              void verifiedAdd(
                                resolveThirdPartyHarnessForModel(modelId),
                                modelId,
                                undefined,
                                selected.accountId,
                                selected.label,
                              )
                            }
                            disabled={verifyingModelKey === `${selected.accountId}:${modelId}`}
                            className="flex shrink-0 items-center gap-1 rounded-md border border-[color:var(--hairline)] px-1.5 py-0.5 text-[10px] text-muted hover:bg-[var(--row-hover)] hover:text-foreground disabled:opacity-50"
                          >
                            {verifyingModelKey === `${selected.accountId}:${modelId}` ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Plus className="size-3" />
                            )}{" "}
                            添加
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {!fetched.loading && !fetched.error && fetched.models.length === 0 ? (
                  <p className="mt-1 text-[11px] text-muted">
                    上游暂无可用模型，点击「获取模型」直接从上游拉取最新列表。
                  </p>
                ) : null}
                {!fetched.loading ? (
                  <button
                    type="button"
                    aria-label={`获取 ${selected.label} 上游可用模型列表`}
                    title="直接从上游获取该渠道当前可用的模型列表"
                    onClick={() => void fetchCompatibleModels()}
                    className="mt-2 flex items-center gap-1 rounded-lg border border-[color:var(--hairline)] px-2 py-1 text-[11px] text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
                  >
                    <RefreshCw className="size-3" /> 获取模型
                  </button>
                ) : null}
              </div>
            ) : null}

            {selected?.kind === "recipes" ? null : (
              <div className="mt-3 rounded-lg border border-[color:var(--hairline)] bg-[var(--surface-secondary)] p-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                  手动添加模型
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    aria-label="模型 ID"
                    value={manualDraft.modelId}
                    onChange={(event) =>
                      setManualDraft({ ...manualDraft, modelId: event.target.value })
                    }
                    placeholder="模型 ID，如 gpt-5.3"
                    className={inputClass}
                  />
                  <input
                    aria-label="模型展示名称"
                    value={manualDraft.displayName}
                    onChange={(event) =>
                      setManualDraft({ ...manualDraft, displayName: event.target.value })
                    }
                    placeholder="展示名称（可选）"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    aria-label="打开添加模型对话框"
                    title="打开添加模型对话框，可设置上下文窗口与输入输出类型"
                    onClick={() => setModelDialogOpen(true)}
                    disabled={!manualDraft.modelId.trim() || verifyingModelKey !== null}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-[color:var(--hairline)] px-2 py-1.5 text-[11px] text-muted hover:bg-[var(--row-hover)] hover:text-foreground disabled:opacity-40"
                  >
                    {verifyingModelKey !== null ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Plus className="size-3" />
                    )}{" "}
                    添加
                  </button>
                </div>
              </div>
            )}
            {selected && selected.kind !== "recipes" ? (
              <CustomModelDialog
                open={modelDialogOpen}
                initialModelId={manualDraft.modelId}
                initialDisplayName={manualDraft.displayName}
                providerKind={
                  selected.kind === "openai-compatible"
                    ? resolveThirdPartyHarnessForModel(manualDraft.modelId || "custom")
                    : selected.kind
                }
                {...(selected.kind === "openai-compatible" && selected.accountId
                  ? {
                      // 与页面级拉取共用超时：悬空 promise 必须在对话框里也落回
                      // 错误态，否则“从上游拉取”按钮永久 disabled。
                      onFetchUpstreamModels: () => listChannelModelsWithTimeout(selected.accountId),
                    }
                  : {})}
                verifying={verifyingModelKey !== null}
                onCancel={() => setModelDialogOpen(false)}
                onSave={(values: CustomModelDialogValues) => {
                  void verifiedAdd(
                    selected.kind === "openai-compatible"
                      ? resolveThirdPartyHarnessForModel(values.modelId)
                      : selected.kind,
                    values.modelId,
                    values.displayName || undefined,
                    selected.accountId,
                    selected.accountId ? selected.label : undefined,
                    {
                      contextSize: values.contextSize,
                      maxOutputTokens: values.maxOutputTokens,
                      inputModalities: values.inputModalities,
                      outputModalities: values.outputModalities,
                      ...(values.efforts.length > 0 ? { efforts: values.efforts } : {}),
                      ...(values.defaultEffort ? { defaultEffort: values.defaultEffort } : {}),
                    },
                  ).then((added) => {
                    if (added) {
                      setManualDraft({ modelId: "", displayName: "" });
                      setModelDialogOpen(false);
                    }
                  });
                }}
              />
            ) : null}
          </section>
        )}
      </div>

      <div
        className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto pr-1"
        data-testid="model-roster-panel"
      >
        <div className="rounded-lg bg-[var(--surface-secondary)] px-3 py-2">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[11px] text-muted">
              已选模型名单 · {roster.length} 个
            </p>
            <button
              type="button"
              aria-label="从名单取消全部渠道模型"
              onClick={() => setAllAgentModelsVisible(false)}
              disabled={agentChannels.length === 0}
              className={bulkActionClass}
            >
              全部取消
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted">点击行首勾选可移出首页</p>
        </div>
        {roster.length === 0 ? (
          <div className="rounded-xl border border-[color:var(--hairline)] bg-[var(--surface-secondary)] p-4 text-[11px] text-muted">
            还没有已选模型。在中间列勾选渠道模型即可加入首页选择器。
          </div>
        ) : null}
        {roster.map((item) =>
          item.type === "recipe" ? (
            <div
              key={`roster:recipe:${item.id}`}
              className="flex items-center gap-2.5 rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] px-3 py-2.5"
            >
              <button
                type="button"
                aria-label={`移出 ${item.label}`}
                title="从首页移除该配方"
                onClick={() => setRecipeHomepageVisible(item.id, false)}
                className="shrink-0"
              >
                <Check className="size-4 text-emerald-400 hover:text-red-400" />
              </button>
              <ProviderBrandBadge id="recipes" label="我的配方" size="compact" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{item.label}</span>
                {item.sub ? (
                  <span className="block truncate text-[11px] text-muted">{item.sub}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-muted">我的配方</span>
            </div>
          ) : item.type === "agent" ? (
            <div
              key={`roster:${item.channelKey}:${item.modelId}`}
              className="flex items-center gap-2.5 rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] px-3 py-2.5"
            >
              <button
                type="button"
                aria-label={`移出 ${item.label}`}
                onClick={() => {
                  const channel = channels.find((entry) => entry.key === item.channelKey);
                  if (channel) toggleChannelModelVisible(channel, item.modelId);
                }}
                className="shrink-0"
              >
                <Check className="size-4 text-emerald-400 hover:text-red-400" />
              </button>
              <ProviderBrandBadge id={item.kind} label={item.channelLabel} size="compact" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.label}</span>
              <span className="shrink-0 text-xs text-muted">{item.channelLabel}</span>
            </div>
          ) : (
            <div
              key={`roster:${item.id}`}
              className="rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  aria-label={`移出 ${item.displayName}`}
                  title="从首页移除该自定义模型"
                  onClick={() => removeCustomModel(item.id)}
                  className="shrink-0"
                >
                  <Check className="size-4 text-emerald-400 hover:text-red-400" />
                </button>
                <ProviderBrandBadge id={item.kind} label={item.channelLabel} size="compact" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {item.displayName}
                </span>
                <span className="shrink-0 text-xs text-muted">{item.channelLabel}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="truncate text-[11px] text-muted">{item.modelId}</span>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
