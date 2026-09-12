import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountBinding } from "@/shared/contracts";
import type { CraftPlan } from "@/shared/crafting";
import { AccountStore } from "@/supervisor/runtime/accountStore";
import { AccountStoreOpenCodeRuntimeBindingResolver } from "./runtimeBinding";

const roots: string[] = [];

function plan(providerID = "openai"): CraftPlan {
  return {
    id: "plan:test",
    recipeId: "recipe:test",
    resultItemId: "result:test",
    ingredients: {},
    runtimeBinding: {
      harnessKind: "opencode",
      providerID,
      modelId: "gpt-4o",
      vendor: providerID,
      runtimeAdapterId: "native-harness:opencode",
      authRef: "auth:work",
      profileRef: "profile:work",
    },
    workspace: "C:/workspace",
    createdAt: new Date(0).toISOString(),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("OpenCode supervisor runtime binding resolver", () => {
  it("resolves projected provider environment into an isolated private transport binding", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-binding-"));
    roots.push(root);
    const store = new AccountStore(root);
    const account = store.add({ provider: "openai", label: "Work" });
    store.projectCredential({
      accountId: account.accountId,
      provider: "openai",
      environment: { OPENAI_API_KEY: "supervisor-only-secret" },
    });
    const binding: AccountBinding = {
      accountId: account.accountId,
      provider: "openai",
      credentialScopeRef: account.credentialScopeRef,
      reason: "explicit",
      boundAt: 1,
    };
    const resolved = await new AccountStoreOpenCodeRuntimeBindingResolver(store).resolve({
      projectLocation: { kind: "windows", path: "C:/workspace" },
      plan: plan(),
      accountBinding: binding,
    });

    expect(resolved.isolationKey).toContain(account.credentialScopeRef);
    expect(resolved.transportOptions).toEqual({
      serverEnvironment: { OPENAI_API_KEY: "supervisor-only-secret" },
      serverRuntimeRoot: store.credentialRoot(account.accountId),
    });
    expect(JSON.stringify(plan())).not.toContain("supervisor-only-secret");
  });

  it("rejects opaque refs without a supervisor-resolved account and provider mismatch", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-binding-"));
    roots.push(root);
    const store = new AccountStore(root);
    const resolver = new AccountStoreOpenCodeRuntimeBindingResolver(store);
    await expect(
      resolver.resolve({
        projectLocation: { kind: "windows", path: "C:/workspace" },
        plan: plan(),
      }),
    ).rejects.toThrow(/no supervisor-resolved account binding/i);

    const account = store.add({ provider: "deepseek", label: "Wrong provider" });
    const binding: AccountBinding = {
      accountId: account.accountId,
      provider: "deepseek",
      credentialScopeRef: account.credentialScopeRef,
      reason: "explicit",
      boundAt: 1,
    };
    await expect(
      resolver.resolve({
        projectLocation: { kind: "windows", path: "C:/workspace" },
        plan: plan("openai"),
        accountBinding: binding,
      }),
    ).rejects.toThrow(/cannot execute route 'openai'/i);
  });

  it("installs an auth-only binding into the private OpenCode data root", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-binding-"));
    roots.push(root);
    const store = new AccountStore(root);
    const account = store.add({ provider: "openai", label: "OAuth" });
    store.projectCredential({
      accountId: account.accountId,
      provider: "openai",
      authJson: '{"openai":{"type":"oauth","access":"secret-access"}}',
    });
    const binding: AccountBinding = {
      accountId: account.accountId,
      provider: "openai",
      credentialScopeRef: account.credentialScopeRef,
      reason: "explicit",
      boundAt: 1,
    };

    const resolved = await new AccountStoreOpenCodeRuntimeBindingResolver(store).resolve({
      projectLocation: { kind: "windows", path: "C:/workspace" },
      plan: plan(),
      accountBinding: binding,
    });

    expect(resolved.transportOptions.serverEnvironment).toEqual({});
    expect(
      readFileSync(
        join(store.credentialRoot(account.accountId), "data", "opencode", "auth.json"),
        "utf8",
      ),
    ).toContain("secret-access");
    expect(JSON.stringify(resolved)).not.toContain("secret-access");
  });

  it("projects the third-party OpenCode provider config before starting the native server", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-binding-"));
    roots.push(root);
    const store = new AccountStore(root);
    const account = store.add({ provider: "openai-compatible", label: "Relay" });
    const binding: AccountBinding = {
      accountId: account.accountId,
      provider: "openai-compatible",
      credentialScopeRef: account.credentialScopeRef,
      reason: "explicit",
      boundAt: 1,
    };
    const resolved = await new AccountStoreOpenCodeRuntimeBindingResolver(
      store,
      (_accountId, modelId) => ({
        env: {
          OPENCODE_CONFIG_DIR: `C:/private/${modelId}`,
          CRAFTSTATION_OPENCODE_PROVIDER: "craftstation",
        },
      }),
    ).resolve({
      projectLocation: { kind: "windows", path: "C:/workspace" },
      plan: plan("craftstation"),
      accountBinding: binding,
    });

    expect(resolved.transportOptions.serverEnvironment).toEqual({
      OPENCODE_CONFIG_DIR: "C:/private/gpt-4o",
      CRAFTSTATION_OPENCODE_PROVIDER: "craftstation",
    });
  });
});
