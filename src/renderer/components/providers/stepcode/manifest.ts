import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "stepcode",
  label: msg`Step Code`,
  order: 55,
} satisfies RendererProviderManifest;
