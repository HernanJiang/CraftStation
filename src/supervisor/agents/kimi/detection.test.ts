import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildKimiProbeCapabilities,
  hasKimiCredential,
  hasKimiOAuthCredential,
  KIMI_FALLBACK_PROBE,
  kimiDefaultCapabilities,
  kimiDetectionSpec,
  kimiTerminalAuthMethod,
  normalizeKimiProbeEfforts,
  resolveKimiAuthState,
  resolveKimiProbeHome,
} from "./detection";

describe("hasKimiCredential", () => {
  it("detects a non-empty api_key under [providers.*]", () => {
    const toml = ["[providers.moonshot]", 'api_key = "sk-real-value"'].join("\n");
    expect(hasKimiCredential(toml)).toBe(true);
  });

  it("detects an oauth sub-table", () => {
    const toml = ["[providers.moonshot.oauth]", 'access_token = "tok-123"'].join("\n");
    expect(hasKimiCredential(toml)).toBe(true);
  });

  it("detects an inline oauth table with a value", () => {
    const toml = '[providers.moonshot]\noauth = { access_token = "tok-123" }';
    expect(hasKimiCredential(toml)).toBe(true);
  });

  it("does not treat a managed OAuth storage reference as a live credential", () => {
    const toml = [
      '[providers."managed:kimi-code"]',
      'api_key = "oauth-placeholder"',
      '[providers."managed:kimi-code".oauth]',
      'storage = "file"',
      'key = "kimi-code"',
    ].join("\n");
    expect(hasKimiCredential(toml)).toBe(false);
  });

  it("returns false for a config with no credentials", () => {
    const toml = ["[settings]", 'theme = "dark"', "", "[providers.moonshot]"].join("\n");
    expect(hasKimiCredential(toml)).toBe(false);
  });

  it("returns false for an empty api_key", () => {
    expect(hasKimiCredential('[providers.moonshot]\napi_key = ""')).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(hasKimiCredential("")).toBe(false);
  });
});

describe("hasKimiOAuthCredential", () => {
  it("detects Kimi's persisted OAuth token", () => {
    expect(hasKimiOAuthCredential('{"access_token":"tok-123"}')).toBe(true);
  });

  it("rejects missing or malformed token data", () => {
    expect(hasKimiOAuthCredential("{}")).toBe(false);
    expect(hasKimiOAuthCredential("not-json")).toBe(false);
  });

  it("rejects an emptied host stub (blank access_token after profile isolation)", () => {
    expect(
      hasKimiOAuthCredential(
        JSON.stringify({
          access_token: "",
          refresh_token: "",
          expires_at: 0,
          token_type: "Bearer",
        }),
      ),
    ).toBe(false);
  });
});

describe("kimiDetectionSpec", () => {
  it("builds login commands from the detected executable path", () => {
    expect(kimiDetectionSpec.kind).toBe("kimi");
    expect(kimiDetectionSpec.label).toBe("Kimi Code");
    expect(kimiDetectionSpec.binary).toBe("kimi");
    expect(typeof kimiDetectionSpec.loginCommand).toBe("function");
    if (typeof kimiDetectionSpec.loginCommand !== "function") return;
    expect(
      kimiDetectionSpec.loginCommand({
        location: { kind: "windows", path: "C:\\repo" },
        executablePath: "C:\\Users\\demo\\.kimi-code\\bin\\kimi.exe",
      }),
    ).toBe("& 'C:\\Users\\demo\\.kimi-code\\bin\\kimi.exe' acp --login");
    expect(
      kimiDetectionSpec.loginCommand({
        location: {
          kind: "wsl",
          distro: "Ubuntu",
          linuxPath: "/home/demo/repo",
          uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\repo",
        },
        executablePath: "/home/demo/.kimi-code/bin/kimi",
      }),
    ).toBe("'/home/demo/.kimi-code/bin/kimi' acp --login");
  });

  it("ships a non-interactive installer update and the npm version probe", () => {
    // `kimi upgrade` is an interactive TUI, so there is no `builtIn` updater.
    expect(kimiDetectionSpec.update?.builtIn).toBeUndefined();
    expect(kimiDetectionSpec.update?.npm).toBe("@moonshot-ai/kimi-code");
    expect(kimiDetectionSpec.update?.installer).toEqual({
      posix: {
        binary: "sh",
        args: ["-c", "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash"],
      },
      windows: {
        binary: "powershell.exe",
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
        ],
      },
    });
  });

  it("reports credential state through the capabilities probe", () => {
    expect(kimiDetectionSpec.authProbes).toBeUndefined();
    expect(typeof kimiDetectionSpec.capabilitiesProbe).toBe("function");
  });
});

