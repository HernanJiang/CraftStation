const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fetch, EnvHttpProxyAgent, setGlobalDispatcher } = require("undici");

setGlobalDispatcher(new EnvHttpProxyAgent());

const PREFIX = "lc-safe:v1:";
const cacheDir = path.join(process.env.USERPROFILE, ".craftstation", "cache");
const key = Buffer.from(
  fs.readFileSync(path.join(cacheDir, "secret-key.durable"), "utf8").trim(),
  "base64",
);
const file = JSON.parse(
  fs.readFileSync(path.join(cacheDir, "provider-secrets.durable.json"), "utf8"),
);
const sealed = file["opencode"]?.cookie;
if (!sealed) {
  console.log("NO opencode.cookie in durable file");
  process.exit(0);
}
const [ivB64, tagB64, ctB64] = sealed.slice(PREFIX.length).split(":");
const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
decipher.setAuthTag(Buffer.from(tagB64, "base64"));
const cookie = Buffer.concat([
  decipher.update(Buffer.from(ctB64, "base64")),
  decipher.final(),
]).toString("utf8");
console.log(
  "cookie names:",
  cookie
    .split(";")
    .map((p) => p.trim().split("=")[0])
    .join(","),
);

const SERVER_ID = "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f";
const headers = {
  Cookie: cookie,
  "X-Server-Id": SERVER_ID,
  "X-Server-Instance": `server-fn:${crypto.randomUUID()}`,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  Origin: "https://opencode.ai",
  Referer: "https://opencode.ai",
  Accept: "text/javascript, application/json;q=0.9, */*;q=0.8",
};

(async () => {
  const res = await fetch(`https://opencode.ai/_server?id=${SERVER_ID}`, {
    headers,
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.text();
  console.log("GET workspaces status:", res.status, "len:", body.length);
  const m = body.match(/wrk_[A-Za-z0-9]+/);
  console.log("workspace id:", m ? m[0] : "(none)");
  console.log("signed-out hint:", /public|login|not associated/i.test(body));
  console.log("body head:", body.slice(0, 300).replace(/\s+/g, " "));
})().catch((e) => console.log("fetch error:", e.message));
