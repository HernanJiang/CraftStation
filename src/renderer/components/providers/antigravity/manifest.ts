import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "antigravity",
  label: msg`Antigravity`,
  order: 50,
} satisfies RendererProviderManifest;
