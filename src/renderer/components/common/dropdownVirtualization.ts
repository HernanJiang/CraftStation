// React Aria's list virtualizer does more layout work while scrolling into
// previously unseen rows, which feels noticeably slower on modest dropdowns.
// Keep virtualization for genuinely large menus only.
export const LARGE_DROPDOWN_VIRTUALIZATION_THRESHOLD = 200;
export const COMPACT_DROPDOWN_ROW_HEIGHT = 28;
export const MENU_DROPDOWN_ROW_HEIGHT = 28;
export const SELECT_DROPDOWN_ROW_HEIGHT = 48;

// HeroUI/React Aria virtualizers scroll best when the rendered row height matches
// the fixed ListLayout.rowHeight exactly instead of relying on min-height alone.
export const VIRTUALIZED_COMPACT_DROPDOWN_ITEM_CLASS =
  "[&_.list-box-item]:!h-7 [&_.list-box-item]:!min-h-7";
export const VIRTUALIZED_MENU_DROPDOWN_ITEM_CLASS =
  "[&_.list-box-item]:!h-7 [&_.list-box-item]:!min-h-7";
