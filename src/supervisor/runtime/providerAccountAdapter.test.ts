import { describe, expect, it } from "vitest";
import {
  ProviderAccountAdapterRegistry,
  type ProviderAccountAdapter,
} from "./providerAccountAdapter";

const adapter: ProviderAccountAdapter = {
  provider: "fake",
  inspectIdentity: async () => ({ maskedIdentity: "f***e" }),
  projectCredential: async () => "managed:fake",
  collectQuota: async () => ({ status: "available", lastQuotaAt: 1 }),
  launchEnvironment: () => ({ PROVIDER_SCOPE: "managed:fake" }),
};

describe("ProviderAccountAdapterRegistry", () => {
  it("registers providers without a provider switch in the resolver", async () => {
    const registry = new ProviderAccountAdapterRegistry();
    registry.register(adapter);
    expect(registry.get("fake")).toBe(adapter);
    await expect(registry.get("fake")!.collectQuota({} as never)).resolves.toMatchObject({
      status: "available",
    });
  });
});
