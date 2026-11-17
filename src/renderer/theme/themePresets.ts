/**
 * Catalog of selectable app themes.
 *
 * Each preset ships a `light` and `dark` variant; the active variant follows
 * the user's appearance mode (system / light / dark), so e.g. Catppuccin is
 * Latte in light and Mocha in dark. Palettes are adapted from the popular
 * VS Code / Cursor / editor themes of the same name and remapped onto
 * CraftStation's token set — the app keeps its own layout, radius, and typography.
 *
 * `THEME_SPECS` holds the authored anchor colors (the source of truth, also
 * consumed by the contrast test); `APP_THEME_PRESETS` is the derived token set.
 * Secondary ("muted") text is derived from fg→bg rather than each theme's
 * comment color so contrast stays readable everywhere (see `themeTokens`). To
 * add a theme, append one `THEME_SPECS` entry; `group` picks its gallery
 * section.
 */

import { buildVariant, type ThemeSpec, type ThemeVariantVars } from "./themeTokens";

/** Gallery section a preset is listed under. */
export type AppThemeGroup = "base" | "minimal" | "editor";

export interface AppThemeSpec {
  id: string;
  label: string;
  group: AppThemeGroup;
  light: ThemeSpec;
  dark: ThemeSpec;
}

export interface AppThemePreset {
  id: string;
  label: string;
  group: AppThemeGroup;
  light: ThemeVariantVars;
  dark: ThemeVariantVars;
}

export const DEFAULT_THEME_ID = "default";

