import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "zcode",
  label: msg`ZCode`,
  order: 49,
} satisfies RendererProviderManifest;
