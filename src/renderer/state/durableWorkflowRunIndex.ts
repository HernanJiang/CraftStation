import {
  projectLocationSchema,
  type ProjectLocation,
  type WorkflowRunStatus,
} from "@/shared/contracts";

const STORAGE_KEY = "craftstation.workflow-run-index.v1";

export interface DurableWorkflowRunRecord {
  threadId: string;
  itemId: string;
  manifestPath: string;
  transcriptDir?: string | undefined;
  location: ProjectLocation;
  registeredAt: number;
  lastObservedAt: number;
  runId?: string;
  status: WorkflowRunStatus;
  resumedFrom?: string;
  supersededBy?: string;
  stopReason?: string;
  resumable?: boolean;
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLocation(value: unknown): value is ProjectLocation {
  return projectLocationSchema.safeParse(value).success;
}

function isStatus(value: unknown): value is WorkflowRunStatus {
  return ["running", "completed", "failed", "cancelled", "unknown"].includes(String(value));
}

function parseRecord(value: unknown): DurableWorkflowRunRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.threadId !== "string" ||
    typeof value.itemId !== "string" ||
    typeof value.manifestPath !== "string" ||
    typeof value.registeredAt !== "number" ||
    typeof value.lastObservedAt !== "number" ||
    !isLocation(value.location) ||
    !isStatus(value.status)
  ) {
    return undefined;
  }
  return {
    threadId: value.threadId,
    itemId: value.itemId,
    manifestPath: value.manifestPath,
    location: value.location,
    registeredAt: value.registeredAt,
    lastObservedAt: value.lastObservedAt,
    status: value.status,
    ...(typeof value.transcriptDir === "string" ? { transcriptDir: value.transcriptDir } : {}),
    ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
    ...(typeof value.resumedFrom === "string" ? { resumedFrom: value.resumedFrom } : {}),
    ...(typeof value.supersededBy === "string" ? { supersededBy: value.supersededBy } : {}),
    ...(typeof value.stopReason === "string" ? { stopReason: value.stopReason } : {}),
    ...(typeof value.resumable === "boolean" ? { resumable: value.resumable } : {}),
  };
}

export function readDurableWorkflowRunIndex(): DurableWorkflowRunRecord[] {
  const target = storage();
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.flatMap((value) => parseRecord(value) ?? []) : [];
  } catch {
    return [];
  }
}

export function writeDurableWorkflowRunRecord(record: DurableWorkflowRunRecord): void {
  const target = storage();
  if (!target) return;
  const records = readDurableWorkflowRunIndex();
  const key = `${record.threadId}\u0000${record.itemId}`;
  const next = records.filter((entry) => `${entry.threadId}\u0000${entry.itemId}` !== key);
  next.push(record);
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Liveness remains in memory when browser storage is unavailable or full.
  }
}

export function clearDurableWorkflowRunIndexForTests(): void {
  storage()?.removeItem(STORAGE_KEY);
}
