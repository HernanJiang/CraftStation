import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { resolveProxyConfig } from "@/supervisor/runtime/usageHttpClient";

/**
 * Local Muse Code foreign gateway.
 *
 * Public Muse builds only speak the Meta provider. The wire protocol is the
 * OpenAI Responses API plus `GET /muse-code/models` at the origin of
 * `endpoint_transport.base_url` (scheme/host/port only — path is ignored).
 *
 * Same approach as:
 * - `ollama launch muse` (settings `model_catalog` + isolated XDG_CONFIG_HOME)
 * - `muse-openrouter-shim` (local proxy: catalog + POST /responses forward)
 */
export interface MuseForeignCatalogModel {
  id: string;
  label?: string;
  contextLimit?: number;
  outputLimit?: number;
}

export const MUSE_FOREIGN_PROVIDER_ID = "meta";
export const MUSE_FOREIGN_PROFILE_ID = "tbh";
export const MUSE_FOREIGN_FALLBACK_CONTEXT_LIMIT = 1_000_000;
export const MUSE_FOREIGN_FALLBACK_OUTPUT_LIMIT = 128_000;

const EFFORT_MAP: Record<string, string | null> = {
  none: null,
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  ultra: "high",
};

export function museForeignHttpCatalog(models: readonly MuseForeignCatalogModel[]): {
  object: "list";
  data: Array<Record<string, unknown>>;
} {
  return {
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model",
      created: 1_767_225_600,
      owned_by: "meta",
      metadata: {
        name: model.label ?? model.id,
        family: "muse",
        release_date: "2026-01-01",
        is_hidden: false,
        attachment: true,
        reasoning: true,
        temperature: true,
        tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: {
          context: model.contextLimit ?? MUSE_FOREIGN_FALLBACK_CONTEXT_LIMIT,
          output: model.outputLimit ?? MUSE_FOREIGN_FALLBACK_OUTPUT_LIMIT,
        },
        options: {},
        description: `${model.label ?? model.id} via CraftStation`,
        cost: { input: 0, output: 0, cached: 0 },
      },
    })),
  };
}

/** Ollama-launch settings catalog row. Integers are required — nulls are dropped. */
export function museForeignSettingsCatalog(
  models: readonly MuseForeignCatalogModel[],
): Array<Record<string, unknown>> {
  return models.map((model, index) => ({
    model_id: model.id,
    provider_id: MUSE_FOREIGN_PROVIDER_ID,
    profile_id: MUSE_FOREIGN_PROFILE_ID,
    display_label: model.label ?? model.id,
    visibility: "visible",
    display_order: index,
    is_default: index === 0,
    context_limit: model.contextLimit ?? MUSE_FOREIGN_FALLBACK_CONTEXT_LIMIT,
    output_limit: model.outputLimit ?? MUSE_FOREIGN_FALLBACK_OUTPUT_LIMIT,
    description: "Served by CraftStation",
  }));
}

export function museForeignSettingsDocument(input: {
  model: string;
  gatewayOrigin: string;
  models?: readonly MuseForeignCatalogModel[];
}): Record<string, unknown> {
  const models = input.models ?? [{ id: input.model }];
  return {
    schema_version: 1,
    provider: MUSE_FOREIGN_PROVIDER_ID,
    model: input.model,
    endpoint_transport: { base_url: input.gatewayOrigin, auth: "bearer" },
    model_catalog: museForeignSettingsCatalog(models),
  };
}

export function mungeMuseResponsesPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...payload };
  const reasoning = next.reasoning;
  if (reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)) {
    const effort = (reasoning as { effort?: unknown }).effort;
    if (typeof effort === "string") {
      const mapped = Object.prototype.hasOwnProperty.call(EFFORT_MAP, effort)
        ? EFFORT_MAP[effort]
        : "high";
      if (mapped === null) {
        delete next.reasoning;
      } else {
        next.reasoning = { ...reasoning, effort: mapped };
      }
    }
  }
  delete next.store;
  if (next.previous_response_id == null) delete next.previous_response_id;
  return next;
}

/**
 * Stdlib-only Python shim (same protocol as muse-openrouter-shim, MIT).
 * Secrets stay in META_API_KEY / Authorization — never in this file.
 */