describe("kimiDefaultCapabilities", () => {
  it("advertises manual/auto/yolo approval policies with an auto bypass posture", () => {
    // Since kimi 0.42 `--yolo` is only Ask When Needed (risky actions,
    // questions and plans still ask); `--auto` is the true Never Ask full
    // access, so "完全访问权限" must resolve to `auto`.
    expect(kimiDefaultCapabilities.approvalPolicies?.map((p) => p.id)).toEqual([
      "default",
      "auto",
      "yolo",
    ]);
    expect(kimiDefaultCapabilities.bypassPermissions).toEqual({ approvalPolicy: "auto" });
    expect(kimiDefaultCapabilities.defaultApprovalPolicy).toBe("auto");
  });

  it("defaults new threads to the CraftStation GUI structured session", () => {
    expect(kimiDefaultCapabilities).toMatchObject({
      liveInputMode: "server",
      presentationMode: "gui",
      presentationModes: ["gui"],
    });
    expect(kimiDefaultCapabilities.modes).toEqual(["agent", "plan"]);
  });
});

describe("normalizeKimiProbeEfforts", () => {
  it("returns nothing without a probe", () => {
    expect(normalizeKimiProbeEfforts(undefined)).toEqual({});
  });

  // K2.7 offers thinking as a state, not a ladder. Keeping the single `on`
  // (rather than reporting no levels) is what lets CraftStation put the session back
  // into that state — Kimi otherwise keeps the previous model's tier across a
  // model switch. The composer draws no picker for a one-option list.
  it("keeps the untiered `on` as an untiered model's only level", () => {
    expect(normalizeKimiProbeEfforts({ efforts: ["on"], defaultEffort: "on" })).toEqual({
      efforts: ["on"],
      defaultEffort: "on",
    });
  });

  // Kimi's own picker shows K2.7 as `On` / `Off (Unsupported)`; `off` is not a
  // level the model can actually run at.
  it("reduces an on/off thinking switch to `on`", () => {
    expect(
      normalizeKimiProbeEfforts({ modelEfforts: { "kimi-for-coding": ["on", "off"] } }),
    ).toEqual({ modelEfforts: { "kimi-for-coding": ["on"] } });
  });

  it("keeps multi-value effort tiers with their default", () => {
    expect(
      normalizeKimiProbeEfforts({
        efforts: ["low", "medium", "high"],
        defaultEffort: "medium",
      }),
    ).toEqual({ efforts: ["low", "medium", "high"], defaultEffort: "medium" });
  });

  it("drops the untiered `on` from a real tier ladder", () => {
    expect(
      normalizeKimiProbeEfforts({ efforts: ["low", "high", "max", "on"], defaultEffort: "on" }),
    ).toEqual({
      efforts: ["low", "high", "max"],
      // `on` is not a tier, so the probed default cannot stand — prefer `high`.
      defaultEffort: "high",
    });
  });

  it("resolves each model's default against its own levels", () => {
    expect(
      normalizeKimiProbeEfforts({
        modelEfforts: {
          "kimi-for-coding": ["on"],
          k3: ["low", "medium", "high"],
        },
        modelDefaultEfforts: { "kimi-for-coding": "on", k3: "on", orphan: "on" },
      }),
    ).toEqual({
      modelEfforts: { "kimi-for-coding": ["on"], k3: ["low", "medium", "high"] },
      // K2.7 keeps `on`; K3's untiered default becomes `high`; a model with
      // neither its own levels nor a global list gets nothing.
      modelDefaultEfforts: { "kimi-for-coding": "on", k3: "high" },
    });
  });

  it("keeps a probed model default that is valid for its levels", () => {
    expect(
      normalizeKimiProbeEfforts({
        modelEfforts: { k3: ["low", "high"] },
        modelDefaultEfforts: { k3: "low" },
      }),
    ).toEqual({
      modelEfforts: { k3: ["low", "high"] },
      modelDefaultEfforts: { k3: "low" },
    });
  });

  // Probed from kimi 0.33.0 with the CLI's persisted model on K2.7: the baseline
  // is `["on"]` and only the K3 models carry their own list.
  it("normalizes the real Kimi 0.33 payload probed from K2.7", () => {
    expect(
      normalizeKimiProbeEfforts({
        efforts: ["on"],
        defaultEffort: "on",
        modelEfforts: {
          "kimi-code/k3": ["low", "high", "max", "on"],
          "kimi-code/k3-256k": ["low", "high", "max", "on"],
        },
        modelDefaultEfforts: {
          "kimi-code/kimi-for-coding": "on",
          "kimi-code/kimi-for-coding-highspeed": "on",
          "kimi-code/k3": "on",
          "kimi-code/k3-256k": "on",
        },
      }),
    ).toEqual({
      // The K2.7 models have no list of their own and inherit this one.
      efforts: ["on"],
      defaultEffort: "on",
      modelEfforts: {
        "kimi-code/k3": ["low", "high", "max"],
        "kimi-code/k3-256k": ["low", "high", "max"],
      },
      modelDefaultEfforts: {
        "kimi-code/kimi-for-coding": "on",
        "kimi-code/kimi-for-coding-highspeed": "on",
        "kimi-code/k3": "high",
        "kimi-code/k3-256k": "high",
      },
    });
  });

  // `session/new` starts on whichever model the Kimi CLI last persisted, so the
  // baseline can just as easily be K3's ladder. K2.7 must not inherit it.
  it("normalizes the same payload probed from a K3 model", () => {
    expect(
      normalizeKimiProbeEfforts({
        efforts: ["low", "high", "max", "on"],
        defaultEffort: "on",
        modelEfforts: {
          "kimi-code/kimi-for-coding": ["on"],
          "kimi-code/kimi-for-coding-highspeed": ["on"],
        },
        modelDefaultEfforts: {
          "kimi-code/kimi-for-coding": "on",
          "kimi-code/kimi-for-coding-highspeed": "on",
          "kimi-code/k3": "on",
          "kimi-code/k3-256k": "on",
        },
      }),
    ).toEqual({
      efforts: ["low", "high", "max"],
      defaultEffort: "high",
      modelEfforts: {
        "kimi-code/kimi-for-coding": ["on"],
        "kimi-code/kimi-for-coding-highspeed": ["on"],
      },
      modelDefaultEfforts: {
        "kimi-code/kimi-for-coding": "on",
        "kimi-code/kimi-for-coding-highspeed": "on",
        "kimi-code/k3": "high",
        "kimi-code/k3-256k": "high",
      },
    });
  });
});

