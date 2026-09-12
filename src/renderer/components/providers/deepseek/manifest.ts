import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "deepseek",
  label: msg`DeepSeek Harness`,
  order: 46,
} satisfies RendererProviderManifest;
