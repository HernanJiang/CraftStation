import { z } from "zod";
import { agentKindSchema, threadModeSchema } from "./common";

const threadConfigShape = {
  model: z.string().min(1),
  effort: z.string().optional(),
  contextSize: z.string().optional(),
  fast: z.boolean().optional(),
  thinking: z.boolean().optional(),
  mode: threadModeSchema.optional(),
  approvalPolicy: z.string().optional(),
  approvalsReviewer: z.string().optional(),
  sandboxMode: z.string().optional(),
  browserMcp: z.boolean().optional(),
  /**
   * Ephemeral Own Subagents channel (temporary child subagents). Legacy rows
   * predate the rename; new launches keep writing this key.
   */
  crossagentMcp: z.boolean().optional(),
  /**
   * Persistent Crossagents peer channel (durable messaging between
   * long-lived native threads). Absent means default-ON; only an explicit
   * `false` (or a hard disable of the `crossagents` built-in server) opts a
   * thread out.
   */
  crossagentsMcp: z.boolean().optional(),
  computerUse: z.boolean().optional(),
  chromeMcp: z.boolean().optional(),
  /**
   * Catalog/channel that listed the model when Auto Mode remaps Harness
   * (Command Code → DeepSeek Harness, OpenCode → Muse). Absent when the
   * picker kind already is the spawn Harness.
   */
  sourceProviderKind: z.string().optional(),
} as const;

export const threadConfigBaseSchema = z.object(threadConfigShape);

export const threadConfigSchema = threadConfigBaseSchema;
export type ThreadConfig = z.infer<typeof threadConfigSchema>;

/** CLI 原生权限值；保留审批策略、审核者与 sandbox 三者的独立语义。 */
export const permissionConfigSchema = threadConfigBaseSchema.pick({
  approvalPolicy: true,
  approvalsReviewer: true,
  sandboxMode: true,
});
export type PermissionConfig = z.infer<typeof permissionConfigSchema>;

export const providerDraftConfigSchema = threadConfigBaseSchema;
export type ProviderDraftConfig = z.infer<typeof providerDraftConfigSchema>;

/** Saved draft state may not have a chosen model yet. */
export const projectDraftConfigSchema = threadConfigBaseSchema
  .extend({
    agentKind: agentKindSchema,
    worktreeMode: z.boolean().optional(),
  })
  .extend({
    model: z.string(),
  });
export type ProjectDraftConfig = z.infer<typeof projectDraftConfigSchema>;

export function isThreadConfigEqual(
  left: ThreadConfig | undefined,
  right: ThreadConfig | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.model === right.model &&
    left.effort === right.effort &&
    left.contextSize === right.contextSize &&
    left.fast === right.fast &&
    left.thinking === right.thinking &&
    left.mode === right.mode &&
    left.approvalPolicy === right.approvalPolicy &&
    left.approvalsReviewer === right.approvalsReviewer &&
    left.sandboxMode === right.sandboxMode &&
    left.browserMcp === right.browserMcp &&
    left.crossagentMcp === right.crossagentMcp &&
    left.crossagentsMcp === right.crossagentsMcp &&
    left.computerUse === right.computerUse &&
    left.chromeMcp === right.chromeMcp &&
    left.sourceProviderKind === right.sourceProviderKind
  );
}
