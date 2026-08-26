import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { Project } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { SelectProjectForThreadModal } from "./SelectProjectForThreadModal";

const openNewThreadMock = vi.fn<(projectId?: string) => void>();

vi.mock("@/renderer/actions/threadActions", () => ({
  openNewThread: (projectId?: string) => openNewThreadMock(projectId),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({}),
}));

vi.mock("@heroui/react", () => {
  const Modal = Object.assign(
    (props: { children: ReactNode }) => <div>{props.children}</div>,
    {
      Backdrop: (props: { isOpen?: boolean; children: ReactNode }) =>
        props.isOpen ? <div data-testid="modal-backdrop">{props.children}</div> : null,
      Container: (props: { children: ReactNode }) => <div>{props.children}</div>,
      Dialog: (props: { children: ReactNode }) => <div>{props.children}</div>,
      Header: (props: { children: ReactNode }) => <div>{props.children}</div>,
      Heading: (props: { children: ReactNode }) => <h1>{props.children}</h1>,
      Body: (props: { children: ReactNode }) => <div>{props.children}</div>,
      Footer: (props: { children: ReactNode }) => <div>{props.children}</div>,
      CloseTrigger: () => <button type="button">close</button>,
    },
  );
  const Button = (props: { children: ReactNode; onPress?: () => void }) => (
    <button type="button" onClick={props.onPress}>
      {props.children}
    </button>
  );
  return { Modal, Button };
});

const sampleProject1: Project = {
  id: "proj-1",
  name: "CodexRouter",
  location: { kind: "windows", path: "D:\\Work\\CodexRouter" },
  createdAt: "2026-01-01T00:00:00Z",
};

const sampleProject2: Project = {
  id: "proj-2",
  name: "CraftStation",
  location: { kind: "windows", path: "D:\\Work\\CraftStation" },
  createdAt: "2026-01-01T00:00:00Z",
};

describe("SelectProjectForThreadModal", () => {
  beforeEach(() => {
    openNewThreadMock.mockReset();
    useAppStore.setState({
      projects: [sampleProject1, sampleProject2],
      threads: [],
    });
    usePanelStore.setState({ selectProjectModalOpen: true });
  });

  it("renders projects list and starts new thread on click", () => {
    render(<SelectProjectForThreadModal />);

    expect(screen.getByText("New chat in project")).toBeInTheDocument();
    expect(screen.getByText("CodexRouter")).toBeInTheDocument();
    expect(screen.getByText("CraftStation")).toBeInTheDocument();

    fireEvent.click(screen.getByText("CodexRouter"));

    expect(openNewThreadMock).toHaveBeenCalledWith("proj-1");
    expect(usePanelStore.getState().selectProjectModalOpen).toBe(false);
  });
});
