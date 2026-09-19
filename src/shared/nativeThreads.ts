import { z } from "zod";

/**
 * Stable cross-harness identity for one real native thread.
 *
 * `codex:C123` names exactly one provider-native thread: the harness that
 * owns it plus the harness's own thread id. Never a title, prompt, or model
 * — those are not unique and they change.
 */
export const nativeThreadAddressSchema = z
  .string()
  .min(3)
  .max(220)
  .regex(/^[A-Za-z0-9_-]+:[A-Za-z0-9_.-]+$/, "Expected <harness>:<nativeId>.");
export type NativeThreadAddress = z.infer<typeof nativeThreadAddressSchema>;

export const nativePeerStatusSchema = z.enum(["online", "offline", "busy", "unknown"]);
export type NativePeerStatus = z.infer<typeof nativePeerStatusSchema>;

export const nativePeerOriginSchema = z.enum(["craftstation", "external"]);
export type NativePeerOrigin = z.infer<typeof nativePeerOriginSchema>;

/** One addressable native thread in a workspace peer scope. */
export const nativeThreadPeerSchema = z.object({
  address: nativeThreadAddressSchema,
  harness: z.string().min(1),
  nativeId: z.string().min(1),
  workspace: z.string().min(1),
  title: z.string(),
  origin: nativePeerOriginSchema,
  /** CraftStation thread row bound to this native thread, if claimed. */
  boundThreadId: z.string().min(1).optional(),
  status: nativePeerStatusSchema,
  updatedAt: z.number().int().nonnegative().optional(),
});
export type NativeThreadPeer = z.infer<typeof nativeThreadPeerSchema>;

export const listNativePeersPayloadSchema = z.object({
  sourceThreadId: z.string().min(1),
  query: z.string().trim().max(200).optional(),
});
export type ListNativePeersPayload = z.infer<typeof listNativePeersPayloadSchema>;

export const claimNativePeerPayloadSchema = z.object({
  address: nativeThreadAddressSchema,
  /** CraftStation project the external thread's workspace maps to. */
  projectId: z.string().min(1),
});
export type ClaimNativePeerPayload = z.infer<typeof claimNativePeerPayloadSchema>;

/** Parse `harness:nativeId` into its parts; throws on malformed input. */
export function parseNativeAddress(address: string): { harness: string; nativeId: string } {
  const parsed = nativeThreadAddressSchema.safeParse(address);
  if (!parsed.success) {
    throw new Error(`Invalid native thread address: ${address}. Expected <harness>:<nativeId>.`);
  }
  const separator = address.indexOf(":");
  return { harness: address.slice(0, separator), nativeId: address.slice(separator + 1) };
}

/** Build the canonical address for a harness/native-id pair. */
export function formatNativeAddress(harness: string, nativeId: string): string {
  return nativeThreadAddressSchema.parse(`${harness}:${nativeId}`);
}

const THREAD_UUID_REFERENCE =
  /^(?:thread:)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Parse a sidebar-thread reference — a bare CraftStation thread UUID or the
 * explicit `thread:<uuid>` form. Returns the bare UUID, or null when the
 * target is not a thread reference (e.g. a `harness:nativeId` address). Both
 * spellings name the same sidebar conversation as the thread's native
 * address; resolution is shared by Crossagents and Schedule.
 */
export function parseThreadUuidReference(target: string): string | null {
  const trimmed = target.trim();
  if (!THREAD_UUID_REFERENCE.test(trimmed)) return null;
  return trimmed.startsWith("thread:") ? trimmed.slice("thread:".length) : trimmed;
}

/**
 * Normalize a workspace path for peer-scope comparison: forward slashes,
 * no trailing slash, and full case-folding on Windows (drive letter and
 * beyond — NTFS is case-insensitive). POSIX keeps case. Symlinks are
 * resolved by the caller when the path exists (see the index module).
 */
export function normalizeWorkspacePath(path: string): string {
  let out = path.trim().replace(/\\/g, "/");
  if (process.platform === "win32") {
    out = out.toLowerCase();
  } else if (/^[A-Za-z]:\//.test(out)) {
    out = out[0]!.toLowerCase() + out.slice(1);
  }
  while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}
