import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "codex",
  label: msg`Codex`,
  order: 20,
  utilityOrder: 10,
} satisfies RendererProviderManifest;
