import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { Project } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { SidebarProjectHeader } from "./SidebarProjectHeader";
import { SidebarProjectSection } from "./SidebarProjectSection";

const openNewThreadMock = vi.fn<(projectId?: string) => void>();

vi.mock("@/renderer/actions/threadActions", () => ({
  openNewThread: (projectId?: string) => openNewThreadMock(projectId),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({}),
}));

vi.mock("@dnd-kit/react", () => ({
  useDraggable: () => undefined,
}));

vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({ ref: () => {} }),
}));

vi.mock("@heroui/react", () => {
  const Tooltip = Object.assign((props: { children: ReactNode }) => <>{props.children}</>, {
    Trigger: (props: { children: ReactNode }) => <>{props.children}</>,
    Content: (props: { children: ReactNode }) => <div>{props.children}</div>,
  });
  const Dropdown = Object.assign((props: { children: ReactNode }) => <>{props.children}</>, {
    Trigger: (props: { children: ReactNode }) => <>{props.children}</>,
    Popover: (props: { children: ReactNode }) => <>{props.children}</>,
    Menu: (props: { children: ReactNode }) => <>{props.children}</>,
    Item: (props: { children: ReactNode }) => <>{props.children}</>,
  });
  const Label = (props: { children: ReactNode }) => <>{props.children}</>;
  return { Tooltip, Dropdown, Label };
});

const project: Project = {
  id: "project-1",
  remoteServerId: "server-1",
  remoteId: "remote-proj-1",
  name: "agent-runtime",
  location: {
    kind: "posix",
    path: "/home/user/agent-runtime",
  },
  createdAt: "2026-06-01T00:00:00.000Z",
};

function seedRemote(status: "connecting" | "online" | "offline" | "error"): void {
  useRemoteServersStore.setState({
    servers: [
      {
        desktopId: "server-1",
        label: "H1FCM6T4GX",
        endpoint: "ssh://user@h1fcm6t4gx.internal",

        accessToken: "token",
        scopes: ["projects:manage"],
      },
    ],
    runtime: {
      "server-1": {
        status,
        projects: [],
        threads: [],
        agents: [],
      } as any,
    },
  });
}

function renderHeader() {
  return render(
    <SidebarProjectHeader
      project={project}
      isCollapsed={false}
      isDragging={false}
      isUnreachable={false}
    />,
  );
}

describe("SidebarProjectHeader", () => {
  beforeEach(() => {
    openNewThreadMock.mockReset();
    useAppStore.setState({
      projects: [project],
      threads: [],
    });
    useSidebarUiStore.setState({
      pinnedProjectIds: [],
      pinnedProjectAt: {},
      collapsedProjects: {},
    });
    seedRemote("online");
  });

  it("shows the bare server name without the CraftStation brand prefix", () => {
    renderHeader();

    expect(screen.getByText("H1FCM6T4GX")).toBeInTheDocument();
  });

  it("lights the connection dot green while the remote server is online", () => {
    renderHeader();

    expect(screen.getByTitle("Online")).toHaveClass("bg-success");
  });

  it("dims the connection dot when the remote server is offline", () => {
    seedRemote("offline");

    const { container } = render(
      <SidebarProjectHeader
        project={project}
        isCollapsed={false}
        isDragging={false}
        isUnreachable={true}
      />,
    );

    expect(screen.getByTitle("Offline")).toHaveClass("bg-default-400");
    expect(container.querySelector(".craftstation-sidebar-project-nudge")).toHaveClass(
      "opacity-50",
    );
    expect(
      screen.queryByRole("button", { name: `Git status for ${project.name}` }),
    ).not.toBeInTheDocument();
  });

  it("hides the project body while the remote server is offline", () => {
    seedRemote("offline");

    render(<SidebarProjectSection projectId={project.id} projectIndex={0} sortMode="updated" />);

    expect(screen.queryByText("New thread")).not.toBeInTheDocument();
  });

  it("shows the project body while the remote server is online", () => {
    render(<SidebarProjectSection projectId={project.id} projectIndex={0} sortMode="updated" />);

    expect(screen.queryByText("New thread")).not.toBeInTheDocument();
  });

  it("removes project-level Files, Terminal and Git controls, keeping the new chat button", () => {
    renderHeader();

    expect(
      screen.queryByRole("button", { name: `Files for ${project.name}` }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Terminal for ${project.name}` }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `New chat in ${project.name}` })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Git status for ${project.name}` }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("sync-status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `New chat in ${project.name}` }));
    expect(openNewThreadMock).toHaveBeenCalledWith(project.id);
  });

  it("pins the project from the header pin button without collapsing or opening a chat", () => {
    renderHeader();

    expect(
      screen.queryByRole("button", { name: `Collapse ${project.name}` }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Pin ${project.name}` }));

    const pinned = useSidebarUiStore.getState();
    expect(pinned.pinnedProjectIds).toEqual([project.id]);
    expect(pinned.pinnedProjectAt[project.id]).toEqual(expect.any(Number));
    expect(pinned.collapsedProjects[project.id]).toBeUndefined();
    expect(openNewThreadMock).not.toHaveBeenCalled();
  });

  it("unpins a pinned project from the same button", () => {
    useSidebarUiStore.setState({
      pinnedProjectIds: [project.id],
      pinnedProjectAt: { [project.id]: 1 },
    });
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: `Unpin ${project.name}` }));

    expect(useSidebarUiStore.getState().pinnedProjectIds).toEqual([]);
    expect(useSidebarUiStore.getState().pinnedProjectAt[project.id]).toBeUndefined();
  });

  it("keeps the pin button while the project group is collapsed", () => {
    render(
      <SidebarProjectHeader
        project={project}
        isCollapsed={true}
        isDragging={false}
        isUnreachable={false}
      />,
    );

    expect(screen.getByRole("button", { name: `Pin ${project.name}` })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Collapse ${project.name}` }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `New chat in ${project.name}` })).toBeInTheDocument();
  });
});
