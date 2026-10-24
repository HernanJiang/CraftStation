import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { prepareCodexRuntimeBundle } from "./runtimeBundle";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("keeps a running server's helper protocol stable across an in-place npm update", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-bundle-test-"));
  roots.push(root);
  const source = join(root, "vendor", "bin");
  mkdirSync(source, { recursive: true });
  const executable = join(source, "codex.exe");
  const helper = join(source, "codex-code-mode-host.exe");
  writeFileSync(executable, "protocol-v1");
  writeFileSync(helper, "protocol-v1");
  const assets = join(dirname(source), "voice", "lib");
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, "runtime.dll"), "runtime-v1");
  const first = prepareCodexRuntimeBundle(executable, join(root, "cache"));
  expect(first).not.toBe(executable);
  expect(prepareCodexRuntimeBundle(executable, join(root, "cache"))).toBe(first);
  expect(readFileSync(join(dirname(dirname(first)), "voice", "lib", "runtime.dll"), "utf8")).toBe(
    "runtime-v1",
  );

  writeFileSync(executable, "protocol-v2-with-new-fields");
  writeFileSync(helper, "protocol-v2-with-new-fields");
  const second = prepareCodexRuntimeBundle(executable, join(root, "cache"));

  expect(readFileSync(join(dirname(first), "codex-code-mode-host.exe"), "utf8")).toBe(
    "protocol-v1",
  );
  expect(readFileSync(join(dirname(second), "codex-code-mode-host.exe"), "utf8")).toBe(
    "protocol-v2-with-new-fields",
  );
  expect(second).not.toBe(first);
});
