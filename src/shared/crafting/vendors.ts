/**
 * Canonical model-vendor normalization for the crafting compatibility chain.
 *
 * The inventory reports models by *agent kind* (`codex`, `grok`, `kimi`, …)
 * while Harness descriptors report the *model vendor* (`openai`, `xai`,
 * `moonshot`, …). Comparing the raw strings (`codex === openai`) can never
 * match, which fails every genuine native pairing closed. Both sides are
 * normalized here before any native/compatibility decision.
 */
const AGENT_KIND_TO_VENDOR: Record<string, string> = {
  codex: "openai",
  openai: "openai",
  grok: "xai",
  xai: "xai",
  kimi: "moonshot",
  kimi210: "moonshot",
  moonshot: "moonshot",
  gemini: "google",
  antigravity: "google",
  google: "google",
  deepseek: "deepseek",
  "deepseek-api": "deepseek",
  opencode: "opencode",
  "opencode-go": "opencode",
  muse: "muse",
  meta: "muse",
  stepcode: "stepfun",
  step: "stepfun",
  stepfun: "stepfun",
  cognition: "cognition",
  devin: "cognition",
  qwen: "qwen",
  cursor: "cursor",
  aionui: "aionui",
};

/** Normalize an agent kind or vendor id to its canonical model vendor. */
export function canonicalModelVendor(kindOrVendor: string | undefined): string {
  const normalized = (kindOrVendor ?? "").trim().toLowerCase();
  if (!normalized) return "";
  return AGENT_KIND_TO_VENDOR[normalized] ?? normalized;
}

/** True when the model side and the harness side belong to the same vendor. */
export function isSameModelVendor(
  modelProviderKind: string | undefined,
  harnessVendor: string | undefined,
): boolean {
  const modelVendor = canonicalModelVendor(modelProviderKind);
  if (!modelVendor) return false;
  return modelVendor === canonicalModelVendor(harnessVendor);
}