describe("KIMI_FALLBACK_PROBE", () => {
  it("stays identical to the verified K3-probed payload shape", () => {
    // The fallback feeds the same normalizer as a live probe, so it must
    // produce the same verified capability shape (see "normalizes the same
    // payload probed from a K3 model" above).
    expect(KIMI_FALLBACK_PROBE.models?.map((model) => model.id).sort()).toEqual(
      [
        "kimi-code/k3",
        "kimi-code/k3-256k",
        "kimi-code/kimi-for-coding",
        "kimi-code/kimi-for-coding-highspeed",
      ].sort(),
    );
    expect(normalizeKimiProbeEfforts(KIMI_FALLBACK_PROBE)).toEqual({
      efforts: ["low", "high", "max"],
      defaultEffort: "high",
      modelEfforts: {
        "kimi-code/kimi-for-coding": ["on"],
        "kimi-code/kimi-for-coding-highspeed": ["on"],
      },
      modelDefaultEfforts: {
        "kimi-code/kimi-for-coding": "on",
        "kimi-code/kimi-for-coding-highspeed": "on",
        "kimi-code/k3": "high",
        "kimi-code/k3-256k": "high",
      },
    });
    const capabilities = buildKimiProbeCapabilities(KIMI_FALLBACK_PROBE, {
      hasAnyCredential: false,
      hasManagedOAuthCredential: false,
    });
    expect(capabilities.models).toHaveLength(4);
  });
});

