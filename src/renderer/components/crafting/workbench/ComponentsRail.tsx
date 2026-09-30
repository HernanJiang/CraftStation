import { useEffect } from "react";
import {
  AppWindow,
  Blocks,
  Bot,
  CalendarClock,
  Globe,
  Lock,
  MousePointerClick,
  Network,
  Server,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import {
  BUILT_IN_MCP_SERVER_IDS,
  BUILT_IN_MCP_SERVER_NAMES,
  type BuiltInMcpServerId,
} from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { usePlugins } from "@/renderer/state/pluginsStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { INVENTORY_GRID_CLASS, IngredientGlyph, InventorySlot } from "./InventorySlot";

const BUILT_IN_MCP_ICONS: Record<BuiltInMcpServerId, LucideIcon> = {
  browser: Globe,
  crossagents: Network,
  "own-subagents": Bot,
  chrome: AppWindow,
  "computer-use": MousePointerClick,
  "app-controls": Blocks,
  schedule: CalendarClock,
};

/**
 * Components rail: the right column of the "合成台与配方" tab, presented as a
 * uniform "原料" inventory of square slots.
 *
 * Read-only inventory — mutation lives in the MCP / Skills / Plugins settings
 * pages (each section links there). The compatibility bridge (CLIProxyAPI) is
 * deliberately absent: it is invisible infrastructure the bench auto-starts on
 * demand. Subagent scheduling and context management policies have no data
 * model yet, so they render as honest reserved slots instead of fake toggles.
 */
export function ComponentsRail() {
  const customServers = useSharedSettings((s) => s.mcpServers) ?? [];
  const disabledBuiltIns = useSharedSettings((s) => s.disabledBuiltInMcpServers);
  const installedPlugins = useSharedSettings((s) => s.installedPlugins);
  const plugins = usePlugins((s) => s.plugins);
  const pluginsLoaded = usePlugins((s) => s.loaded);
  const pluginsLoading = usePlugins((s) => s.loading);
  const pluginsError = usePlugins((s) => s.error);
  const loadPlugins = usePlugins((s) => s.load);
  const openSettingsSection = usePanelStore((s) => s.openSettingsSection);

  useEffect(() => {
    if (!pluginsLoaded && !pluginsLoading) void loadPlugins();
  }, [pluginsLoaded, pluginsLoading, loadPlugins]);

  const skills = plugins.flatMap((plugin) =>
    plugin.skills.map((skill) => ({ plugin: plugin.name, folder: skill.folder })),
  );
  const isSkillEnabled = (pluginName: string, folder: string) => {
    const state = installedPlugins[pluginName];
    if (state?.enabled === false) return false;
    return !(state?.disabledSkillIds ?? []).includes(folder);
  };

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
      data-testid="components-rail"
      aria-label="原料清单"
    >
      <header className="px-1">
        <h2 className="text-sm font-semibold text-neutral-200">原料</h2>
        <p className="mt-0.5 text-[10px] text-neutral-500">MCP 服务器 · Skills · 策略</p>
      </header>

      <div data-testid="components-rail-mcp">
        <header className="flex items-center justify-between px-1 pb-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
            MCP 服务器
            <span className="rounded-full bg-white/5 px-1.5 py-px text-[10px] font-normal text-neutral-400">
              {customServers.length + BUILT_IN_MCP_SERVER_IDS.length}
            </span>
          </h3>
          <button
            type="button"
            onClick={() => openSettingsSection("mcpServers")}
            className="rounded px-1 py-0.5 text-[10px] text-neutral-500 transition-colors hover:bg-white/10 hover:text-white"
          >
            管理
          </button>
        </header>
        <div className={INVENTORY_GRID_CLASS}>
          {customServers.map((server) => (
            <InventorySlot
              key={server.id}
              name={server.name}
              visual={<IngredientGlyph icon={Server} tone="custom" />}
              statusDot={server.enabled !== false ? "on" : "off"}
              title={`${server.name} · 自定义 MCP`}
              ariaLabel={`${server.name} · 自定义 MCP`}
              testId="component-mcp-row"
            />
          ))}
          {BUILT_IN_MCP_SERVER_IDS.map((id) => {
            const disabled = disabledBuiltIns?.[id] === true;
            const label = `${BUILT_IN_MCP_SERVER_NAMES[id]} · 内置服务`;
            return (
              <InventorySlot
                key={id}
                name={BUILT_IN_MCP_SERVER_NAMES[id]}
                visual={<IngredientGlyph icon={BUILT_IN_MCP_ICONS[id]} tone="mcp" />}
                statusDot={disabled ? "off" : "on"}
                muted={disabled}
                title={label}
                ariaLabel={label}
                testId="component-mcp-row"
              />
            );
          })}
        </div>
      </div>

      <div data-testid="components-rail-skills">
        <header className="flex items-center justify-between px-1 pb-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
            Skills
            <span className="rounded-full bg-white/5 px-1.5 py-px text-[10px] font-normal text-neutral-400">
              {skills.length}
            </span>
          </h3>
          <button
            type="button"
            onClick={() => openSettingsSection("skills")}
            className="rounded px-1 py-0.5 text-[10px] text-neutral-500 transition-colors hover:bg-white/10 hover:text-white"
          >
            管理
          </button>
        </header>
        {!pluginsLoaded || pluginsLoading ? (
          <p className="px-1 text-[10px] text-neutral-500">读取插件清单中…</p>
        ) : pluginsError ? (
          <p className="px-1 text-[10px] text-neutral-500">插件清单读取失败，去插件页重试</p>
        ) : skills.length === 0 ? (
          <p className="px-1 text-[10px] text-neutral-500">暂无已安装插件 Skills</p>
        ) : (
          <div className={INVENTORY_GRID_CLASS}>
            {skills.map((skill) => {
              const enabled = isSkillEnabled(skill.plugin, skill.folder);
              const label = `${skill.folder} · ${skill.plugin}`;
              return (
                <InventorySlot
                  key={`${skill.plugin}/${skill.folder}`}
                  name={skill.folder}
                  visual={<IngredientGlyph icon={WandSparkles} tone="skill" />}
                  statusDot={enabled ? "on" : "off"}
                  muted={!enabled}
                  title={label}
                  ariaLabel={label}
                  testId="component-skill-row"
                />
              );
            })}
          </div>
        )}
      </div>

      <div data-testid="components-rail-subagent-policy">
        <header className="px-1 pb-1.5">
          <h3 className="text-xs font-semibold text-neutral-300">子Agent调度策略</h3>
        </header>
        <div className={INVENTORY_GRID_CLASS}>
          <InventorySlot
            tone="dashed"
            name="暂未开放"
            visual={<IngredientGlyph icon={Lock} tone="reserved" />}
          />
        </div>
      </div>

      <div data-testid="components-rail-context-policy">
        <header className="px-1 pb-1.5">
          <h3 className="text-xs font-semibold text-neutral-300">上下文管理策略</h3>
        </header>
        <div className={INVENTORY_GRID_CLASS}>
          <InventorySlot
            tone="dashed"
            name="暂未开放"
            visual={<IngredientGlyph icon={Lock} tone="reserved" />}
          />
        </div>
      </div>
    </section>
  );
}
