import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "copilot",
  label: msg`GitHub Copilot`,
  order: 90,
} satisfies RendererProviderManifest;
