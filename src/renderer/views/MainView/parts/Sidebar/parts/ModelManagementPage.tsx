import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, RefreshCw, X } from "lucide-react";
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
import { customModelId, type CustomModel } from "@/renderer/components/thread/customModelCatalog";
import type { SharedSettings } from "@/shared/settings";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-neutral-500 focus:border-white/25";
const bulkActionClass =
  "rounded-md border border-white/10 px-2 py-1 text-[10px] text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

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

function CustomModelRow(props: {
  model: CustomModel;
  providerLabel: string;
  onUpdate: (patch: Partial<CustomModel>) => void;
  onRemove: () => void;
}) {
  const { model, providerLabel, onUpdate, onRemove } = props;
  return (
    <li className="rounded-lg bg-black/20 p-2" data-testid={`custom-model-${model.id}`}>
      <div className="flex items-center gap-2">
        <input
          aria-label="模型展示名称"
          value={model.displayName}
          onChange={(event) => onUpdate({ displayName: event.target.value })}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-foreground outline-none focus:border-white/25"
        />
        <span className="shrink-0 text-[10px] text-neutral-500">{providerLabel}</span>
        <span className="shrink-0 text-[10px] text-neutral-500">{model.modelId}</span>
        <button
          type="button"
          aria-label={`移除 ${model.displayName}`}
          onClick={onRemove}
          className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>
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
  const providerOrder = useSharedSettings((state) => state.usage.providerOrder);
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
      })
      .filter((channel) => channel.models.length > 0);
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
    return entries;
  }, [agentChannels, compatibleAccounts]);

  const [selectedKey, setSelectedKey] = useState<string>("");
  useEffect(() => {
    if (channels.length === 0) return;
    if (!channels.some((channel) => channel.key === selectedKey)) {
      setSelectedKey(channels[0]!.key);
    }
  }, [channels, selectedKey]);

  const selected = channels.find((channel) => channel.key === selectedKey);
  const selectedAgentChannel =
    selected && selected.hiddenKey && selected.capabilities
      ? {
          hiddenKey: selected.hiddenKey,
          capabilities: selected.capabilities,
          models: selected.models,
        }
      : undefined;
  // 与设置页一致：可见性 = capabilities 默认 + 用户显式 hidden 列表的并集的反面。
  const selectedHiddenSet = selectedAgentChannel
    ? new Set(
        resolveHiddenModelIds(
          selectedAgentChannel.capabilities,
          hiddenModels[selectedAgentChannel.hiddenKey],
        ),
      )
    : new Set<string>();

  const toggleChannelModelVisible = (channel: ChannelEntry, modelId: string) => {
    if (!channel.hiddenKey || !channel.capabilities) return;
    const current = new Set(
      resolveHiddenModelIds(channel.capabilities, hiddenModels[channel.hiddenKey]),
    );
    if (current.has(modelId)) current.delete(modelId);
    else current.add(modelId);
    setHiddenModels(channel.hiddenKey, [...current]);
  };

  const setChannelModelsVisible = (channel: ChannelEntry, visible: boolean) => {
    if (!channel.hiddenKey || !channel.capabilities) return;
    setHiddenModels(channel.hiddenKey, visible ? [] : channel.models.map((model) => model.id));
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
            ? { ...model, displayName: displayName?.trim() || model.displayName }
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
      contextSize: "",
    };
    onUpdateCustomModels([...customModels, entry]);
  };

  const removeCustomModel = (id: string) => {
    onUpdateCustomModels(customModels.filter((model) => model.id !== id));
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
  const fetchCompatibleModels = async (accountId = selected?.accountId) => {
    setFetched((current) => ({ ...current, loading: true }));
    try {
      const response = await readBridge().listChannelModels({
        provider: "openai-compatible",
        ...(accountId ? { accountId } : {}),
      });
      setFetched({ models: response.models, loading: false });
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
      resolveHiddenModelIds(channel.capabilities, hiddenModels[channel.hiddenKey]),
    );
    return count + channel.models.filter((model) => !hidden.has(model.id)).length;
  }, 0);

  // 右栏「已选模型名单」：所有渠道当前在首页选择器可见的模型 + 全部自定义模型。
  const roster = useMemo(() => {
    const agentItems = channels.flatMap((channel) => {
      if (!channel.hiddenKey || !channel.capabilities) return [];
      const hidden = new Set(
        resolveHiddenModelIds(channel.capabilities, hiddenModels[channel.hiddenKey]),
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
    return [...agentItems, ...customItems];
  }, [channels, hiddenModels, customModels, providerLabels, accounts, configuredProviders]);

  return (
    <div
      data-testid="model-management-page"
      className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3"
    >
      <div
        className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto pr-1"
        data-testid="model-channel-rail"
      >
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-[11px] text-neutral-400">
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
          const visibleCount = channel.hiddenKey
            ? (() => {
                if (!channel.capabilities) return 0;
                const hidden = new Set(
                  resolveHiddenModelIds(channel.capabilities, hiddenModels[channel.hiddenKey]),
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
                  ? "border-white/20 bg-white/10"
                  : "border-white/5 bg-[#1c1d22] hover:bg-white/[0.08]"
              }`}
            >
              <ProviderBrandBadge id={channel.kind} label={channel.label} size="compact" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {channel.label}
                </span>
                <span className="mt-0.5 block text-[11px] text-neutral-400">
                  {visibleCount} 个可见
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto pr-1" data-testid="model-channel-detail">
        {!selected ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-neutral-400">
            还没有可用渠道。请先在「添加渠道与查看用量」页添加并登录渠道账号。
          </div>
        ) : (
          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center gap-2">
              <ProviderBrandBadge id={selected.kind} label={selected.label} size="compact" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-foreground">{selected.label}</h3>
                <p className="text-[11px] text-neutral-500">
                  {selectedAgentChannel
                    ? "勾选的模型会显示在首页模型选择器"
                    : "自定义 API 渠道的模型列表"}
                </p>
              </div>
              {selectedAgentChannel ? (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
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

            {selectedAgentChannel ? (
              <ul className="mt-3 flex flex-col gap-1" data-testid="agent-model-rows">
                {selectedAgentChannel.models.map((model) => {
                  const isVisible = !selectedHiddenSet.has(model.id);
                  return (
                    <li key={model.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isVisible}
                        onClick={() => toggleModelVisible(model.id)}
                        className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-3 py-2.5 text-left hover:border-white/10 hover:bg-white/5"
                      >
                        <Check
                          className={`size-4 shrink-0 ${
                            isVisible ? "text-emerald-400" : "text-neutral-600"
                          }`}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            isVisible ? "text-foreground" : "text-neutral-500"
                          }`}
                        >
                          {model.label}
                        </span>
                        <span className="shrink-0 text-xs text-neutral-500">{model.id}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {selectedCustom.length > 0 ? (
              <div className="mt-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
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
                  <p className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                    <Loader2 className="size-3 animate-spin" /> 正在获取模型列表…
                  </p>
                ) : null}
                {compatibleListed.length > 0 ? (
                  <>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                      渠道模型
                    </p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {compatibleListed.map((modelId) => (
                        <li
                          key={modelId}
                          className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-2 py-1.5"
                        >
                          <span className="truncate text-[11px] text-neutral-200">{modelId}</span>
                          <button
                            type="button"
                            onClick={() =>
                              upsertCustomModel(
                                "codex",
                                modelId,
                                undefined,
                                selected.accountId,
                                selected.label,
                              )
                            }
                            className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-white/10 hover:text-white"
                          >
                            <Plus className="size-3" /> 添加
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {!fetched.loading ? (
                  <button
                    type="button"
                    onClick={() => void fetchCompatibleModels()}
                    className="mt-2 flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/10 hover:text-white"
                  >
                    <RefreshCw className="size-3" /> 重新获取模型列表
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-3 rounded-lg bg-black/20 p-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
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
                  onClick={() => {
                    upsertCustomModel(
                      selected.kind === "openai-compatible" ? "codex" : selected.kind,
                      manualDraft.modelId,
                      manualDraft.displayName,
                      selected.accountId,
                      selected.accountId ? selected.label : undefined,
                    );
                    setManualDraft({ modelId: "", displayName: "" });
                  }}
                  disabled={!manualDraft.modelId.trim()}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-neutral-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  <Plus className="size-3" /> 添加
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      <div
        className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto pr-1"
        data-testid="model-roster-panel"
      >
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[11px] text-neutral-400">
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
          <p className="mt-1 text-[10px] text-neutral-500">
            点击行首勾选可移出首页；自定义 API 模型需单独删除
          </p>
        </div>
        {roster.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-[11px] text-neutral-400">
            还没有已选模型。在中间列勾选渠道模型即可加入首页选择器。
          </div>
        ) : null}
        {roster.map((item) =>
          item.type === "agent" ? (
            <div
              key={`roster:${item.channelKey}:${item.modelId}`}
              className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5"
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
              <span className="shrink-0 text-xs text-neutral-400">{item.channelLabel}</span>
            </div>
          ) : (
            <div
              key={`roster:${item.id}`}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  aria-label={`移除 ${item.displayName}`}
                  onClick={() => removeCustomModel(item.id)}
                  className="shrink-0 rounded-md p-0.5 text-neutral-400 hover:bg-white/10 hover:text-red-400"
                >
                  <X className="size-4" />
                </button>
                <ProviderBrandBadge id={item.kind} label={item.channelLabel} size="compact" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {item.displayName}
                </span>
                <span className="shrink-0 text-xs text-neutral-400">{item.channelLabel}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="truncate text-[11px] text-neutral-500">{item.modelId}</span>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