export const THEME_SPECS: AppThemeSpec[] = [
  // CraftStation base. Mirrors the `.light` / `.dark` values in styles.css and is
  // used only for the gallery preview — at runtime the base theme clears all
  // overrides so styles.css stays the source of truth (see applyAppTheme).
  {
    id: DEFAULT_THEME_ID,
    label: "CraftStation",
    group: "base",
    // sRGB hex of the styles.css oklch values (anchors must be hex so muted can
    // be contrast-derived). Preview-only — runtime clears overrides for default.
    light: {
      bg: "#f1f1f4",
      surface: "#fafafb",
      fg: "#18181b",
      accent: "#5f6cd9",
      accentFg: "#ffffff",
      border: "#cacace",
      sidebar: "#ececef",
      content: "#f6f6f9",
    },
    dark: {
      bg: "#070709",
      surface: "#0e0e14",
      fg: "#fafafa",
      accent: "#8892ef",
      accentFg: "#0a0a12",
      border: "#24242e",
      sidebar: "#0e0e14",
      content: "#0b0b11",
    },
  },

  // CraftStation Legacy — the original pre-CraftStation look (neutral graphite +
  // blue accent), preserved as a selectable theme so the old style isn't lost.
  {
    id: "craftstation-legacy",
    label: "CraftStation Legacy",
    group: "base",
    light: {
      bg: "#f1f1f4",
      surface: "#fafafb",
      fg: "#18181b",
      accent: "#478cc4",
      accentFg: "#ffffff",
      border: "#cacace",
      sidebar: "#ececef",
      content: "#f6f6f9",
    },
    dark: {
      bg: "#141416",
      surface: "#1a1a1c",
      fg: "#fcfcfc",
      accent: "#88bae4",
      accentFg: "#111113",
      border: "#303033",
      sidebar: "#1a1a1c",
      content: "#161618",
    },
  },

  // ── Minimal collection ──────────────────────────────────────────────
  // Black and white in six temperaments. The neutral trio differs only in
  // depth (Onyx → Graphite → Ash); the tinted trio keeps a whisper of hue
  // (Slate cool, Linen warm, Sage green). Accents stay restrained: monochrome
  // on the neutrals, one low-chroma tone on the tinted pairs. Light variants
  // pin `overlay` so menus and dialogs stay as bright as the page.

  // Onyx — true black / pure white, monochrome accent. Highest contrast.
  {
    id: "onyx",
    label: "Onyx",
    group: "minimal",
    light: {
      bg: "#ffffff",
      surface: "#ffffff",
      fg: "#0a0a0a",
      accent: "#111111",
      accentFg: "#ffffff",
      border: "#e5e5e5",
      sidebar: "#fafafa",
      content: "#ffffff",
      overlay: "#ffffff",
    },
    dark: {
      bg: "#000000",
      surface: "#111111",
      fg: "#ededed",
      accent: "#f5f5f5",
      accentFg: "#0a0a0a",
      border: "#242424",
      sidebar: "#000000",
      content: "#080808",
    },
  },

  // Graphite — soft neutral grey-black / paper white, monochrome accent.
  {
    id: "graphite",
    label: "Graphite",
    group: "minimal",
    light: {
      bg: "#f7f7f8",
      surface: "#ffffff",
      fg: "#1a1a1d",
      accent: "#27272a",
      accentFg: "#ffffff",
      border: "#e3e3e6",
      sidebar: "#f3f3f4",
      content: "#ffffff",
      overlay: "#ffffff",
    },
    dark: {
      bg: "#151517",
      surface: "#1e1e21",
      fg: "#ededee",
      accent: "#e4e4e7",
      accentFg: "#151517",
      border: "#2c2c2f",
      sidebar: "#111113",
      content: "#18181a",
    },
  },

  // Ash — dimmed charcoal / soft grey-white. Lowest glare in both modes.
  {
    id: "ash",
    label: "Ash",
    group: "minimal",
    light: {
      bg: "#ececee",
      surface: "#fafafa",
      fg: "#26262a",
      accent: "#3f3f46",
      accentFg: "#ffffff",
      border: "#d4d4d8",
      sidebar: "#e6e6e9",
      content: "#f4f4f5",
      overlay: "#fafafa",
    },
    dark: {
      bg: "#1f2023",
      surface: "#292a2e",
      fg: "#e6e6e8",
      accent: "#d4d4d8",
      accentFg: "#1f2023",
      border: "#37383d",
      sidebar: "#1b1c1f",
      content: "#232427",
    },
  },

  // Slate — cool blue-black / mist white, steel-blue accent.
  {
    id: "slate",
    label: "Slate",
    group: "minimal",
    light: {
      bg: "#f6f8fa",
      surface: "#ffffff",
      fg: "#1f2328",
      accent: "#3b6ea5",
      accentFg: "#ffffff",
      border: "#d5dbe1",
      sidebar: "#f0f3f6",
      content: "#ffffff",
      overlay: "#ffffff",
    },
    dark: {
      bg: "#14171b",
      surface: "#1c2026",
      fg: "#e3e7ec",
      accent: "#8fa9c8",
      accentFg: "#0f1216",
      border: "#2b3138",
      sidebar: "#101317",
      content: "#171a1f",
    },
  },

  // Linen — warm charcoal / linen white, sand accent.
  {
    id: "linen",
    label: "Linen",
    group: "minimal",
    light: {
      bg: "#f7f5f1",
      surface: "#fffdf9",
      fg: "#24211d",
      accent: "#6b5a45",
      accentFg: "#fffdf9",
      border: "#e2ddd4",
      sidebar: "#f0ede7",
      content: "#fbfaf7",
      overlay: "#fffdf9",
    },
    dark: {
      bg: "#181716",
      surface: "#211f1d",
      fg: "#ece8e2",
      accent: "#cbb89a",
      accentFg: "#181716",
      border: "#312e2b",
      sidebar: "#131211",
      content: "#1b1a18",
    },
  },

  // Sage — green-black / celadon white, sage accent.
  {
    id: "sage",
    label: "Sage",
    group: "minimal",
    light: {
      bg: "#f4f7f4",
      surface: "#ffffff",
      fg: "#1d231f",
      accent: "#46705a",
      accentFg: "#ffffff",
      border: "#d8dfd9",
      sidebar: "#edf1ed",
      content: "#fbfcfb",
      overlay: "#ffffff",
    },
    dark: {
      bg: "#141715",
      surface: "#1c201d",
      fg: "#e4e9e5",
      accent: "#9dbba6",
      accentFg: "#101311",
      border: "#2a302c",
      sidebar: "#101311",
      content: "#171a18",
    },
  },

  // Catppuccin — Latte / Mocha.
  {
    id: "catppuccin",
    label: "Catppuccin",
    group: "editor",
    light: {
      bg: "#eff1f5",
      surface: "#ffffff",
      // Darkened from canonical #4c4f69 so muted text reads as clearly dimmer.
      fg: "#3d3f54",
      accent: "#8839ef",
      accentFg: "#ffffff",
      border: "#bcc0cc",
      sidebar: "#e6e9ef",
    },
    dark: {
      bg: "#1e1e2e",
      surface: "#27273a",
      // Brightened from canonical #cdd6f4 to widen the muted/active gap.
      fg: "#d2daf5",
      accent: "#cba6f7",
      accentFg: "#1e1e2e",
      border: "#313244",
      sidebar: "#181825",
    },
  },

  // GitHub — Light / Dark (default).
  {
    id: "github",
    label: "GitHub",
    group: "editor",
    light: {
      bg: "#ffffff",
      surface: "#f6f8fa",
      fg: "#1f2328",
      accent: "#0969da",
      accentFg: "#ffffff",
      border: "#d0d7de",
      sidebar: "#f6f8fa",
      content: "#ffffff",
    },
    dark: {
      bg: "#0d1117",
      surface: "#161b22",
      fg: "#e6edf3",
      accent: "#2f81f7",
      accentFg: "#ffffff",
      border: "#30363d",
      sidebar: "#0d1117",
    },
  },

  // Atom One — Light / Dark.
  {
    id: "one",
    label: "One",
    group: "editor",
    light: {
      bg: "#fafafa",
      surface: "#ffffff",
      fg: "#383a42",
      accent: "#4078f2",
      accentFg: "#ffffff",
      border: "#e5e5e6",
      sidebar: "#eaeaeb",
    },
    dark: {
      bg: "#282c34",
      surface: "#2c313a",
      // Brightened from canonical #abb2bf to widen the muted/active gap.
      fg: "#dee0e6",
      accent: "#61afef",
      accentFg: "#282c34",
      border: "#3b4048",
      sidebar: "#21252b",
    },
  },

  // Dracula — Alucard (light) / Dracula (dark).
  {
    id: "dracula",
    label: "Dracula",
    group: "editor",
    light: {
      bg: "#fffbeb",
      surface: "#ffffff",
      fg: "#1f1f1f",
      accent: "#644ac9",
      accentFg: "#ffffff",
      border: "#d4cfc0",
      sidebar: "#f3eedd",
    },
    dark: {
      bg: "#282a36",
      surface: "#343746",
      fg: "#f8f8f2",
      accent: "#bd93f9",
      accentFg: "#282a36",
      border: "#44475a",
      sidebar: "#21222c",
    },
  },

  // Nord — Snow Storm (light) / Polar Night (dark).
  {
    id: "nord",
    label: "Nord",
    group: "editor",
    light: {
      bg: "#eceff4",
      surface: "#ffffff",
      fg: "#2e3440",
      accent: "#5e81ac",
      accentFg: "#ffffff",
      border: "#d8dee9",
      sidebar: "#e5e9f0",
    },
    dark: {
      bg: "#2e3440",
      surface: "#3b4252",
      // Brightened from canonical #d8dee9 to widen the muted/active gap.
      fg: "#eff2f6",
      accent: "#88c0d0",
      accentFg: "#2e3440",
      border: "#434c5e",
      sidebar: "#2b303b",
    },
  },

  // Tokyo Night — Day / Night.
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    group: "editor",
    light: {
      bg: "#e1e2e7",
      surface: "#ffffff",
      // Darkened from canonical #343b58 so muted text reads as clearly dimmer.
      fg: "#303651",
      accent: "#2e7de9",
      accentFg: "#ffffff",
      border: "#c4c8da",
      sidebar: "#d6d8df",
    },
    dark: {
      bg: "#1a1b26",
      surface: "#1f2335",
      // Brightened from canonical #c0caf5 to widen the muted/active gap.
      fg: "#cdd5f7",
      accent: "#7aa2f7",
      accentFg: "#1a1b26",
      border: "#292e42",
      sidebar: "#16161e",
    },
  },

  // Gruvbox — Light / Dark (medium).
  {
    id: "gruvbox",
    label: "Gruvbox",
    group: "editor",
    light: {
      bg: "#fbf1c7",
      surface: "#f9f5d7",
      fg: "#3c3836",
      accent: "#d65d0e",
      accentFg: "#fbf1c7",
      border: "#d5c4a1",
      sidebar: "#ebdbb2",
    },
    dark: {
      bg: "#282828",
      surface: "#32302f",
      // Brightened from canonical #ebdbb2 to widen the muted/active gap.
      fg: "#f0e5c7",
      accent: "#fe8019",
      accentFg: "#282828",
      border: "#504945",
      sidebar: "#1d2021",
    },
  },

  // Solarized — Light / Dark. fg pulled well past the canonical (famously
  // low-contrast) base0/base01 so muted text both clears the readability floor
  // and stays clearly dimmer than the active foreground.
  {
    id: "solarized",
    label: "Solarized",
    group: "editor",
    light: {
      bg: "#fdf6e3",
      surface: "#eee8d5",
      fg: "#2e3c41",
      accent: "#268bd2",
      accentFg: "#fdf6e3",
      border: "#ddd6c1",
      sidebar: "#eee8d5",
    },
    dark: {
      bg: "#002b36",
      surface: "#073642",
      fg: "#e3e8e8",
      accent: "#268bd2",
      accentFg: "#002b36",
      border: "#0a4a5a",
      sidebar: "#002028",
    },
  },

  // Rosé Pine — Dawn / Moon.
  {
    id: "rose-pine",
    label: "Rosé Pine",
    group: "editor",
    light: {
      bg: "#faf4ed",
      surface: "#fffaf3",
      // Darkened from canonical #575279 so muted text reads as clearly dimmer.
      fg: "#423e5c",
      accent: "#907aa9",
      accentFg: "#ffffff",
      border: "#dfdad9",
      sidebar: "#f2e9e1",
    },
    dark: {
      bg: "#232136",
      surface: "#2a273f",
      fg: "#e0def4",
      accent: "#c4a7e7",
      accentFg: "#232136",
      border: "#44415a",
      sidebar: "#1f1d2e",
    },
  },

  // Everforest — Light / Dark (medium).
  {
    id: "everforest",
    label: "Everforest",
    group: "editor",
    light: {
      bg: "#fdf6e3",
      surface: "#f4f0d9",
      // Darkened past canonical #5c6a72 so muted text clears the readability
      // floor and stays clearly dimmer than the active foreground.
      fg: "#374147",
      // Deepened from the canonical #8da101 olive so accent button/link text is
      // legible (the light olive sat at ~2.6:1).
      accent: "#677700",
      accentFg: "#ffffff",
      border: "#e0dcc7",
      sidebar: "#efebd4",
    },
    dark: {
      bg: "#2d353b",
      surface: "#343f44",
      // Brightened from canonical #d3c6aa to widen the muted/active gap.
      fg: "#eee8dd",
      accent: "#a7c080",
      accentFg: "#2d353b",
      border: "#475258",
      sidebar: "#272e33",
    },
  },

  // Monokai — adapted light / classic dark.
  {
    id: "monokai",
    label: "Monokai",
    group: "editor",
    light: {
      bg: "#fbfbf8",
      surface: "#ffffff",
      fg: "#2c2b29",
      accent: "#e0156d",
      accentFg: "#ffffff",
      border: "#e4e3da",
      sidebar: "#f1f1ea",
    },
    dark: {
      bg: "#272822",
      surface: "#2f302a",
      fg: "#f8f8f2",
      accent: "#f92672",
      accentFg: "#ffffff",
      border: "#3e3d32",
      sidebar: "#1d1e19",
    },
  },
];

export const APP_THEME_PRESETS: AppThemePreset[] = THEME_SPECS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  group: spec.group,
  light: buildVariant(spec.light, "light"),
  dark: buildVariant(spec.dark, "dark"),
}));

const PRESETS_BY_ID = new Map(APP_THEME_PRESETS.map((entry) => [entry.id, entry]));

export function getThemePreset(id: string): AppThemePreset {
  const currentId = id === "craftstation-legacy" ? "craftstation-legacy" : id;
  return PRESETS_BY_ID.get(currentId) ?? PRESETS_BY_ID.get(DEFAULT_THEME_ID)!;
}

/** `{ id, label }` options for a Select, in catalog order. */
export const APP_THEME_OPTIONS = APP_THEME_PRESETS.map((entry) => ({
  id: entry.id,
  label: entry.label,
}));
