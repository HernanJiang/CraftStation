// Electron-based hosts (VS Code, Poracode production build) set
// ELECTRON_RUN_AS_NODE=1 in their child processes.  If that leaks into our
// dev shell, `electron.exe` starts as plain Node and every Electron API is
// undefined.  Delete the variable before spawning electronmon.
delete process.env.ELECTRON_RUN_AS_NODE;

import { execSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDevServerPort } from "./dev-server-port.mjs";
import { sweepStaleSupervisors } from "./sweepStaleSupervisors.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../dist/main/main.cjs");

function fileLooksReady(path) {
  try {
    return existsSync(path) && statSync(path).size > 0;
  } catch {
    return false;
  }
}

async function waitForMainEntry(timeoutMs = 30_000) {
  const started = Date.now();
  while (!fileLooksReady(mainEntry)) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${mainEntry}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
}

sweepStaleSupervisors();
await waitForMainEntry();

const env = {
  ...process.env,
  VITE_DEV_SERVER_URL:
    process.env.PORACODE_DEV_APP_URL ?? `http://127.0.0.1:${resolveDevServerPort()}`,
};
const cdpUserDataDir = process.env.PORACODE_CDP_USER_DATA_DIR?.trim();
if (cdpUserDataDir) {
  const require = createRequire(import.meta.url);
  const electronPath = require("electron");
  const app = spawn(electronPath, [`--user-data-dir=${cdpUserDataDir}`, "."], {
    stdio: "inherit",
    windowsHide: process.platform === "win32",
    env,
  });
  const stop = () => app.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const code = await new Promise((resolveExit, reject) => {
    app.once("error", reject);
    app.once("exit", (exitCode) => resolveExit(exitCode));
  });
  process.exitCode = code ?? 1;
} else {
  execSync("electronmon .", { stdio: "inherit", env });
}
