import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "cursor",
  label: msg`Cursor`,
  order: 80,
} satisfies RendererProviderManifest;
