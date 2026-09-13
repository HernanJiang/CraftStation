import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  museForeignHttpCatalog,
  museForeignSettingsCatalog,
  museForeignSettingsDocument,
  museForeignShimPythonSource,
  mungeMuseResponsesPayload,
  startMuseForeignGateway,
} from "./foreignGateway";

const closers: Array<() => void> = [];
afterEach(() => {
  while (closers.length > 0) closers.pop()?.();
});

describe("museForeignGateway", () => {
  it("builds the HTTP catalog wire format Muse fetches at /muse-code/models", () => {
    const catalog = museForeignHttpCatalog([
      { id: "muse-spark-1.3-contributor", label: "Muse Spark 1.3 Contributor" },
    ]);
    expect(catalog.object).toBe("list");
    expect(catalog.data[0]).toMatchObject({
      id: "muse-spark-1.3-contributor",
      object: "model",
      owned_by: "meta",
    });
    expect(
      (catalog.data[0] as { metadata: { limit: { context: number } } }).metadata.limit.context,
    ).toBe(1_000_000);
  });

  it("builds Ollama-launch settings catalog rows with required integer limits", () => {
    const rows = museForeignSettingsCatalog([{ id: "muse-spark-1.3-contributor" }]);
    expect(rows[0]).toMatchObject({
      model_id: "muse-spark-1.3-contributor",
      provider_id: "meta",
      profile_id: "tbh",
      visibility: "visible",
      is_default: true,
      context_limit: 1_000_000,
      output_limit: 128_000,
    });
    expect(rows[0]?.context_limit).not.toBeNull();
  });

  it("pins endpoint_transport bearer and a settings catalog", () => {
    const doc = museForeignSettingsDocument({
      model: "muse-spark-1.3-contributor",
      gatewayOrigin: "http://127.0.0.1:8399",
    });
    expect(doc).toMatchObject({
      schema_version: 1,
      provider: "meta",
      model: "muse-spark-1.3-contributor",
      endpoint_transport: { base_url: "http://127.0.0.1:8399", auth: "bearer" },
    });
    expect(Array.isArray(doc.model_catalog)).toBe(true);
  });

  it("clamps Muse-only reasoning efforts for OpenAI Responses", () => {
    expect(mungeMuseResponsesPayload({ reasoning: { effort: "ultra" }, store: true })).toEqual({
      reasoning: { effort: "high" },
    });
    expect(mungeMuseResponsesPayload({ reasoning: { effort: "none" } })).toEqual({});
  });

  it("embeds a stdlib Python shim that serves the catalog and forwards /responses", () => {
    const source = museForeignShimPythonSource();
    expect(source).toContain("muse-code/models");
    expect(source).toContain("/responses");
    expect(source).toContain("MUSE_SHIM_UPSTREAM");
    expect(source).not.toContain("sk-");
  });

  it("serves the Muse catalog and forwards Responses through a local gateway", async () => {
    let postedEffort: unknown;
    const upstream = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/responses") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          postedEffort = JSON.parse(Buffer.concat(chunks).toString("utf8")).reasoning?.effort;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "resp_test", output: [] }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("bind");
    closers.push(() => upstream.close());

    const gateway = await startMuseForeignGateway({
      upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}`,
      model: "muse-spark-1.3-contributor",
    });
    closers.push(gateway.close);

    const catalogRes = await fetch(`${gateway.origin}/muse-code/models`);
    const catalog = (await catalogRes.json()) as { object: string; data: Array<{ id: string }> };
    expect(catalog.object).toBe("list");
    expect(catalog.data[0]?.id).toBe("muse-spark-1.3-contributor");

    const responseRes = await fetch(`${gateway.origin}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
      body: JSON.stringify({ model: "muse-spark-1.3-contributor", reasoning: { effort: "ultra" } }),
    });
    expect(responseRes.status).toBe(200);
    expect(postedEffort).toBe("high");
  });
});
