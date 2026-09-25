import { type CSSProperties } from "react";
import antigravityLogo from "@/renderer/assets/provider-logos/antigravity.png";
import claudeLogo from "@/renderer/assets/provider-logos/claude.png";
import commandCodeLogo from "@/renderer/assets/provider-logos/command-code.png";
import cursorLogo from "@/renderer/assets/provider-logos/cursor.svg";
import factoryDroidLogo from "@/renderer/assets/provider-logos/factory-droid.svg";
import geminiLogo from "@/renderer/assets/provider-logos/gemini.svg";
import githubCopilotLogo from "@/renderer/assets/provider-logos/github-copilot.svg";
import grokLogo from "@/renderer/assets/provider-logos/grok.png";
import kimiCodeLogo from "@/renderer/assets/provider-logos/kimi-code.png";
import openAiLogo from "@/renderer/assets/provider-logos/openai.svg";
import openCodeLogo from "@/renderer/assets/provider-logos/opencode.png";
import qwenLogo from "@/renderer/assets/provider-logos/qwen.png";
import zaiLogo from "@/renderer/assets/provider-logos/zai.svg";
import volcengineLogo from "@/renderer/assets/provider-logos/volcengine.svg";
import deepseekLogo from "@/renderer/assets/provider-logos/deepseek.png";
import craftstationLogo from "@/renderer/assets/craftstation-logo.png";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";

/**
 * Shared provider brand system: official logo assets (colored where the brand
 * has one) plus a per-brand badge background, so monochrome-brand marks
 * (OpenAI / X / Cursor / Copilot / Droid) stay legible on dark surfaces while
 * colored brands (Claude / Gemini / Kimi / Qwen / ...) render with their real
 * colors. Shared by the sidebar footer cluster and the inline 模型与用量
 * workspace so every surface shows the same identity.
 */

export const PROVIDER_LABELS: Record<string, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  grok: "Grok",
  kimi: "Kimi Code",
  antigravity: "Antigravity",
  commandcode: "Command Code",
  factory: "Droid",
  opencode: "OpenCode",
  deepseek: "DeepSeek",
  muse: "Muse",
  devin: "Devin",
  stepcode: "Step Code",
  stepfun: "StepFun",
  zai: "z.ai",
  qwen: "Alibaba Token Plan",
  volcengine: "Volcengine Ark Token Plan",
  "openai-compatible": "OpenAI 兼容 API",
};

export function providerLabel(id: string, fallback?: string): string {
  return PROVIDER_LABELS[id] ?? fallback ?? id;
}

/**
 * Map an agent kind or model vendor id to its brand key. Inventory data
 * reports models by agent kind (`kimi`) but harnesses by model vendor
 * (`moonshot`, `xai`, `openai`); without this map every harness card falls
 * back to a monochrome letter badge.
 */
const VENDOR_KIND_TO_BRAND: Record<string, string> = {
  openai: "codex",
  xai: "grok",
  moonshot: "kimi",
  google: "gemini",
  deepseek: "deepseek",
  "deepseek-api": "deepseek",
  "opencode-go": "opencode",
  meta: "muse",
  stepfun: "stepcode",
  cognition: "devin",
  devin: "devin",
  recipes: "recipes",
};

export function brandIdForVendorKind(id: string | undefined): string {
  const normalized = (id ?? "").trim().toLowerCase();
  if (!normalized) return "";
  return VENDOR_KIND_TO_BRAND[normalized] ?? normalized;
}

type ProviderBrand = {
  background: string;
  logo: string;
  logoClassName?: string;
};

