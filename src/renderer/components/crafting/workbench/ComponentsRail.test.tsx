import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { BUILT_IN_MCP_SERVER_IDS, type McpServer } from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { usePlugins } from "@/renderer/state/pluginsStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { seedBuiltInPlugins } from "@/renderer/testUtils/plugins";
import { ComponentsRail } from "./ComponentsRail";

const customServer: McpServer = {
  id: "mcp-my-tools",
  name: "my-tools",
  description: "",
  enabled: true,
  timeoutMs: 30_000,
  transport: { type: "stdio", command: "my-tools", args: [], env: {} },
};

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    listPlugins: vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error("no bridge")),
    refreshPlugins: vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error("no bridge")),
  }),
  isRemoteSession: () => false,
}));

describe("ComponentsRail", () => {
  beforeEach(() => {
    useSharedSettings.setState({ mcpServers: [], installedPlugins: {} });
    usePlugins.setState({
      plugins: [],
      userPluginsDir: "",
      loaded: true,
      loading: false,
      error: undefined,
      revision: 0,
    });
    usePanelStore.setState({ settingsOpen: false, settingsSection: null });
  });

  it("lists custom and built-in MCP servers with a manage jump", () => {
    useSharedSettings.setState({ mcpServers: [customServer] });
    render(<ComponentsRail />);

    const section = screen.getByTestId("components-rail-mcp");
    expect(section.textContent).toContain("my-tools");
    expect(section.textContent).toContain("自定义 MCP");
    // Built-ins always listed from settings state.
    expect(screen.getAllByTestId("component-mcp-row")).toHaveLength(
      1 + BUILT_IN_MCP_SERVER_IDS.length,
    );

    fireEvent.click(screen.getAllByText("管理")[0]!);
    expect(usePanelStore.getState().settingsOpen).toBe(true);
    expect(usePanelStore.getState().settingsSection).toBe("mcpServers");
  });

  it("lists installed plugin skills once loaded", () => {
    seedBuiltInPlugins();
    render(<ComponentsRail />);

    const section = screen.getByTestId("components-rail-skills");
    expect(screen.getAllByTestId("component-skill-row").length).toBeGreaterThan(0);
    expect(section.textContent).not.toContain("读取插件清单中");
  });

  it("keeps scheduling policies as honest reserved slots", () => {
    render(<ComponentsRail />);

    expect(screen.getByTestId("components-rail-subagent-policy")).toHaveTextContent("暂未开放");
    expect(screen.getByTestId("components-rail-context-policy")).toHaveTextContent("暂未开放");
  });

  it("never surfaces the compatibility bridge", () => {
    render(<ComponentsRail />);

    const rail = screen.getByTestId("components-rail");
    expect(rail.textContent).not.toMatch(/CLIProxyAPI|兼容桥|启动桥|停止桥/);
  });
});
