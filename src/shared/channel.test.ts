import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appIdFor,
  artifactPrefixFor,
  CRAFTSTATION_CHANNELS,
  productNameFor,
  updaterChannelFor,
  userDataDirNameFor,
} from "./channel";

describe("channel", () => {
  it("enumerates exactly stable and nightly", () => {
    expect(CRAFTSTATION_CHANNELS).toEqual(["stable", "nightly"]);
  });

  it("returns the right product names", () => {
    expect(productNameFor("stable")).toBe("CraftStation");
    expect(productNameFor("nightly")).toBe("CraftStation Nightly");
  });

  it("returns the right app ids", () => {
    expect(appIdFor("stable")).toBe("com.craftstation.app");
    expect(appIdFor("nightly")).toBe("com.craftstation.app.nightly");
  });

  it("returns the right user data dir names", () => {
    expect(userDataDirNameFor("stable")).toBe(".craftstation");
    expect(userDataDirNameFor("nightly")).toBe(".craftstation-nightly");
  });

  it("only returns a published channel name for nightly", () => {
    expect(updaterChannelFor("stable")).toBeUndefined();
    expect(updaterChannelFor("nightly")).toBe("nightly");
  });

  it("returns artifact prefixes that are distinct between channels", () => {
    expect(artifactPrefixFor("stable")).toBe("CraftStation");
    expect(artifactPrefixFor("nightly")).toBe("CraftStation-Nightly");
    expect(artifactPrefixFor("stable")).not.toBe(artifactPrefixFor("nightly"));
  });
});

describe("resolveCraftStationChannel", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("defaults to stable when __CRAFTSTATION_CHANNEL__ is unset", async () => {
    vi.resetModules();
    const mod = await import("./channel");
    expect(mod.resolveCraftStationChannel()).toBe("stable");
  });

  it("returns nightly when the build-time constant is 'nightly'", async () => {
    vi.resetModules();
    vi.stubGlobal("__CRAFTSTATION_CHANNEL__", "nightly");
    const mod = await import("./channel");
    expect(mod.resolveCraftStationChannel()).toBe("nightly");
    vi.unstubAllGlobals();
  });

  it("falls back to stable for any unknown value", async () => {
    vi.resetModules();
    vi.stubGlobal("__CRAFTSTATION_CHANNEL__", "beta");
    const mod = await import("./channel");
    expect(mod.resolveCraftStationChannel()).toBe("stable");
    vi.unstubAllGlobals();
  });
});