export const PROVIDER_BRANDS: Record<string, ProviderBrand> = {
  "openai-compatible": {
    background: "#10A37F",
    logo: openAiLogo,
    logoClassName: "size-[66%] brightness-0 invert",
  },
  codex: {
    background: "#050505",
    logo: openAiLogo,
    logoClassName: "size-[66%] brightness-0 invert",
  },
  claude: {
    background: "#30211f",
    logo: claudeLogo,
    logoClassName: "size-[74%]",
  },
  gemini: {
    background: "#15161b",
    logo: geminiLogo,
    logoClassName: "size-[74%]",
  },
  copilot: {
    background: "#f6f8fa",
    logo: githubCopilotLogo,
    logoClassName: "size-[68%]",
  },
  cursor: {
    background: "#f7f7f4",
    logo: cursorLogo,
    logoClassName: "size-full",
  },
  grok: {
    background: "#ffffff",
    logo: grokLogo,
    logoClassName: "size-full",
  },
  kimi: {
    background: "#f8f8f8",
    logo: kimiCodeLogo,
    logoClassName: "size-full",
  },
  antigravity: {
    background: "#15161b",
    logo: antigravityLogo,
    logoClassName: "size-[82%]",
  },
  commandcode: {
    background: "#000000",
    logo: commandCodeLogo,
    logoClassName: "size-full",
  },
  factory: {
    background: "#020202",
    logo: factoryDroidLogo,
    logoClassName: "size-full",
  },
  opencode: {
    background: "#121112",
    logo: openCodeLogo,
    logoClassName: "size-full",
  },
  deepseek: {
    // Square whale glyph on white (same treatment as grok/kimi): the logo
    // asset itself is blue, so a blue tile would swallow it.
    background: "#ffffff",
    logo: deepseekLogo,
    logoClassName: "size-[78%]",
  },
  muse: {
    // No licensed logo asset vendored: dark tile + letter glyph, matching
    // the other brand badges instead of a full Meta-blue disc.
    background: "#15161b",
    logo: "",
  },
  devin: {
    background: "#0b1220",
    logo: "",
  },
  stepcode: {
    // No vendored logo asset: dark tile + letter glyph, same treatment as
    // muse/devin until an official StepFun mark is licensed.
    background: "#101226",
    logo: "",
  },
  zai: {
    background: "#2d2d2f",
    logo: zaiLogo,
    logoClassName: "size-full",
  },
  qwen: {
    background: "#f2f5ff",
    logo: qwenLogo,
    logoClassName: "size-[72%]",
  },
  volcengine: {
    background: "#006eff",
    logo: volcengineLogo,
    logoClassName: "size-[78%]",
  },
  // 合成台「我的配方」：用 CraftStation 本体 logo（深色像素标，配深底）。
  recipes: {
    background: "#202126",
    logo: craftstationLogo,
    logoClassName: "size-full",
  },
};

const FALLBACK_PROVIDER_BRAND: ProviderBrand = {
  background: "#202126",
  logo: "",
};

export type ProviderBrandBadgeSize = "avatar" | "compact" | "card" | "row";

const BADGE_SIZE_CLASSES: Record<ProviderBrandBadgeSize, string> = {
  avatar: "size-[18px] border-[1.5px] border-[#121214]",
  compact: "size-8 border border-white/8",
  card: "size-10 border border-white/8",
  row: "size-5 border border-white/8",
};

const BADGE_GLYPH_CLASSES: Record<ProviderBrandBadgeSize, string> = {
  avatar: "size-2.5",
  compact: "size-4",
  card: "size-5",
  row: "size-3",
};

export function ProviderBrandBadge(props: {
  id: string;
  label: string;
  iconKind?: string;
  size?: ProviderBrandBadgeSize;
  stackIndex?: number;
}) {
  const brand = PROVIDER_BRANDS[props.id] ?? FALLBACK_PROVIDER_BRAND;
  const size: ProviderBrandBadgeSize = props.size ?? "avatar";
  return (
    <span
      // Account rows already expose data-testid="account-provider-icon-*" on
      // their wrapper; emitting the badge id there too would duplicate the
      // test id once per pooled account.
      data-testid={size === "row" ? undefined : "provider-badge-" + props.id}
      className={`craftstation-provider-brand flex shrink-0 items-center justify-center overflow-hidden rounded-full ${BADGE_SIZE_CLASSES[size]} ${
        size === "avatar" && props.stackIndex ? "-ml-1.5" : ""
      }`}
      style={
        {
          background: brand.background,
          zIndex: props.stackIndex == null ? undefined : 10 - props.stackIndex,
        } as CSSProperties
      }
      title={props.label}
      aria-hidden="true"
    >
      {brand.logo ? (
        <img
          src={brand.logo}
          alt=""
          draggable={false}
          data-provider-logo={props.id}
          className={`shrink-0 object-contain ${brand.logoClassName ?? "size-[70%]"}`}
        />
      ) : (
        <ProviderIcon
          kind={props.iconKind ?? props.id}
          fallbackLabel={props.label}
          className={BADGE_GLYPH_CLASSES[size]}
        />
      )}
    </span>
  );
}
