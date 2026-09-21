import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "minimax",
  label: msg`MiniMax Code`,
  order: 44,
} satisfies RendererProviderManifest;
