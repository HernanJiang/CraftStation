// Middle process for the orphan-watchdog process-level test: stands in for the
// Electron main process. Forks the leaf (the "supervisor") and relays its pid
// so the test can hard-kill THIS process and watch the leaf self-terminate.
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const leafPath = fileURLToPath(new URL("./devOrphanWatchdog-leaf.mjs", import.meta.url));
const leaf = fork(leafPath, {
  stdio: ["ignore", "ignore", "ignore", "ipc"],
  execArgv: [],
});

leaf.on("message", (message) => {
  if (message && typeof message.leafPid === "number") {
    process.send?.({ leafPid: message.leafPid });
  }
});
leaf.on("exit", () => process.exit(0));
setInterval(() => {}, 60_000);
