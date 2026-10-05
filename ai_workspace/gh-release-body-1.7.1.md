# CraftStation v1.7.1

## User-facing

- **Any third-party model now runs on DeepSeek Harness**: OpenCode Go catalog picks, Command Code rows, and models bound to any OpenAI-compatible account get an isolated provider projection, so selecting DeepSeek Harness no longer fails with `DSH model binding failed` or silently falls back to the official DeepSeek endpoint.
- **Gemini (Antigravity) timeline is readable again**: narration that arrives between tool calls now renders interleaved in true order instead of collapsing into one text block above all the tools, and the final response no longer duplicates the streamed answer.
- **Math and markdown in chat render correctly**: malformed `$$…$` delimiters and formulas missing a closing brace or `\right` are repaired before rendering, so LaTeX no longer leaks as raw source. Currency amounts like `$5`, code spans and fenced blocks are unaffected.
- **Side panel maximize no longer crashes the chat view**: hidden-column row measurements no longer pollute the virtual list, and conversation crashes now persist a diagnostic breadcrumb for faster diagnosis.

## Implementation

- `prepareDeepseekForeignLaunch` generalized: any `thirdPartyAccountId` now writes an isolated `$DSH_HOME` (`craftstation-dsh-tp/<threadId>`) with a pi-ai provider keyed by the catalog channel prefix; the advertised `[provider, leaf]` tuple aliases match catalog ids exactly, so the wire side needed no change. API keys stay in `.credentials.yaml` (0600) and child-process env only.
- `nativeEventCanonicalizer` turn state gained text-run attribution mirroring the thinking-run mechanism: tool/subagent/thinking steps close the open text run and the next `agent_response` delta opens `item:{turnId}:text-N` at its true position. `result` now completes every open run id, and `finalResponseRemainder` (shared between `nativeAdapter` and `structuredSession`) compares whitespace-insensitively so snapshot echoes that only restore `\n` separators are dropped.
- `ItemMarkdown` normalization chain gained `normalizeMathDollarRuns` (line-level delimiter repair, gated on LaTeX signals) and `repairMathSyntax` (missing `}` / `\right.` repair inside math spans).
- `MessageList` skips `setItemSize` writes for rows in a hidden column, and `ConversationErrorBoundary` persists crash details to `app_state` under `diagnostics:lastConversationCrash`.

## Verification

- DeepSeek spawn/pipeline: parameterized tests cover `openai/gpt-5` and bare-model third-party bindings — `DSH_HOME` isolation, provider registration, env injection verified end to end.
- Canonicalizer: 20 tests including text-run splitting, open-run completion and whitespace-tolerant remainder branches; antigravity + nativeHarness + threadSession suites: 405 tests pass.
- ChatPane math repair: real 20KB message renders 66 KaTeX spans, 0 residual `$$`, 0 errors.
- typecheck, oxlint (plain + type-aware) clean.

**Full Changelog**: https://github.com/SDSLeon/lightcode/compare/v1.7.0...v1.7.1
