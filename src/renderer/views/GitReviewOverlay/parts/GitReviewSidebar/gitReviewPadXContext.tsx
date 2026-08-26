import { createContext, useContext, type ReactNode } from "react";

/**
 * Horizontal padding on file/accordion rows. Docked git panel uses a `px-0` column
 * (`gitPanelSidebarColumnClass`) so `px-2` here does not double with column padding.
 */
type GitReviewPadding = { rowPadX: "px-0" | "px-2"; sectionPadX: "px-0" | "px-2" };

const defaultPadding: GitReviewPadding = { rowPadX: "px-2", sectionPadX: "px-0" };

const GitReviewPaddingContext = createContext<GitReviewPadding>(defaultPadding);

export function GitReviewPadXProvider(props: {
  children: ReactNode;
  /** “panel” = right-side git tool; “overlay” = full-page git review */
  rowPadX: "px-0" | "px-2";
  /**
   * Commit / PR / merge blocks: in docked `panel` the column is `px-0`, so `px-2` here matches
   * file rows; overlay already insets the column, so `px-0` keeps a single horizontal inset.
   */
  sectionPadX?: "px-0" | "px-2";
}) {
  const sectionPadX = props.sectionPadX ?? "px-0";
  return (
    <GitReviewPaddingContext.Provider value={{ rowPadX: props.rowPadX, sectionPadX }}>
      {props.children}
    </GitReviewPaddingContext.Provider>
  );
}

/** File / group row lines (second horizontal layer, like SidebarButton). */
export function useGitReviewRowPadX() {
  return useContext(GitReviewPaddingContext).rowPadX;
}

/** Bordered section roots: commit, PR, merge, conflict actions. */
export function useGitReviewSectionPadX() {
  return useContext(GitReviewPaddingContext).sectionPadX;
}