export function museForeignShimPythonSource(): string {
  return `#!/usr/bin/env python3
import json, os, ssl, sys, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

UPSTREAM = os.environ.get("MUSE_SHIM_UPSTREAM", "").rstrip("/")
MODEL = os.environ.get("MUSE_SHIM_MODEL", "muse-spark-1.3-contributor")
PORT_FILE = os.environ.get("MUSE_SHIM_PORT_FILE", "")
EFFORT = {"none": None, "minimal": "minimal", "low": "low", "medium": "medium",
          "high": "high", "xhigh": "high", "ultra": "high"}

def catalog():
    return {
        "object": "list",
        "data": [{
            "id": MODEL,
            "object": "model",
            "created": 1767225600,
            "owned_by": "meta",
            "metadata": {
                "name": MODEL,
                "family": "muse",
                "release_date": "2026-01-01",
                "is_hidden": False,
                "attachment": True,
                "reasoning": True,
                "temperature": True,
                "tool_call": True,
                "modalities": {"input": ["text", "image"], "output": ["text"]},
                "limit": {"context": 1000000, "output": 128000},
                "options": {},
                "description": MODEL + " via CraftStation",
                "cost": {"input": 0, "output": 0, "cached": 0},
            },
        }],
    }

def munge(payload):
    reasoning = payload.get("reasoning")
    if isinstance(reasoning, dict) and "effort" in reasoning:
        mapped = EFFORT.get(reasoning["effort"], "high")
        if mapped is None:
            payload.pop("reasoning", None)
        else:
            reasoning["effort"] = mapped
    payload.pop("store", None)
    if payload.get("previous_response_id") is None:
        payload.pop("previous_response_id", None)
    return payload

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, fmt, *args):
        return
    def reply_json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path.endswith("/muse-code/models") or path == "/muse-code/models":
            self.reply_json(catalog())
        else:
            self.reply_json({})
    def do_POST(self):
        path = self.path.split("?", 1)[0]
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        if not path.endswith("/responses"):
            self.reply_json({})
            return
        try:
            payload = munge(json.loads(body or b"{}"))
        except Exception:
            self.reply_json({"error": {"message": "bad request body"}}, 400)
            return
        self.forward(payload)
    def forward(self, payload):
        auth = self.headers.get("Authorization", "")
        req = urllib.request.Request(
            UPSTREAM + "/responses",
            data=json.dumps(payload).encode(),
            method="POST",
            headers={
                "Authorization": auth,
                "Content-Type": "application/json",
                "Accept": "text/event-stream" if payload.get("stream") else "application/json",
                "Accept-Encoding": "identity",
            },
        )
        ctx = ssl.create_default_context()
        try:
            upstream = urllib.request.urlopen(req, context=ctx, timeout=600)
        except urllib.error.HTTPError as e:
            err_body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(err_body)))
            self.end_headers()
            self.wfile.write(err_body)
            return
        except Exception as e:
            self.reply_json({"error": {"message": "upstream failed: %s" % e}}, 502)
            return
        with upstream:
            self.send_response(upstream.status)
            self.send_header("Content-Type", upstream.headers.get("Content-Type", "application/json"))
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            try:
                while True:
                    chunk = upstream.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(b"%x\\r\\n" % len(chunk) + chunk + b"\\r\\n")
                    self.wfile.flush()
                self.wfile.write(b"0\\r\\n\\r\\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

if not UPSTREAM:
    sys.stderr.write("MUSE_SHIM_UPSTREAM is required\\n")
    sys.exit(2)
httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
port = httpd.server_address[1]
if PORT_FILE:
    Path(PORT_FILE).write_text(str(port), encoding="utf-8")
httpd.serve_forever()
`;
}

export interface MuseForeignGateway {
  origin: string;
  port: number;
  close: () => void;
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": data.length });
  res.end(data);
}

/**
 * Node's global `fetch` ignores HTTP(S)_PROXY / WinINET. OpenCode Go then
 * sees the raw CN egress IP and returns RegionError. Same EnvHttpProxyAgent
 * path as usageHttpClient.
 */
function fetchUpstream(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) {
  const proxyConfig = resolveProxyConfig(process.env, { allowSystemProxyFallback: true });
  const requestInit = {
    method: init.method,
    headers: init.headers,
    body: init.body,
  };
  return proxyConfig
    ? undiciFetch(url, { ...requestInit, dispatcher: new EnvHttpProxyAgent(proxyConfig) })
    : undiciFetch(url, requestInit);
}

function shouldAttachOpenCodeSession(upstream: string): boolean {
  try {
    return new URL(upstream).hostname.toLowerCase().endsWith("opencode.ai");
  } catch {
    return false;
  }
}

/**
 * Host-side gateway so the third-party fetch uses the Windows/macOS IP
 * (OpenCode Go rejects some WSL egress with RegionError) while Muse in WSL
 * only talks to this origin for `/muse-code/models` and `/responses`.
 */
export async function startMuseForeignGateway(input: {
  upstreamBaseUrl: string;
  model: string;
  listenHost?: string;
}): Promise<MuseForeignGateway> {
  const upstream = input.upstreamBaseUrl.replace(/\/+$/u, "");
  const catalog = museForeignHttpCatalog([{ id: input.model }]);
  const openCodeSession = shouldAttachOpenCodeSession(upstream) ? randomUUID() : undefined;
  const listenHost = input.listenHost ?? "127.0.0.1";

  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      if (req.method === "GET" && path.endsWith("/muse-code/models")) {
        writeJson(res, 200, catalog);
        return;
      }
      if (req.method === "POST" && path.endsWith("/responses")) {
        let payload: Record<string, unknown>;
        try {
          payload = mungeMuseResponsesPayload(
            JSON.parse((await readRequestBody(req)).toString("utf8") || "{}"),
          );
        } catch {
          writeJson(res, 400, { error: { message: "bad request body" } });
          return;
        }
        const headers: Record<string, string> = {
          authorization: req.headers.authorization ?? "",
          "content-type": "application/json",
          accept: payload.stream ? "text/event-stream" : "application/json",
          "user-agent": "CraftStation-MuseGateway/1.0",
        };
        if (openCodeSession) headers["x-opencode-session"] = openCodeSession;
        const upstreamRes = await fetchUpstream(`${upstream}/responses`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        const contentType = upstreamRes.headers.get("content-type") ?? "application/json";
        res.writeHead(upstreamRes.status, { "Content-Type": contentType });
        if (!upstreamRes.body) {
          res.end();
          return;
        }
        const reader = upstreamRes.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) res.write(Buffer.from(value));
          }
        } finally {
          res.end();
        }
        return;
      }
      writeJson(res, 200, {});
    })().catch((error) => {
      if (!res.headersSent) {
        writeJson(res, 502, {
          error: { message: error instanceof Error ? error.message : String(error) },
        });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, listenHost, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("muse foreign gateway failed to bind");
  }
  const originHost = listenHost === "0.0.0.0" ? "127.0.0.1" : listenHost;
  return {
    origin: `http://${originHost}:${address.port}`,
    port: address.port,
    close: () => {
      server.close();
    },
  };
}
