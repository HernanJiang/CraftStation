import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

const SetLaunchContext = createContext<((node: ReactNode | null) => void) | null>(null);
const LaunchNodeContext = createContext<ReactNode>(null);

/** Hosts the draft Branch/Worktree controls so they can render in the context bar. */
export function DraftGitLaunchSlotProvider(props: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  return (
    <SetLaunchContext.Provider value={setNode}>
      <LaunchNodeContext.Provider value={node}>{props.children}</LaunchNodeContext.Provider>
    </SetLaunchContext.Provider>
  );
}

export function useDraftGitLaunchControls(): ReactNode {
  return useContext(LaunchNodeContext);
}

/** True when the Home/conversation composer can portal Git controls into the context bar. */
export function useDraftGitLaunchSlotActive(): boolean {
  return useContext(SetLaunchContext) !== null;
}

/**
 * When a slot provider is present (full new-conversation page), render `children`
 * in the context bar above the input. Otherwise keep them in place (compact /
 * quick-composer still needs the below row).
 */
export function DraftGitLaunchPortal(props: { children: ReactNode }) {
  const setNode = useContext(SetLaunchContext);
  const { children } = props;
  useLayoutEffect(() => {
    if (!setNode) return;
    setNode(children);
    return () => setNode(null);
  }, [setNode, children]);
  if (setNode) return null;
  return <>{children}</>;
}
