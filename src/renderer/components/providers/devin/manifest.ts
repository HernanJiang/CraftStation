import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "devin",
  label: msg`Devin`,
  // Between muse (47) and antigravity (50).
  order: 48,
} satisfies RendererProviderManifest;
