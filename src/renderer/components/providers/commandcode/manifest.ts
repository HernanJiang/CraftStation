import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "commandcode",
  label: msg`Command Code`,
  order: 60,
} satisfies RendererProviderManifest;
