import { createServer, request as httpRequest, type Server } from "node:http";
import { connect as netConnect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeHttpClient, resolveProxyConfig, UsageHttpError } from "./usageHttpClient";

describe("resolveProxyConfig", () => {
  it("returns undefined when no proxy env is configured", () => {
    expect(resolveProxyConfig({})).toBeUndefined();
  });

  it("prefers lowercase over uppercase and strips shell quotes", () => {
    expect(
      resolveProxyConfig({
        https_proxy: '"http://127.0.0.1:7897"',
        HTTPS_PROXY: "http://127.0.0.1:1111",
      }),
    ).toEqual({ httpProxy: "", httpsProxy: "http://127.0.0.1:7897" });
  });

  it("falls back to ALL_PROXY and captures NO_PROXY", () => {
    expect(
      resolveProxyConfig({
        ALL_PROXY: "http://127.0.0.1:8080",
        no_proxy: "localhost,127.0.0.1",
      }),
    ).toEqual({
      httpProxy: "http://127.0.0.1:8080",
      httpsProxy: "http://127.0.0.1:8080",
      noProxy: "localhost,127.0.0.1",
    });
  });
});

describe("createNodeHttpClient proxy routing", () => {
  let target: Server;
  let proxy: Server;
  let targetUrl = "";
  let proxyUrl = "";
  let proxiedRequests = 0;

  beforeAll(async () => {
    target = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("target-ok");
    });
    // Minimal forward proxy. undici's ProxyAgent tunnels plain http targets
    // through CONNECT as well, so the tunnel handler is the primary path; the
    // absolute-URI handler remains as a fallback for forward-style requests.
    proxy = createServer((req, res) => {
      proxiedRequests += 1;
      const destination = new URL(req.url ?? "");
      const upstream = httpRequest(
        {
          hostname: destination.hostname,
          port: destination.port,
          path: `${destination.pathname}${destination.search}`,
          method: req.method,
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    });
    proxy.on("connect", (req, clientSocket, head) => {
      proxiedRequests += 1;
      const [host = "", port = "80"] = (req.url ?? "").split(":");
      const tunnel = netConnect(Number(port), host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length > 0) tunnel.write(head);
        tunnel.pipe(clientSocket);
        clientSocket.pipe(tunnel);
      });
      tunnel.on("error", () => clientSocket.destroy());
    });
    await Promise.all([
      new Promise<void>((resolveListen) => target.listen(0, "127.0.0.1", resolveListen)),
      new Promise<void>((resolveListen) => proxy.listen(0, "127.0.0.1", resolveListen)),
    ]);
    targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}/quota`;
    proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((resolveClose) => target.close(() => resolveClose())),
      new Promise<void>((resolveClose) => proxy.close(() => resolveClose())),
    ]);
  });

  it("routes through the configured proxy env", async () => {
    const before = proxiedRequests;
    // Explicit empty no_proxy overrides the ambient process NO_PROXY
    // (which bypasses 127.0.0.1 on this machine) so the hop is observable.
    const client = createNodeHttpClient({ http_proxy: proxyUrl, no_proxy: "" });
    const res = await client.request({ url: targetUrl });
    expect(res.status).toBe(200);
    expect(res.body).toBe("target-ok");
    expect(proxiedRequests).toBe(before + 1);
  });

  it("honors NO_PROXY for bypassed hosts", async () => {
    const before = proxiedRequests;
    const client = createNodeHttpClient({ http_proxy: proxyUrl, no_proxy: "127.0.0.1" });
    const res = await client.request({ url: targetUrl });
    expect(res.status).toBe(200);
    expect(proxiedRequests).toBe(before);
  });

  it("keeps the direct path when no proxy is configured", async () => {
    const before = proxiedRequests;
    const client = createNodeHttpClient({});
    const res = await client.request({ url: targetUrl });
    expect(res.status).toBe(200);
    expect(proxiedRequests).toBe(before);
  });

  it("maps an aborted request to a typed timeout error", async () => {
    const silent = createServer(() => {
      // never respond
    });
    await new Promise<void>((resolveListen) => silent.listen(0, "127.0.0.1", resolveListen));
    try {
      const client = createNodeHttpClient({});
      await expect(
        client.request({
          url: `http://127.0.0.1:${(silent.address() as AddressInfo).port}/`,
          timeoutMs: 200,
        }),
      ).rejects.toBeInstanceOf(UsageHttpError);
    } finally {
      await new Promise<void>((resolveClose) => silent.close(() => resolveClose()));
    }
  });
});
