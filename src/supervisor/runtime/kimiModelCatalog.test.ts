import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { afterEach, expect, it, vi } from "vitest";
import { refreshKimiModelCatalog } from "./kimiModelCatalog";

const homes: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function setup(base = "https://api.kimi.com/coding/v1") {
  const home = mkdtempSync(join(tmpdir(), "kimi-catalog-test-"));
  homes.push(home);
  const path = join(home, "config.toml");
  writeFileSync(
    path,
    `default_model = "kimi-code/kimi-for-coding"
[providers.kimi-code]
type = "kimi"
base_url = "${base}"
api_key = "test-key"
[models."kimi-code/kimi-for-coding"]
provider = "kimi-code"
model = "kimi-for-coding"
display_name = "K2.7 Coding"
[models."kimi-code/kimi-for-coding".overrides]
max_context_size = 131072
[models.custom]
provider = "kimi-code"
model = "custom"
`,
  );
  return { home, path };
}

it("updates names, new models and capabilities while preserving explicit overrides", async () => {
  const { home, path } = setup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "kimi-for-coding",
              display_name: "K2.8 Preview",
              limit: { context: 1048576 },
              reasoning: {
                type: "only",
                effort: { valid: ["low", "high", "max"], default: "max" },
              },
              modalities: { input: ["text", "image", "video"] },
            },
            { id: "future-model", display_name: "Future Model", limit: { context: 2097152 } },
          ],
        }),
      ),
    ),
  );
  expect(await refreshKimiModelCatalog(home)).toBe(true);
  expect(parse(readFileSync(path, "utf8"))).toMatchObject({
    models: {
      "kimi-code/kimi-for-coding": {
        display_name: "K2.8 Preview",
        max_context_size: 1048576,
        support_efforts: ["low", "high", "max"],
        default_effort: "max",
        overrides: { max_context_size: 131072 },
      },
      "kimi-code/future-model": { model: "future-model" },
      custom: { model: "custom" },
    },
  });
});

it.each([
  new Response("", { status: 503 }),
  new Response('{"data":[]}'),
  new Response('{"data":[{"id":"broken"}]}'),
])("retains the previous catalog on a failed or malformed response", async (response) => {
  const { home, path } = setup();
  const before = readFileSync(path, "utf8");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  expect(await refreshKimiModelCatalog(home)).toBe(false);
  expect(readFileSync(path, "utf8")).toBe(before);
});

it("does not send credentials to a custom endpoint", async () => {
  const { home } = setup("https://example.invalid/v1");
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  expect(await refreshKimiModelCatalog(home)).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
