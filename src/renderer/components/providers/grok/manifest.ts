import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "grok",
  label: msg`Grok Build`,
  order: 40,
} satisfies RendererProviderManifest;
