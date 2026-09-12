import { asc, eq } from "drizzle-orm";
import * as schema from "../db.schema";
import { getDb } from "./connection";

export interface ThreadNativeSessionRow {
  id: number;
  threadId: string;
  harness: string;
  model: string;
  nativeSessionId: string | null;
  poolAccountId: string | null;
  createdAt: string;
}

/** Append-only: every model/harness switch records the new native session. */
export function dbInsertThreadNativeSession(input: {
  threadId: string;
  harness: string;
  model: string;
  nativeSessionId?: string | undefined;
  poolAccountId?: string | undefined;
}): ThreadNativeSessionRow {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const inserted = db
    .insert(schema.threadNativeSessions)
    .values({
      threadId: input.threadId,
      harness: input.harness,
      model: input.model,
      nativeSessionId: input.nativeSessionId ?? null,
      poolAccountId: input.poolAccountId ?? null,
      createdAt,
    })
    .returning()
    .get();
  return {
    id: inserted.id,
    threadId: inserted.threadId,
    harness: inserted.harness,
    model: inserted.model,
    nativeSessionId: inserted.nativeSessionId,
    poolAccountId: inserted.poolAccountId,
    createdAt: inserted.createdAt,
  };
}

/** Full native-session history of a logical thread, oldest first. */
export function dbListThreadNativeSessions(threadId: string): ThreadNativeSessionRow[] {
  const db = getDb();
  return db
    .select()
    .from(schema.threadNativeSessions)
    .where(eq(schema.threadNativeSessions.threadId, threadId))
    .orderBy(asc(schema.threadNativeSessions.id))
    .all()
    .map((row) => ({
      id: row.id,
      threadId: row.threadId,
      harness: row.harness,
      model: row.model,
      nativeSessionId: row.nativeSessionId,
      poolAccountId: row.poolAccountId,
      createdAt: row.createdAt,
    }));
}
