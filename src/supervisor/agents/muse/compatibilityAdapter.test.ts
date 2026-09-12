import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMuseIsolatedRuntime } from "./compatibilityAdapter";
import { nativeMuseConfigHome } from "./paths";

describe("muse compatibilityAdapter", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function runtime() {
    const root = mkdtempSync(join(tmpdir(), "muse-compat-"));
    roots.push(root);
    return root;
  }

  const REAL_KEY = "real-upstream-key-must-never-persist";

  it("builds an isolated runtime pointing at the gateway with a local bearer", () => {
    const root = runtime();
    const result = buildMuseIsolatedRuntime({
      runtimeDir: root,
      sessionId: "ses-1",
      gatewayBaseUrl: "http://127.0.0.1:18080",
      localBearer: "local-ephemeral-token",
      model: "muse-spark-1.3-contributor",
      modelCatalog: ["muse-spark-1.3-contributor"],
      contextLimit: 256000,
      providerLabel: "OpenCode Go",
    });

    expect(result.configHome).toBe(join(root, "muse", "ses-1"));
    expect(result.configPath).toBe(join(root, "muse", "ses-1", "muse", "config.json"));
    expect(existsSync(result.configPath)).toBe(true);
    const config = JSON.parse(readFileSync(result.configPath, "utf8"));
    expect(config.gateway.baseUrl).toBe("http://127.0.0.1:18080");
    expect(config.gateway.auth.token).toBe("local-ephemeral-token");
    expect(config.model).toBe("muse-spark-1.3-contributor");
    expect(config.model_catalog).toEqual(["muse-spark-1.3-contributor"]);
    expect(config.context_limit).toBe(256000);
    expect(result.env["XDG_CONFIG_HOME"]).toBe(result.configHome);
    expect(result.env["XDG_DATA_HOME"]).toBe(result.configHome);
  });

  it("never persists the real upstream key and never touches ~/.config/muse", () => {
    const root = runtime();
    const before = existsSync(nativeMuseConfigHome())
      ? readFileSync(nativeMuseConfigHome(), "utf8").length
      : -1;
    const result = buildMuseIsolatedRuntime({
      runtimeDir: root,
      sessionId: "ses-2",
      gatewayBaseUrl: "http://127.0.0.1:18080",
      localBearer: "local-ephemeral-token",
      model: "muse-spark-1.3-contributor",
    });

    const written = readFileSync(result.configPath, "utf8");
    expect(written).not.toContain(REAL_KEY);
    expect(result.configHome.startsWith(root)).toBe(true);
    // Outside the native Muse tree (tmpdir may live under $HOME — compare
    // against the native config root instead).
    expect(result.configHome.startsWith(nativeMuseConfigHome())).toBe(false);
    // Native config untouched (byte-identical or still absent).
    const after = existsSync(nativeMuseConfigHome())
      ? readFileSync(nativeMuseConfigHome(), "utf8").length
      : -1;
    expect(after).toBe(before);
  });

  it("namespaces concurrent sessions", () => {
    const root = runtime();
    const first = buildMuseIsolatedRuntime({
      runtimeDir: root,
      sessionId: "a",
      gatewayBaseUrl: "http://127.0.0.1:18080",
      localBearer: "t1",
      model: "muse-spark-1.3-contributor",
    });
    const second = buildMuseIsolatedRuntime({
      runtimeDir: root,
      sessionId: "b",
      gatewayBaseUrl: "http://127.0.0.1:18080",
      localBearer: "t2",
      model: "muse-spark-1.3-contributor",
    });
    expect(first.configPath).not.toBe(second.configPath);
    expect(existsSync(first.configPath)).toBe(true);
    expect(existsSync(second.configPath)).toBe(true);
  });

  it("fails closed on missing session/gateway/bearer/model", () => {
    const root = runtime();
    const base = {
      runtimeDir: root,
      sessionId: "s",
      gatewayBaseUrl: "http://127.0.0.1:18080",
      localBearer: "t",
      model: "muse-spark-1.3-contributor",
    };
    expect(() => buildMuseIsolatedRuntime({ ...base, sessionId: " " })).toThrow(
      "requires a sessionId",
    );
    expect(() => buildMuseIsolatedRuntime({ ...base, gatewayBaseUrl: "" })).toThrow(
      "requires a gatewayBaseUrl",
    );
    expect(() => buildMuseIsolatedRuntime({ ...base, localBearer: "" })).toThrow(
      "requires a localBearer",
    );
    expect(() => buildMuseIsolatedRuntime({ ...base, model: "" })).toThrow("requires a model");
  });
});