describe("buildKimiProbeCapabilities", () => {
  const noCredentials = { hasAnyCredential: false, hasManagedOAuthCredential: false };

  it("passes models through from the probe", () => {
    const models = [{ id: "k3", label: "Kimi for Coding" }];
    expect(buildKimiProbeCapabilities({ models }, noCredentials).models).toEqual(models);
    expect(buildKimiProbeCapabilities(undefined, noCredentials).models).toBeUndefined();
  });

  it("preserves ACP thinking model capabilities", () => {
    expect(
      buildKimiProbeCapabilities({ thinkingModels: ["kimi-for-coding"] }, noCredentials)
        .thinkingModels,
    ).toEqual(["kimi-for-coding"]);
  });

  it("advertises the static terminal login method and prefers it", () => {
    const caps = buildKimiProbeCapabilities(undefined, noCredentials);
    expect(caps.authMethods).toEqual([kimiTerminalAuthMethod]);
    expect(caps.authMethods?.[0]?.id).toBe("kimi-terminal-login");
    expect(caps.preferTerminalLogin).toBe(true);
  });

  it("prefers the probe's authState over the credential fallback", () => {
    expect(
      buildKimiProbeCapabilities(
        { authState: "missing" },
        { hasAnyCredential: true, hasManagedOAuthCredential: false },
      ).authState,
    ).toBe("missing");
    expect(
      buildKimiProbeCapabilities({ authState: "authenticated" }, noCredentials).authState,
    ).toBe("authenticated");
  });

  it("treats a CraftStation pool credential as authenticated even when the host ACP probe reports missing", () => {
    // Host `kimi acp` looks at the wiped ~/.kimi-code stub and returns
    // auth_required. Sessions spawn with KIMI_CODE_HOME on the pool profile,
    // so the composer must not disable send.
    expect(
      buildKimiProbeCapabilities(
        { authState: "missing" },
        {
          hasAnyCredential: true,
          hasManagedOAuthCredential: true,
          hasPoolOAuthCredential: true,
        },
      ).authState,
    ).toBe("authenticated");
    expect(
      resolveKimiAuthState(
        { authState: "missing" },
        { hasAnyCredential: true, hasPoolOAuthCredential: true },
      ),
    ).toBe("authenticated");
  });

  it("falls back to credential files when the probe could not decide", () => {
    expect(
      buildKimiProbeCapabilities(undefined, {
        hasAnyCredential: true,
        hasManagedOAuthCredential: false,
      }).authState,
    ).toBe("authenticated");
    expect(buildKimiProbeCapabilities(undefined, noCredentials).authState).toBe("missing");
    expect(buildKimiProbeCapabilities({}, noCredentials).authState).toBe("missing");
  });

  it("reports logout support from the probe or a managed OAuth credential", () => {
    expect(
      buildKimiProbeCapabilities({ authLogoutSupported: true }, noCredentials).authLogoutSupported,
    ).toBe(true);
    expect(
      buildKimiProbeCapabilities(undefined, {
        hasAnyCredential: false,
        hasManagedOAuthCredential: true,
      }).authLogoutSupported,
    ).toBe(true);
    expect(
      buildKimiProbeCapabilities(undefined, noCredentials).authLogoutSupported,
    ).toBeUndefined();
  });
});

describe("resolveKimiProbeHome", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seedHomes(input: {
    hostToken: string;
    poolToken?: string;
  }): Promise<{ hostHome: string; poolHome?: string }> {
    const hostHome = await mkdtemp(join(tmpdir(), "kimi-host-"));
    await mkdir(join(hostHome, "credentials"), { recursive: true });
    await writeFile(
      join(hostHome, "credentials", "kimi-code.json"),
      JSON.stringify({ access_token: input.hostToken, refresh_token: "", expires_at: 0 }),
      { encoding: "utf8" },
    );
    vi.stubEnv("KIMI_CODE_HOME", hostHome);

    if (input.poolToken === undefined) {
      const accounts = await mkdtemp(join(tmpdir(), "kimi-accounts-empty-"));
      vi.stubEnv("CRAFTSTATION_ACCOUNTS_DIR", accounts);
      return { hostHome };
    }

    const accounts = await mkdtemp(join(tmpdir(), "kimi-accounts-"));
    const poolHome = join(accounts, "profile-test");
    await mkdir(join(poolHome, "credentials"), { recursive: true });
    await writeFile(
      join(poolHome, "credentials", "kimi-code.json"),
      JSON.stringify({ access_token: input.poolToken, refresh_token: "r", expires_at: 1 }),
      { encoding: "utf8" },
    );
    vi.stubEnv("CRAFTSTATION_ACCOUNTS_DIR", accounts);
    return { hostHome, poolHome };
  }

  it("prefers a live pool credential over an emptied host stub", async () => {
    const { poolHome } = await seedHomes({ hostToken: "", poolToken: "pool-token" });
    await expect(
      resolveKimiProbeHome({ kind: "windows", path: "C:\\repo" }),
    ).resolves.toBe(poolHome);
  });

  it("falls back to the host home when the pool has no live token", async () => {
    const { hostHome } = await seedHomes({ hostToken: "host-token" });
    await expect(
      resolveKimiProbeHome({ kind: "windows", path: "C:\\repo" }),
    ).resolves.toBe(hostHome);
  });
});
