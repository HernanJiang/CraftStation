import { describe, expect, it } from "vitest";
import { OpenCodeNativeTransport } from "./transport";
import { OpenCodeNativeSession } from "./session";
import type { CraftPlan } from "@/shared/crafting";

describe("OpenCode real binary live smoke", () => {
  it("probes real opencode server provider list and session lifecycle", async () => {
    const transport = new OpenCodeNativeTransport({
      projectLocation: {
        kind: "windows",
        path: "D:/Work/CraftStation/craftstation/.worktrees/v0.8",
      },
      readyTimeoutMs: 15_000,
    });
    try {
      const conn = await transport.connect();
      expect(conn.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+/u);

      const providers = await conn.client.provider.list();
      expect(providers).toBeDefined();

      const session = await conn.client.session.create({
        directory: "D:/Work/CraftStation/craftstation/.worktrees/v0.8",
        title: "craftstation-live-smoke",
      });
      const sessionId = (session.data as { id?: string } | undefined)?.id;
      expect(sessionId).toBeDefined();

      const sessionGet = await conn.client.session.get({
        directory: "D:/Work/CraftStation/craftstation/.worktrees/v0.8",
        sessionID: sessionId!,
      });
      expect((sessionGet.data as { id?: string } | undefined)?.id).toBe(sessionId);

      const messages = await conn.client.session.messages({
        directory: "D:/Work/CraftStation/craftstation/.worktrees/v0.8",
        sessionID: sessionId!,
      });
      expect(Array.isArray(messages.data)).toBe(true);

      const del = await conn.client.session.delete({
        directory: "D:/Work/CraftStation/craftstation/.worktrees/v0.8",
        sessionID: sessionId!,
      });
      expect(del).toBeDefined();
    } finally {
      await transport.dispose();
    }
  }, 30_000);

  it("runs OpenCodeNativeSession lifecycle against live server", async () => {
    const transport = new OpenCodeNativeTransport({
      projectLocation: {
        kind: "windows",
        path: "D:/Work/CraftStation/craftstation/.worktrees/v0.8",
      },
      readyTimeoutMs: 15_000,
    });
    try {
      const plan: CraftPlan = {
        id: "plan:live:test",
        recipeId: "recipe:deepseek-opencode-native",
        resultItemId: "result:live:test",
        ingredients: {
          model: {
            slot: "model",
            itemId: "deepseek:deepseek-v4-flash",
            itemVersion: "1.0",
            vendor: "deepseek",
            kind: "model",
          },
          harness: {
            slot: "harness",
            itemId: "harness:opencode",
            itemVersion: "1.0",
            vendor: "opencode",
            kind: "harness",
          },
        },
        runtimeBinding: {
          harnessKind: "opencode",
          modelId: "deepseek-v4-flash",
          vendor: "deepseek",
          providerID: "deepseek",
          runtimeAdapterId: "native-harness:opencode",
        },
        workspace: "D:/Work/CraftStation/craftstation/.worktrees/v0.8",
        threadId: "thread:live:smoke",
        createdAt: new Date().toISOString(),
      };

      const session = await OpenCodeNativeSession.open({
        entityId: "entity:live:smoke",
        threadId: "thread:live:smoke",
        projectLocation: {
          kind: "windows",
          path: "D:/Work/CraftStation/craftstation/.worktrees/v0.8",
        },
        plan,
        transport,
      });

      expect(session.id).toMatch(/^sess:opencode:ses_/u);
      expect(session.status).toBe("idle");

      const snapshot = session.getSnapshot();
      expect(snapshot.sessionId).toBe(session.id);
      expect(snapshot.status).toBe("idle");

      const msgs = await session.readMessages();
      expect(Array.isArray(msgs)).toBe(true);

      // Attempt prompt turn: since DEEPSEEK_API_KEY is not configured in env, expect error rejection
      await expect(session.startTurn({ prompt: "Hello OpenCode" })).rejects.toThrow(
        /error|failed|execution|timeout|model not found|authentication|auth required/iu,
      );

      await session.terminate();
      expect(session.status).toBe("terminated");
    } finally {
      await transport.dispose();
    }
  }, 30_000);
});
