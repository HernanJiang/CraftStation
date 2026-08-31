import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountBinding } from "@/shared/contracts";
import type { CraftPlan } from "@/shared/crafting";
import { AccountStore } from "@/supervisor/runtime/accountStore";
import { OPENCODE_NATIVE_HARNESS_DESCRIPTOR } from "@/supervisor/runtime/nativeHarness/descriptors";
import { OpenCodeNativeRuntimeAdapter } from "./adapter";
import { AccountStoreOpenCodeRuntimeBindingResolver } from "./runtimeBinding";
import { OpenCodeNativeServerPool } from "./serverPool";

const workspace = "D:/Work/CraftStation/craftstation/.worktrees/v0.8";
const liveEnabled = process.env.CRAFTSTATION_OPENCODE_LIVE_PROVIDER === "1";
const openCodeAuthPath = join(
  process.env.USERPROFILE ?? "",
  ".local",
  "share",
  "opencode",
  "auth.json",
);
const roots: string[] = [];
const pools: OpenCodeNativeServerPool[] = [];

function managedKimiAuthJson(): string | undefined {
  if (!liveEnabled || !existsSync(openCodeAuthPath)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(openCodeAuthPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const kimi = (parsed as Record<string, unknown>)["kimi-for-coding"];
  if (!kimi || typeof kimi !== "object" || Array.isArray(kimi)) return undefined;
  return JSON.stringify({ "kimi-for-coding": kimi });
}

const kimiAuthJson = managedKimiAuthJson();

afterEach(async () => {
  await Promise.allSettled(pools.splice(0).map((pool) => pool.dispose()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.runIf(liveEnabled && Boolean(kimiAuthJson))(
  "OpenCode real Provider assistant smoke",
  () => {
    it("gets two real Kimi assistant responses through a managed auth binding", async () => {
      const root = mkdtempSync(join(tmpdir(), "craftstation-opencode-provider-smoke-"));
      roots.push(root);
      const store = new AccountStore(join(root, "accounts"));
      const account = store.add({ provider: "kimi-for-coding", label: "temporary-live-smoke" });
      store.projectCredential({
        accountId: account.accountId,
        provider: "kimi-for-coding",
        authJson: kimiAuthJson!,
      });

      const accountBinding: AccountBinding = {
        accountId: account.accountId,
        provider: "kimi-for-coding",
        credentialScopeRef: account.credentialScopeRef,
        reason: "explicit",
        boundAt: Date.now(),
      };
      const pool = new OpenCodeNativeServerPool();
      pools.push(pool);
      const adapter = new OpenCodeNativeRuntimeAdapter({
        projectLocation: { kind: "windows", path: workspace },
        descriptor: OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
        accountBinding,
        readinessProvider: () => ({
          status: "ready",
          reason: "Explicit OpenCode API-credential-backed live smoke.",
        }),
        runtimeBindingResolver: new AccountStoreOpenCodeRuntimeBindingResolver(store),
        serverPool: pool,
      });
      const plan: CraftPlan = {
        id: "plan:live-provider:kimi",
        recipeId: "recipe:moonshot-kimi-opencode-native",
        resultItemId: "result:live-provider:kimi",
        ingredients: {
          model: {
            slot: "model",
            itemId: "moonshot:kimi-for-coding",
            itemVersion: "audit-2026-08",
            vendor: "moonshot",
            kind: "model",
          },
          harness: {
            slot: "harness",
            itemId: "harness:opencode",
            itemVersion: "0.8.0",
            vendor: "opencode",
            kind: "harness",
          },
        },
        runtimeBinding: {
          harnessKind: "opencode",
          providerID: "kimi-for-coding",
          modelId: "kimi-for-coding",
          vendor: "moonshot",
          runtimeAdapterId: "native-harness:opencode",
          authRef: account.credentialScopeRef,
        },
        workspace,
        threadId: "thread:live-provider:kimi",
        createdAt: new Date().toISOString(),
      };

      const entity = await adapter.spawnEntity(plan);
      const session = await adapter.createSession(entity);
      try {
        const first = await session.startTurn({
          prompt: "Reply with exactly CRAFTSTATION_OPENCODE_KIMI_OK.",
        });
        expect(first.status).toBe("completed");
        expect(first.response).toContain("CRAFTSTATION_OPENCODE_KIMI_OK");
        expect(first.response?.trim().length).toBeGreaterThan(0);

        const second = await session.startTurn({
          prompt: "Reply with exactly CRAFTSTATION_OPENCODE_KIMI_TURN2_OK.",
        });
        expect(second.status).toBe("completed");
        expect(second.response).toContain("CRAFTSTATION_OPENCODE_KIMI_TURN2_OK");
        expect(session.status).toBe("idle");
      } finally {
        await session.terminate();
      }
      expect(session.status).toBe("terminated");
    }, 120_000);
  },
);
