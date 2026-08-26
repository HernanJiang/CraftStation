import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "gemini",
  label: msg`Gemini`,
  order: 30,
} satisfies RendererProviderManifest;
