import { z } from "zod";

/** Empty payload: the bridge status is a global singleton projection. */
export const compatibilityBridgeStatusPayloadSchema = z.object({});
export type CompatibilityBridgeStatusPayload = z.infer<
  typeof compatibilityBridgeStatusPayloadSchema
>;

/**
 * Secret-free Compatibility Bridge (CLIProxyAPI sidecar) projection.
 * `running` mirrors the service's own readiness signal; `endpoint`/`pid`
 * appear only while it runs. Never carries the bridge api key.
 */
export const compatibilityBridgeStatusSchema = z.object({
  running: z.boolean(),
  endpoint: z.string().optional(),
  pid: z.number().optional(),
});
export type CompatibilityBridgeStatusView = z.infer<typeof compatibilityBridgeStatusSchema>;

/**
 * Empty control payload: bridge start/stop act on the global singleton, like
 * the status projection. Long-running: start awaits the sidecar's own
 * authenticated readiness probe before resolving.
 */
export const compatibilityBridgeControlPayloadSchema = z.object({});
export type CompatibilityBridgeControlPayload = z.infer<
  typeof compatibilityBridgeControlPayloadSchema
>;
