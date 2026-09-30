import { useEffect } from "react";
import { BUILT_IN_MCP_SERVER_IDS, BUILT_IN_MCP_SERVER_NAMES } from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { usePlugins } from "@/renderer/state/pluginsStore";
import { usePanelStore } from "@/renderer/state/panelStore";

/**
 * Components rail: the right column of the "合成台与配方" tab.
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
      aria-label="组件栏"
    >
      <div data-testid="components-rail-mcp">
        <header className="flex items-center justify-between px-1 pb-1.5">
          <h3 className="text-xs font-semibold text-neutral-300">
            MCP 服务器{" "}
            <span className="ml-1 text-[10px] font-normal text-neutral-500">
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
        <div className="flex flex-col gap-1.5">
          {customServers.map((server) => (
            <div
              key={server.id}
              title={server.description || server.name}
              data-testid="component-mcp-row"
              className="flex min-w-0 items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5"
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  server.enabled !== false ? "bg-emerald-400" : "bg-neutral-600"
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-neutral-200">{server.name}</span>
                <span className="block truncate text-[9px] text-neutral-500">自定义 MCP</span>
              </span>
            </div>
          ))}
          {BUILT_IN_MCP_SERVER_IDS.map((id) => (
            <div
              key={id}
              title={BUILT_IN_MCP_SERVER_NAMES[id]}
              data-testid="component-mcp-row"
              className="flex min-w-0 items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5"
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  disabledBuiltIns?.[id] === true ? "bg-neutral-600" : "bg-emerald-400"
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-neutral-200">
                  {BUILT_IN_MCP_SERVER_NAMES[id]}
                </span>
                <span className="block truncate text-[9px] text-neutral-500">内置服务</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div data-testid="components-rail-skills">
        <header className="flex items-center justify-between px-1 pb-1.5">
          <h3 className="text-xs font-semibold text-neutral-300">
            Skills{" "}
            <span className="ml-1 text-[10px] font-normal text-neutral-500">{skills.length}</span>
          </h3>
          <button
            type="button"
            onClick={() => openSettingsSection("skills")}
            className="rounded px-1 py-0.5 text-[10px] text-neutral-500 transition-colors hover:bg-white/10 hover:text-white"
          >
            管理
          </button>
        </header>
        <div className="flex flex-col gap-1.5">
          {!pluginsLoaded || pluginsLoading ? (
            <p className="px-1 text-[10px] text-neutral-500">读取插件清单中…</p>
          ) : pluginsError ? (
            <p className="px-1 text-[10px] text-neutral-500">插件清单读取失败，去插件页重试</p>
          ) : skills.length === 0 ? (
            <p className="px-1 text-[10px] text-neutral-500">暂无已安装插件 Skills</p>
          ) : (
            skills.map((skill) => (
              <div
                key={`${skill.plugin}/${skill.folder}`}
                title={`${skill.folder} · ${skill.plugin}`}
                data-testid="component-skill-row"
                className="flex min-w-0 items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5"
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    isSkillEnabled(skill.plugin, skill.folder) ? "bg-emerald-400" : "bg-neutral-600"
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-neutral-200">
                    {skill.folder}
                  </span>
                  <span className="block truncate text-[9px] text-neutral-500">{skill.plugin}</span>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div data-testid="components-rail-subagent-policy">
        <header className="px-1 pb-1.5">
          <h3 className="text-xs font-semibold text-neutral-300">子Agent调度策略</h3>
        </header>
        <div className="rounded-lg border border-dashed border-white/10 px-2 py-1.5 text-[10px] text-neutral-600">
          暂未开放
        </div>
      </div>

      <div data-testid="components-rail-context-policy">
        <header className="px-1 pb-1.5">
          <h3 className="text-xs font-semibold text-neutral-300">上下文管理策略</h3>
        </header>
        <div className="rounded-lg border border-dashed border-white/10 px-2 py-1.5 text-[10px] text-neutral-600">
          暂未开放
        </div>
      </div>
    </section>
  );
}
