import { readFileSync, writeFileSync } from "node:fs";
import {
  inspectCdpWindowTargets,
  closeWebSocket,
} from "../.agents/skills/interactive-testing/scripts/craftstation-cdp-target.mjs";

// 只连接指定 managed session，采样不录制 Prompt、网络响应或用户凭据。
const [sessionPath, outputPath, duration = "15"] = process.argv.slice(2);
const seconds = Number(duration);
if (!sessionPath || !outputPath || !Number.isFinite(seconds) || seconds < 1 || seconds > 60) {
  throw new Error(
    "node scripts/profile-desktop-renderer.mjs <session.json> <output.json> [seconds:1..60]",
  );
}
const session = JSON.parse(readFileSync(sessionPath, "utf8"));
if (session.state !== "ready") throw new Error("Managed session must be READY");
const { ready } = await inspectCdpWindowTargets({ port: session.cdpPort, appUrl: session.appUrl });
if (ready.length !== 1) throw new Error("Expected exactly one owned main renderer");
const socket = new WebSocket(ready[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let id = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const call = pending.get(message.id);
  if (!call) return;
  pending.delete(message.id);
  clearTimeout(call.timer);
  if (message.error) call.reject(new Error(JSON.stringify(message.error)));
  else call.resolve(message.result);
};
function send(method, params = {}) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10_000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
try {
  await send("Profiler.enable");
  await send("Performance.enable");
  const before = await send("Performance.getMetrics");
  await send("Profiler.start");
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const { profile } = await send("Profiler.stop");
  const after = await send("Performance.getMetrics");
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const costs = new Map();
  for (let index = 0; index < (profile.samples?.length ?? 0); index++) {
    const nodeId = profile.samples[index];
    costs.set(nodeId, (costs.get(nodeId) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
  }
  const top = [...costs]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([nodeId, us]) => ({
      functionName: nodes.get(nodeId).callFrame.functionName,
      url: nodes.get(nodeId).callFrame.url,
      line: nodes.get(nodeId).callFrame.lineNumber + 1,
      selfMs: us / 1000,
    }));
  writeFileSync(
    outputPath,
    JSON.stringify({ session: session.id, seconds, before, after, top }, null, 2),
  );
  console.log(JSON.stringify({ top: top.slice(0, 12) }, null, 2));
} finally {
  await closeWebSocket(socket);
}
