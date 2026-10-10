#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  areasForFile,
  functionalAreas,
  isProductionFile,
  manualGates,
  productionRoots,
} from "./smoke-scenarios.mjs";
import { inspectCdpWindowTargets } from "./craftstation-cdp-target.mjs";
import { resolveDebugConnection } from "./craftstation-debug-session.mjs";
import { responsiveLayoutScenario } from "./craftstation-layout-smoke.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../../");
const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "plan";
const scope = String(args.scope ?? "changed");
const mode = String(args.mode ?? "mock");
let port;
let appUrl;
let sessionFile;
const timeoutMs = Number(args.timeoutMs ?? 12_000);
const outDir = resolve(
  String(
    args.outDir ??
      process.env.CRAFTSTATION_SMOKE_OUT_DIR ??
      join(homedir(), ".craftstation-smoke", `integration-${Date.now()}`),
  ),
);

try {
  if (command === "audit") {
    auditCoverage();
  } else if (command === "plan") {
    printPlan(buildPlan(scope));
  } else if (command === "run") {
    const connection = await resolveDebugConnection({
      session: args.session ?? process.env.CRAFTSTATION_DEBUG_SESSION,
      port: args.port ?? process.env.CRAFTSTATION_CDP_PORT,
      appUrl: args.appUrl ?? process.env.CRAFTSTATION_APP_URL,
      repoRoot,
      allowedPurposes: ["debug", "smoke"],
    });
    if (connection.mode && connection.mode !== mode) {
      throw new Error(
        `managed debug session mode is ${connection.mode}, but this run requested ${mode}; stop it and launch the matching mode`,
      );
    }
    port = connection.port;
    appUrl = connection.appUrl;
    sessionFile = connection.sessionFile;
    await runSmoke(buildPlan(scope));
  } else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function usage() {
  console.error(`Usage:
  node craftstation-integration-smoke.mjs audit
  node craftstation-integration-smoke.mjs plan [--scope changed|full]
  node craftstation-integration-smoke.mjs run [--scope changed|full] [--mode mock|real] [--session <session.json>] [--port <cdp port> --appUrl <dev server url>] [--outDir <dir>] [--ack-manual gate,gate]

Run resolves --session / $CRAFTSTATION_DEBUG_SESSION, one active managed debug session for this repo, or a complete explicit port + URL pair. It never guesses ports.`);
}

function trackedFiles() {
  return lines(runGit(["ls-files", ...productionRoots]));
}

function changedFiles() {
  const tracked = lines(runGit(["diff", "--name-only", "HEAD", "--", ...productionRoots]));
  const untracked = lines(
    runGit(["ls-files", "--others", "--exclude-standard", "--", ...productionRoots]),
  );
  return [...new Set([...tracked, ...untracked])].filter(isProductionFile).sort();
}

function runGit(argv) {
  return execFileSync("git", argv, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: process.platform === "win32",
  });
}

function lines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function auditCoverage() {
  const files = trackedFiles().filter(isProductionFile);
  const unmapped = files.filter((file) => areasForFile(file).length === 0);
  console.log(`Coverage audit: ${files.length} production files, ${functionalAreas.length} areas`);
  if (unmapped.length > 0) {
    for (const file of unmapped) console.log(`UNMAPPED: ${file}`);
    throw new Error(`${unmapped.length} production files are missing from the smoke inventory`);
  }
  console.log("PASS: every tracked production file maps to at least one functional area");
}

function buildPlan(selectedScope) {
  if (!new Set(["changed", "full"]).has(selectedScope)) {
    throw new Error(`invalid scope: ${selectedScope}`);
  }
  const files = selectedScope === "changed" ? changedFiles() : [];
  const unmapped = files.filter((file) => areasForFile(file).length === 0);
  if (unmapped.length > 0) {
    throw new Error(`changed production paths are unmapped:\n${unmapped.join("\n")}`);
  }
  const areas =
    selectedScope === "full"
      ? functionalAreas
      : functionalAreas.filter((area) => files.some((file) => areasForFile(file).includes(area)));
  const automated = new Set(["baseline"]);
  const manual = new Set();
  for (const area of areas) {
    for (const scenario of area.automated) automated.add(scenario);
    for (const gate of area.manual) manual.add(gate);
  }
  return {
    scope: selectedScope,
    files,
    areas,
    automated: [...automated].sort(),
    manual: [...manual].sort(),
  };
}

function printPlan(plan) {
  console.log(`CraftStation smoke plan (${plan.scope})`);
  console.log(`Execution mode: ${mode}`);
  if (plan.files.length > 0) {
    console.log(`Changed production files: ${plan.files.length}`);
  }
  console.log(
    `Functional areas: ${plan.areas.map((area) => area.id).join(", ") || "baseline only"}`,
  );
  console.log(`Automated scenarios: ${plan.automated.join(", ")}`);
  if (plan.manual.length === 0) {
    console.log(`${mode === "mock" ? "Mock gates" : "Manual gates"}: none`);
  } else {
    console.log(`${mode === "mock" ? "Mock gates" : "Manual gates"}:`);
    for (const gate of plan.manual) console.log(`- ${gate}: ${manualGates[gate]}`);
  }
}

async function runSmoke(plan) {
  if (!new Set(["mock", "real"]).has(mode)) {
    throw new Error(`invalid mode: ${mode}; use mock or real`);
  }
  await mkdir(outDir, { recursive: true });
  printPlan(plan);
  const report = {
    startedAt: new Date().toISOString(),
    scope: plan.scope,
    outDir,
    files: plan.files,
    areas: plan.areas.map((area) => area.id),
    automated: [],
    manual: plan.manual.map((gate) => ({ gate, status: "required", detail: manualGates[gate] })),
    errors: [],
  };

  const target = await waitForTarget();
  const client = await connectTarget(target);
  const runtimeErrors = [];
  client.on("Runtime.exceptionThrown", (event) => {
    runtimeErrors.push(
      event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text,
    );
  });
  client.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error" || event.type === "assert") {
      runtimeErrors.push(event.args?.map((arg) => arg.value ?? arg.description).join(" "));
    }
  });

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    // Windows occlusion can stop requestAnimationFrame even after focusWindow.
    // CDP keeps this isolated renderer visible for deterministic UI interaction.
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    // Electron can start occluded on Windows; input and menu transitions must
    // run against the visible owned window, not a background-throttled surface.
    await bridgeInvoke(client, "focusWindow");
    await runScenario(report, "welcome-dismissal", () => welcomeDismissalScenario(client));
    await installWindowErrorCollector(client);
    await runScenario(report, "baseline", () => baselineScenario(client));
    if (plan.automated.includes("goal")) {
      await runScenario(report, "goal", () => goalScenario(client));
    }
    if (plan.automated.includes("settings")) {
      await runScenario(report, "settings", () => settingsScenario(client));
      await runScenario(report, "control-geometry", () => controlGeometryScenario(client));
    }
    if (plan.automated.includes("schedules")) {
      await runScenario(report, "schedules", () => schedulesScenario(client));
    }
    if (plan.automated.includes("github-actions")) {
      await runScenario(report, "github-actions", () => githubActionsScenario(client));
    }
    if (plan.automated.includes("thread-search")) {
      await runScenario(report, "thread-search", () => threadSearchScenario(client));
    }
    if (plan.automated.includes("browser")) {
      await runScenario(report, "browser", () => browserScenario(client));
      await evaluate(
        client,
        "window.__craftstationDev.closeSettings(); new Promise((resolve) => setTimeout(resolve, 300))",
        true,
      ).catch(() => undefined);
    }
    if (plan.automated.includes("webchat")) {
      // Earlier scenarios can leave the full-screen Actions workspace open.
      // Return to the product sidebar before exercising its New menu.
      await resetDrivenState(client);
      await evaluate(
        client,
        'window.__craftstationDev.stores.app.getState().openDraft("smoke-project")',
      );
      await runScenario(report, "webchat", () => {
        const result = spawnSync(
          process.execPath,
          [
            join(scriptDir, "craftstation-webchat-smoke.mjs"),
            "--session",
            sessionFile,
            "--outDir",
            join(outDir, "webchat"),
          ],
          { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
        );
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        assert(result.status === 0, `ChatGPT web smoke exited ${result.status}`);
        return { outDir: join(outDir, "webchat"), mode: "fixture" };
      });
    }
    if (mode === "mock" && plan.manual.length > 0) {
      await runMockIntegrations(report, client, plan.manual);
    }
    if (plan.automated.includes("composer-caret")) {
      await runScenario(report, "composer-caret", () => composerCaretScenario(client));
    }
    if (plan.automated.includes("preview-close")) {
      await runScenario(report, "preview-close", () => previewCloseScenario(client));
    }
    if (plan.automated.includes("collaboration-layout")) {
      await runScenario(report, "collaboration-layout", () => collaborationLayoutScenario(client));
    }
    if (plan.automated.includes("responsive-layout")) {
      await runScenario(report, "responsive-layout", () =>
        responsiveLayoutScenario(client, join(outDir, "responsive-layout")),
      );
    }
    const collected = await evaluate(client, "window.__smokeErrors ?? []");
    report.errors = [...new Set([...runtimeErrors, ...collected].filter(Boolean))];
    if (report.errors.length > 0) {
      report.automated.push({
        id: "console-errors",
        status: "fail",
        detail: report.errors.slice(0, 5),
      });
    }
  } finally {
    await resetDrivenState(client).catch(() => undefined);
    await client
      .send("Emulation.setFocusEmulationEnabled", { enabled: false })
      .catch(() => undefined);
    client.close();
  }

  const acknowledged = new Set(
    String(args["ack-manual"] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const item of report.manual) {
    if (mode === "mock") item.status = "mocked";
    else if (acknowledged.has(item.gate)) item.status = "acknowledged";
  }
  report.finishedAt = new Date().toISOString();
  const reportPath = join(outDir, "smoke-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  printReport(report, reportPath);

  const automatedFailed = report.automated.some((item) => item.status === "fail");
  const manualPending = mode === "real" && report.manual.some((item) => item.status === "required");
  if (automatedFailed) process.exitCode = 1;
  else if (manualPending) process.exitCode = 2;
}

async function runScenario(report, id, fn) {
  try {
    const detail = await fn();
    report.automated.push({ id, status: "pass", detail });
    console.log(`PASS: ${id}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    report.automated.push({ id, status: "fail", detail });
    console.log(`FAIL: ${id} - ${detail}`);
  }
}

async function goalScenario(client) {
  const threadId = "smoke-craft-goal";
  const goalState = () =>
    evaluate(
      client,
      `(() => {
    const state = window.__craftstationDev.stores.app.getState();
    const ids = state.runtimeItemIdsByThread[${JSON.stringify(threadId)}] ?? [];
    const items = state.runtimeItemsByIdByThread[${JSON.stringify(threadId)}] ?? {};
    return ids.map(id => items[id]).filter(item => item?.type === "goal").at(-1);
  })()`,
    );
  try {
    await bridgeInvoke(client, "controlThreadGoal", {
      threadId,
      action: "edit",
      objective: "Verify Craft-Harness goal IPC",
    });
    const active = await waitForValue(
      goalState,
      (item) => item?.payload?.status === "active",
      "active goal event",
    );
    assert(
      active.payload.objective === "Verify Craft-Harness goal IPC",
      "goal objective was not projected through supervisor events",
    );
    await bridgeInvoke(client, "controlThreadGoal", { threadId, action: "pause" });
    await waitForValue(
      goalState,
      (item) => item?.payload?.status === "paused",
      "paused goal event",
    );
    await bridgeInvoke(client, "controlThreadGoal", {
      threadId,
      action: "edit",
      objective: "Verify Craft-Harness goal IPC",
      reassert: true,
    });
    assert((await goalState()).payload.status === "paused", "reassert revived a paused goal");
    await bridgeInvoke(client, "controlThreadGoal", { threadId, action: "resume" });
    await waitForValue(
      goalState,
      (item) => item?.payload?.status === "active",
      "resumed goal event",
    );
    await bridgeInvoke(client, "controlThreadGoal", { threadId, action: "clear" });
    await waitForValue(
      goalState,
      (item) => item?.payload?.action === "cleared",
      "cleared goal event",
    );
    return {
      controls: ["edit", "pause", "reassert", "resume", "clear"],
      integration: "renderer/preload/main/supervisor",
    };
  } finally {
    await bridgeInvoke(client, "controlThreadGoal", { threadId, action: "clear" }).catch(
      () => undefined,
    );
  }
}

async function baselineScenario(client) {
  const state = await waitForValue(
    () =>
      evaluate(
        client,
        `(() => ({
          url: location.href,
          title: document.title,
          bodyText: document.body?.innerText ?? "",
          rootChildren: document.querySelector("#root")?.childElementCount ?? 0,
          craftstationBridge: typeof window.craftstation,
          devBridge: typeof window.__craftstationDev,
          crash: /renderer crash|rendered more hooks/i.test(document.body?.innerText ?? ""),
          welcomeVisible: Boolean(document.querySelector(".craftstation-welcome-page")),
          draftComposer: Boolean(document.querySelector('textarea[placeholder], [contenteditable="true"], [data-composer-input-anchor]')),
          modelPicker: Boolean(document.querySelector('[aria-label="Select model"], [aria-label="Models"]')),
        }))()`,
      ),
    (candidate) =>
      candidate.rootChildren > 0 &&
      candidate.bodyText.trim().length > 0 &&
      candidate.craftstationBridge === "object" &&
      candidate.devBridge === "object",
    "renderer initialization",
  );
  assert(state.url === appUrl, `expected ${appUrl}, got ${state.url}`);
  assert(state.rootChildren > 0 && state.bodyText.trim().length > 0, "renderer root is blank");
  assert(state.craftstationBridge === "object", "typed preload bridge is missing");
  assert(state.devBridge === "object", "DEV testing bridge is missing");
  assert(!state.crash, "renderer crash screen or hook-order failure detected");
  assert(!state.welcomeVisible, "welcome screen still blocks the smoke test surface");
  const screenshotPath = join(outDir, "smoke-01-baseline.png");
  await screenshot(client, screenshotPath);
  return { ...state, screenshotPath };
}

async function welcomeDismissalScenario(client) {
  const initial = await waitForValue(
    () =>
      evaluate(
        client,
        `(() => ({
          devBridge: typeof window.__craftstationDev,
          rootChildren: document.querySelector("#root")?.childElementCount ?? 0,
          bodyTextLength: document.body?.innerText.length ?? 0,
          welcomeVisible: Boolean(document.querySelector(".craftstation-welcome-page")),
        }))()`,
      ),
    (state) => state.devBridge === "object" && state.rootChildren > 0 && state.bodyTextLength > 0,
    "welcome dismissal bridge",
  );
  if (!initial.welcomeVisible) {
    return { dismissed: false, detail: "welcome screen was already dismissed" };
  }

  const clicked = await evaluate(
    client,
    `(() => {
      const button = document.querySelector(".craftstation-welcome-page button");
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      localStorage.setItem("craftstation-welcome-seen-v16", "true");
      return true;
    })()`,
  );
  assert(clicked, "welcome screen primary action was not clickable");
  const final = await waitForValue(
    () =>
      evaluate(
        client,
        `(() => ({
          ready: document.readyState === "complete",
          devBridge: typeof window.__craftstationDev,
          rootChildren: document.querySelector("#root")?.childElementCount ?? 0,
          bodyTextLength: document.body?.innerText.length ?? 0,
          welcomeVisible: Boolean(document.querySelector(".craftstation-welcome-page")),
        }))()`,
      ),
    (state) =>
      state.ready &&
      state.devBridge === "object" &&
      state.rootChildren > 0 &&
      state.bodyTextLength > 0 &&
      !state.welcomeVisible,
    "welcome screen dismissal",
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  const stable = await evaluate(
    client,
    `({ welcomeVisible: Boolean(document.querySelector(".craftstation-welcome-page")) })`,
  );
  assert(!final.welcomeVisible, "welcome screen remained visible after dismissal");
  assert(!stable.welcomeVisible, "welcome screen returned after dismissal verification");
  await evaluate(
    client,
    `(() => {
      const app = window.__craftstationDev.stores.app.getState();
      const project = app.projects.find((candidate) => candidate.id === "smoke-project");
      if (project) app.openDraft(project.id);
    })()`,
  );
  return { dismissed: true, detail: "welcome screen dismissed through its primary action" };
}

async function settingsScenario(client) {
  const mcpFixture = await startMcpProbeFixture();
  const configuredMcpServers = [
    {
      id: "smoke-mcp-connected",
      name: "smoke-connected",
      description: "Deterministic MCP probe fixture",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "http", url: `${mcpFixture.origin}/mcp`, headers: {} },
    },
    {
      id: "smoke-mcp-auth",
      name: "smoke-auth",
      description: "Deterministic OAuth challenge fixture",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "http", url: `${mcpFixture.origin}/auth`, headers: {} },
    },
  ];
  await evaluate(
    client,
    `window.__craftstationDev.stores.sharedSettings.getState().setMcpServers(${JSON.stringify(configuredMcpServers)})`,
  );
  const sections = [
    "profile",
    "general",
    "audio",
    "appearance",
    "terminal",
    "threads",
    "git",
    "worktrees",
    "notifications",
    "ai",
    "search",
    "shortcuts",
    "remoteAccess",
    "remoteServers",
    "agentsGeneral",
    "skills",
    "mcpServers",
    "plugins",
    "browser",
    "usage",
    "archived",
    "changelog",
    "about",
  ];
  let mcpListScreenshotPath;
  let mcpScreenshotPath;
  let mcpImportScreenshotPath;
  let pluginsScreenshotPath;
  let skillsScreenshotPath;
  let skillsImportScreenshotPath;
  let skillsImportDestinationsScreenshotPath;
  let skillsMarketplaceScreenshotPath;
  let skillsTargetsScreenshotPath;
  for (const section of sections) {
    await evaluate(
      client,
      `window.__craftstationDev.openSettings(${JSON.stringify(section)}); new Promise((resolve) => setTimeout(resolve, 200))`,
      true,
    );
    const state = await waitForValue(
      () =>
        evaluate(
          client,
          `(() => ({
            hasContent: Boolean(document.querySelector('[data-settings-scroll-area="true"]')),
            textLength: document.body.innerText.length,
            crash: /renderer crash|rendered more hooks/i.test(document.body.innerText),
          }))()`,
        ),
      (candidate) => candidate.hasContent && candidate.textLength > 0,
      `settings section ${section}`,
    );
    assert(state.hasContent && state.textLength > 0, `settings section ${section} did not render`);
    assert(!state.crash, `settings section ${section} rendered a crash screen`);
    if (section === "skills") {
      await waitForValue(
        () =>
          evaluate(
            client,
            `(() => ({
              // The app localizes aria-labels; match the known translations.
              hasSearch: Boolean(
                document.querySelector('[aria-label="Search skills"], [aria-label="搜索技能"]'),
              ),
              text: document.body.innerText,
            }))()`,
          ),
        (result) => result.hasSearch && (mode === "real" || result.text.includes("smoke-global")),
        "skills settings fixture",
      );
      if (mode === "mock") {
        ({
          skillsImportScreenshotPath,
          skillsImportDestinationsScreenshotPath,
          skillsMarketplaceScreenshotPath,
          skillsTargetsScreenshotPath,
        } = await skillsSectionDeepDive(client));
      }
      skillsScreenshotPath = join(outDir, "smoke-02-skills.png");
      await screenshot(client, skillsScreenshotPath);
    }
    if (section === "mcpServers") {
      if (mode === "mock") {
        ({ mcpListScreenshotPath, mcpScreenshotPath, mcpImportScreenshotPath } =
          await mcpServersSectionDeepDive(client, mcpFixture));
      }
    }
    if (section === "plugins") {
      ({ pluginsScreenshotPath } = await pluginsSectionDeepDive(client));
    }
  }
  const screenshotPath = join(outDir, "smoke-02-settings.png");
  await screenshot(client, screenshotPath);
  await evaluate(client, "window.__craftstationDev.closeSettings()");
  await evaluate(
    client,
    "window.__craftstationDev.stores.sharedSettings.getState().setMcpServers([])",
  );
  await mcpFixture.close();
  return {
    sections,
    screenshotPath,
    ...(mcpListScreenshotPath ? { mcpListScreenshotPath } : {}),
    ...(mcpScreenshotPath ? { mcpScreenshotPath } : {}),
    ...(mcpImportScreenshotPath ? { mcpImportScreenshotPath } : {}),
    ...(pluginsScreenshotPath ? { pluginsScreenshotPath } : {}),
    ...(skillsScreenshotPath ? { skillsScreenshotPath } : {}),
    ...(skillsImportScreenshotPath ? { skillsImportScreenshotPath } : {}),
    ...(skillsImportDestinationsScreenshotPath ? { skillsImportDestinationsScreenshotPath } : {}),
    ...(skillsMarketplaceScreenshotPath ? { skillsMarketplaceScreenshotPath } : {}),
    ...(skillsTargetsScreenshotPath ? { skillsTargetsScreenshotPath } : {}),
  };
}

async function pluginsSectionDeepDive(client) {
  const pluginId = "browser-tools";
  const marketplaceState = await waitForValue(
    () =>
      evaluate(
        client,
        `(() => {
          const search = document.querySelector('[aria-label="Search plugins"], [aria-label="搜索插件"]');
          const action = document.querySelector("#plugin-browser-tools-action");
          return {
            visible: Boolean(search && !search.closest("[hidden]")),
            pluginCount: document.querySelectorAll("[data-plugin-id]").length,
            action: action?.textContent?.trim(),
            initialInstalled: window.__craftstationDev.stores.sharedSettings.getState().installedPlugins["browser-tools"] !== undefined,
          };
        })()`,
      ),
    (state) => state.visible && state.pluginCount > 0 && Boolean(state.action),
    "plugins marketplace",
  );
  assert(
    marketplaceState.initialInstalled
      ? ["Manage", "管理"].includes(marketplaceState.action)
      : ["Install", "安装"].includes(marketplaceState.action),
    `Browser Tools marketplace action did not match install state: ${JSON.stringify(marketplaceState)}`,
  );

  let detailOpened = false;
  try {
    const opened = await evaluate(
      client,
      `(() => {
        const action = document.querySelector("#plugin-browser-tools-action")?.closest("button");
        if (!(action instanceof HTMLButtonElement)) return false;
        action.click();
        return true;
      })()`,
    );
    assert(opened, "Browser Tools marketplace action was unavailable");
    detailOpened = true;

    const detailState = await waitForValue(
      () =>
        evaluate(
          client,
          `(() => {
            const buttonText = [...document.querySelectorAll("button")].map((button) => button.textContent?.trim());
            const headings = [...document.querySelectorAll("h2")].map((heading) => heading.textContent?.trim());
            const switchNames = [...document.querySelectorAll('[role="switch"]')].map((control) =>
              (control.getAttribute("aria-labelledby") ?? "")
                .split(/\\s+/u)
                .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
                .filter(Boolean)
                .join(" "),
            );
            return {
              installed: window.__craftstationDev.stores.sharedSettings.getState().installedPlugins["browser-tools"] !== undefined,
              back: buttonText.some((t) => ["Back to plugins", "返回插件"].includes(t)),
              uninstall: buttonText.some((t) => ["Uninstall", "卸载"].includes(t)),
              mcpServers: headings.some((h) => ["MCP servers", "MCP服务器"].includes(h)) && /Browser|浏览器/.test(document.body.innerText),
              skills: headings.some((h) => ["Skills", "技能"].includes(h)) && /Browser Control|浏览器控制/.test(document.body.innerText),
              bundledMcpHasNoSeparateSwitch: !switchNames.includes("Browser MCP"),
              skillSwitch: switchNames.some((name) => /Browser Control|浏览器控制/.test(name)),
            };
          })()`,
        ),
      (state) =>
        state.installed &&
        state.back &&
        state.uninstall &&
        state.mcpServers &&
        state.skills &&
        state.bundledMcpHasNoSeparateSwitch &&
        state.skillSwitch,
      "Browser Tools plugin detail",
    );
    assert(
      detailState.mcpServers && detailState.skills,
      "Browser Tools contributions did not render",
    );
    assert(
      detailState.bundledMcpHasNoSeparateSwitch && detailState.skillSwitch,
      "Browser Tools contribution controls did not match the combined plugin contract",
    );

    const pluginsScreenshotPath = join(outDir, "smoke-02-plugins.png");
    await screenshot(client, pluginsScreenshotPath);

    if (!marketplaceState.initialInstalled) {
      const uninstalled = await evaluate(
        client,
        `(() => {
          const button = [...document.querySelectorAll("button")].find(
            (candidate) => ["Uninstall", "卸载"].includes(candidate.textContent?.trim() ?? ""),
          );
          if (!(button instanceof HTMLButtonElement)) return false;
          button.click();
          return true;
        })()`,
      );
      assert(uninstalled, "Browser Tools uninstall action was unavailable");
      await waitForValue(
        () =>
          evaluate(
            client,
            `window.__craftstationDev.stores.sharedSettings.getState().installedPlugins["browser-tools"] === undefined`,
          ),
        Boolean,
        "Browser Tools install-state restoration",
      );
    }

    const restored = await evaluate(
      client,
      `window.__craftstationDev.stores.sharedSettings.getState().installedPlugins[${JSON.stringify(pluginId)}] !== undefined`,
    );
    assert(
      restored === marketplaceState.initialInstalled,
      "Browser Tools install state was not restored",
    );
    return { pluginsScreenshotPath };
  } finally {
    await evaluate(
      client,
      `(() => {
        const store = window.__craftstationDev.stores.sharedSettings.getState();
        const plugin = window.__craftstationDev.stores.plugins
          .getState()
          .plugins.find((candidate) => candidate.name === ${JSON.stringify(pluginId)});
        if (!plugin) return;
        const installed = store.installedPlugins[${JSON.stringify(pluginId)}] !== undefined;
        if (${JSON.stringify(marketplaceState.initialInstalled)} && !installed) {
          store.installPlugin(plugin);
        } else if (!${JSON.stringify(marketplaceState.initialInstalled)} && installed) {
          store.uninstallPlugin(plugin);
        }
      })()`,
    );
    if (detailOpened) {
      await evaluate(
        client,
        `(() => {
          const button = [...document.querySelectorAll("button")].find(
            (candidate) => candidate.textContent?.trim() === "Back to plugins",
          );
          if (button instanceof HTMLButtonElement) button.click();
        })()`,
      );
    }
  }
}

async function skillsSectionDeepDive(client) {
  const toolbarState = await evaluate(
    client,
    `(() => {
      const marketplace = [...document.querySelectorAll("button")].find(
        (candidate) => ["Marketplace", "市场"].includes(candidate.textContent?.trim() ?? ""),
      );
      const add = [...document.querySelectorAll("button")].find(
        (candidate) => ["Add skill", "添加技能"].includes(candidate.textContent?.trim() ?? ""),
      );
      return {
        marketplaceTertiary: marketplace?.classList.contains("button--tertiary") ?? false,
        addTertiary: add?.classList.contains("button--tertiary") ?? false,
      };
    })()`,
  );
  assert(toolbarState.marketplaceTertiary, "skills marketplace action is not tertiary");
  assert(toolbarState.addTertiary, "skills add action is not tertiary");
  await evaluate(
    client,
    `document.querySelector('[aria-label="Skills location"], [aria-label="技能位置"]')?.click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `(() => { const text = document.body.innerText; return (text.includes("Global") || text.includes("全局")) && (text.includes("Projects") || text.includes("项目")); })()`,
      ),
    Boolean,
    "skills target menu",
  );
  const skillsTargetsScreenshotPath = join(outDir, "smoke-02-skills-targets.png");
  await screenshot(client, skillsTargetsScreenshotPath);
  await evaluate(
    client,
    `[...document.querySelectorAll('[role="menuitemradio"]')].find((item) => item.textContent?.trim().startsWith("Global"))?.click()`,
  );
  const opened = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('button[aria-label="Import external skills"], button[aria-label="导入外部技能"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`,
  );
  assert(opened, "skills import modal trigger was unavailable");
  await waitForValue(
    () =>
      evaluate(
        client,
        `/Import external agent skills|导入外部智能体技能/.test(document.body.innerText)`,
      ),
    Boolean,
    "skills import modal",
  );
  const importDestinationIsGhost = await evaluate(
    client,
    `(() => { const trigger = document.querySelector('button[aria-label="Import destination"], button[aria-label="导入目标"]'); return Boolean(trigger?.classList.contains("button--ghost") && trigger.classList.contains("select__trigger")); })()`,
  );
  assert(importDestinationIsGhost, "skills import destination does not match select styling");
  await evaluate(
    client,
    `document.querySelector('button[aria-label="Import destination"], button[aria-label="导入目标"]')?.click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `(() => { const text = document.body.innerText; return (text.includes("Global") || text.includes("全局")) && (text.includes("Projects") || text.includes("项目")); })()`,
      ),
    Boolean,
    "skills import destination menu",
  );
  const skillsImportDestinationsScreenshotPath = join(
    outDir,
    "smoke-02-skills-import-destinations.png",
  );
  await screenshot(client, skillsImportDestinationsScreenshotPath);
  await evaluate(
    client,
    `[...document.querySelectorAll('[role="menuitemradio"]')].find((item) => /^(?:Global|全局)/.test(item.textContent?.trim() ?? ""))?.click()`,
  );
  const expanded = await evaluate(
    client,
    `(() => {
      const buttons = [...document.querySelectorAll("button")].filter((candidate) =>
        candidate.getAttribute("aria-label")?.match(/^(?:Show skills from |显示来自 ).+/),
      );
      // Expand every provider group so the fixture skill is reachable.
      for (const button of buttons) button.click();
      return buttons.length > 0;
    })()`,
  );
  assert(expanded, "skills import provider group was unavailable");
  const selected = await waitForValue(
    () =>
      evaluate(
        client,
        `(() => {
          // Match only the modal's candidate checkbox (zh renders 从 <provider> 中选择 <skill>),
          // not the manager-page buttons that merely mention the skill name.
          const checkbox =
            document.querySelector('[aria-label^="Select smoke-global-external from "]') ??
            document.querySelector('[aria-label^="从 "][aria-label$="smoke-global-external"]');
          if (!(checkbox instanceof HTMLElement)) return false;
          checkbox.click();
          return true;
        })()`,
      ),
    Boolean,
    "skills import candidate",
  );
  assert(selected, "skills import candidate could not be selected");
  if (process.env.SMOKE_DEBUG) {
    const dump = await evaluate(
      client,
      `(() => {
        const candidates = [...document.querySelectorAll('[aria-label*="smoke-global-external"]')];
        const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean);
        return { count: candidates.length, labels: candidates.map((c) => c.getAttribute("aria-label")), buttons: buttons.slice(0, 20) };
      })()`,
    );
    console.log("[smoke-debug] import selection:", JSON.stringify(dump, null, 2));
  }
  await waitForValue(
    () =>
      evaluate(
        client,
        `(() => { const button = [...document.querySelectorAll("button")].find((candidate) => ["Import selected", "导入所选项"].includes(candidate.textContent?.trim() ?? "")); return Boolean(button && !button.disabled); })()`,
      ),
    Boolean,
    "skills import selection",
  );
  const skillsImportScreenshotPath = join(outDir, "smoke-02-skills-import.png");
  await screenshot(client, skillsImportScreenshotPath);
  const closed = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('[role="dialog"] button[aria-label="Close"], [role="dialog"] button[aria-label="关闭"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`,
  );
  assert(closed, "skills import modal close button was unavailable");
  await waitForValue(
    () =>
      evaluate(
        client,
        `({ modalClosed: !/Import external agent skills|导入外部智能体技能/.test(document.body.innerText), settingsOpen: Boolean(document.querySelector('[aria-label="Search skills"], [aria-label="搜索技能"]')) })`,
      ),
    (state) => state.modalClosed && state.settingsOpen,
    "skills import modal close",
  );
  const marketplaceOpened = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => ["Marketplace", "市场"].includes(candidate.textContent?.trim() ?? ""),
      );
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`,
  );
  assert(marketplaceOpened, "skills marketplace trigger was unavailable");
  await waitForValue(
    () => evaluate(client, `/Skills marketplace|技能市场/.test(document.body.innerText)`),
    Boolean,
    "skills marketplace modal",
  );
  const sourceOpened = await evaluate(
    client,
    `(() => {
      const control = document.querySelector('[aria-label="Skill marketplace source"], [aria-label="技能市场来源"]');
      if (!(control instanceof HTMLElement)) return false;
      control.click();
      return true;
    })()`,
  );
  assert(sourceOpened, "skills marketplace source selector was unavailable");
  const marketplaceSources = await waitForValue(
    () =>
      evaluate(
        client,
        `(() => {
          const options = [...document.querySelectorAll('[role="option"]')].map(
            (candidate) => candidate.textContent?.trim(),
          );
          return { options, hasSkillsSh: options.includes("Skills.sh"), hasSkillsDirectory: options.includes("Skills Directory") };
        })()`,
      ),
    (result) => result.hasSkillsSh && result.hasSkillsDirectory,
    "skill marketplace source options",
  );
  assert(!marketplaceSources.options.includes("MCP Market"), "MCP Market source is still visible");
  const skillsMarketplaceScreenshotPath = join(outDir, "smoke-02-skills-marketplace.png");
  await screenshot(client, skillsMarketplaceScreenshotPath);
  return {
    skillsImportScreenshotPath,
    skillsImportDestinationsScreenshotPath,
    skillsMarketplaceScreenshotPath,
    skillsTargetsScreenshotPath,
  };
}

// Runs while the settings overlay is showing the mcpServers section: asserts
// probe results against the fixture, round-trips the built-in disable switch,
// and walks the add-server editor. Returns the captured screenshot paths.
async function mcpServersSectionDeepDive(client, mcpFixture) {
  const mcpState = await evaluate(
    client,
    `(() => {
      const browserRow = document.querySelector('[data-built-in-mcp-server="browser"]');
      return {
        builtInsVisible: /Built-in MCP servers|内置 MCP 服务器/.test(document.body.innerText),
        builtInToolCount: /(?:\\b\\d+ tools?\\b|\\d+ 个工具)/.test(browserRow?.textContent ?? ""),
        addButton: Boolean([...document.querySelectorAll("button")].find((button) => ["Add MCP server", "添加 MCP 服务器"].includes(button.textContent?.trim() ?? ""))),
        browserSwitch: Boolean(
          document.querySelector('[role="switch"][aria-label="Disable Browser"], [role="switch"][aria-label="禁用 浏览器"]'),
        ),
        switchLabels: [...document.querySelectorAll('[role="switch"]')].map((s) => s.getAttribute("aria-label")),
      };
    })()`,
  );
  if (process.env.SMOKE_DEBUG) console.log("[smoke-debug] mcpState:", JSON.stringify(mcpState));
  assert(mcpState.builtInsVisible, "MCP settings did not render built-in servers");
  assert(mcpState.builtInToolCount, "MCP settings did not render built-in tool counts");
  assert(mcpState.addButton, "MCP settings add control is missing");
  assert(mcpState.browserSwitch, "MCP settings built-in disable control is missing");
  try {
    await waitForValue(
      () =>
        evaluate(
          client,
          `(() => ({
            connected: /Connected|已连接/.test(document.body.innerText),
            toolCount: /1 tool|1 个工具/.test(document.body.innerText),
            authRequired: /Authentication required|需要身份验证/.test(document.body.innerText),
            statuses: [...document.querySelectorAll('[role="status"]')].map((status) => status.textContent?.trim()),
          }))()`,
        ),
      (candidate) => candidate.connected && candidate.toolCount && candidate.authRequired,
      "MCP connection probes",
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; fixture requests: ${JSON.stringify(mcpFixture.requests)}`,
      { cause: error },
    );
  }
  const mcpListScreenshotPath = join(outDir, "smoke-02-mcp-servers-list.png");
  await screenshot(client, mcpListScreenshotPath);

  await evaluate(
    client,
    `document.querySelector('[role="switch"][aria-label="Disable Browser"], [role="switch"][aria-label="禁用 浏览器"]').click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `window.__craftstationDev.stores.sharedSettings.getState().disabledBuiltInMcpServers.browser === true`,
      ),
    Boolean,
    "MCP built-in disable persistence",
  );
  await evaluate(
    client,
    `document.querySelector('[role="switch"][aria-label="Enable Browser"], [role="switch"][aria-label="启用 浏览器"]').click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `window.__craftstationDev.stores.sharedSettings.getState().disabledBuiltInMcpServers.browser !== true`,
      ),
    Boolean,
    "MCP built-in re-enable persistence",
  );

  await evaluate(
    client,
    `[...document.querySelectorAll("button")].find((button) => ["Add MCP server", "添加 MCP 服务器"].includes(button.textContent?.trim() ?? "")).click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `({
          editor: /New MCP server|新建 MCP 服务器/.test(document.body.innerText),
          formTab: Boolean([...document.querySelectorAll('[role="tab"]')].find((tab) => ["Form", "表单"].includes(tab.textContent?.trim() ?? ""))),
        })`,
      ),
    (candidate) => candidate.editor && candidate.formTab,
    "MCP form editor",
  );
  await evaluate(
    client,
    `[...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.trim() === "JSON").click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `Boolean(document.querySelector('textarea[aria-label="MCP server JSON configuration"], textarea[aria-label="MCP 服务器 JSON 配置"]'))`,
      ),
    Boolean,
    "MCP JSON editor",
  );
  const mcpScreenshotPath = join(outDir, "smoke-02-mcp-servers.png");
  await screenshot(client, mcpScreenshotPath);
  await evaluate(
    client,
    `[...document.querySelectorAll("button")].find((button) => ["Cancel", "取消"].includes(button.textContent?.trim() ?? "")).click()`,
  );

  await evaluate(
    client,
    `document.querySelector('button[aria-label="Import MCP servers"], button[aria-label="导入 MCP 服务器"]').click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `/Import external agent MCP servers|导入外部代理的 MCP 服务器/.test(document.body.innerText)`,
      ),
    Boolean,
    "MCP external import modal",
  );
  await evaluate(
    client,
    `document.querySelector('button[aria-label="MCP server source scope"], button[aria-label="MCP 服务器来源范围"]').click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `Boolean([...document.querySelectorAll('[role="menuitemradio"]')].find((item) => item.textContent?.trim().startsWith("project")))`,
      ),
    Boolean,
    "MCP project source option",
  );
  await evaluate(
    client,
    `[...document.querySelectorAll('[role="menuitemradio"]')].find((item) => item.textContent?.trim().startsWith("project")).click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `document.body.innerText.includes("smoke_external") || Boolean(document.querySelector('button[aria-label="Show MCP servers from .mcp.json"], button[aria-label="显示 .mcp.json 的 MCP 服务器"]'))`,
      ),
    Boolean,
    "MCP project source discovery",
  );
  await evaluate(
    client,
    `document.querySelector('button[aria-label="Show MCP servers from .mcp.json"], button[aria-label="显示 .mcp.json 的 MCP 服务器"]')?.click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `Boolean(document.querySelector('[aria-label="Select smoke_external from .mcp.json"], [aria-label="从 .mcp.json 中选择 smoke_external"]'))`,
      ),
    Boolean,
    "MCP project candidate",
  );
  const mcpImportScreenshotPath = join(outDir, "smoke-02-mcp-import.png");
  await screenshot(client, mcpImportScreenshotPath);
  const candidateCheckbox = await evaluate(
    client,
    `(() => {
      const checkbox = document.querySelector('[aria-label="Select smoke_external from .mcp.json"], [aria-label="从 .mcp.json 中选择 smoke_external"]');
      const control = checkbox
        ?.closest('[data-slot="checkbox"]')
        ?.querySelector('[data-slot="checkbox-control"]');
      if (!control) return null;
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      return { width: rect.width, height: rect.height, borderWidth: parseFloat(style.borderLeftWidth) };
    })()`,
  );
  assert(
    candidateCheckbox?.width >= 14 &&
      candidateCheckbox.height >= 14 &&
      candidateCheckbox.borderWidth >= 1,
    `MCP import checkbox is not visibly styled: ${JSON.stringify(candidateCheckbox)}`,
  );
  await evaluate(
    client,
    `document.querySelector('[aria-label="Select smoke_external from .mcp.json"], [aria-label="从 .mcp.json 中选择 smoke_external"]').click()`,
  );
  await evaluate(
    client,
    `document.querySelector('button[aria-label="Choose import destination"], button[aria-label="选择导入目标"]').click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `Boolean([...document.querySelectorAll('[role="menuitemradio"]')].find((item) => item.textContent?.trim().startsWith("project")))`,
      ),
    Boolean,
    "MCP project import destination",
  );
  await evaluate(
    client,
    `[...document.querySelectorAll('[role="menuitemradio"]')].find((item) => item.textContent?.trim().startsWith("project")).click()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `(() => { const button = [...document.querySelectorAll("button")].find((item) => /^(?:Import to |导入到 )/.test(item.textContent?.trim() ?? "")); return Boolean(button && !button.disabled); })()`,
      ),
    Boolean,
    "MCP project import selection",
  );
  await evaluate(
    client,
    `(async () => { const button = [...document.querySelectorAll("button")].find((item) => /^(?:Import to |导入到 )/.test(item.textContent?.trim() ?? "")); button?.click(); })()`,
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        `document.body.innerText.includes("smoke_external") && (document.body.innerText.includes("Workspace") || document.body.innerText.includes("工作区"))`,
      ),
    Boolean,
    "MCP project import persistence",
  );
  await evaluate(
    client,
    `document.querySelector('button[aria-label="Delete smoke_external"]')?.click()`,
  );
  return { mcpListScreenshotPath, mcpScreenshotPath, mcpImportScreenshotPath };
}

async function startMcpProbeFixture() {
  let origin = "";
  const requests = [];
  const server = createServer((request, response) => {
    void (async () => {
      const receivedAt = Date.now();
      if (request.url === "/auth") {
        requests.push({ receivedAt, method: request.method, path: request.url });
        response.writeHead(401, {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        });
        response.end();
        return;
      }

      let body = "";
      request.setEncoding("utf8");
      for await (const chunk of request) body += chunk;
      requests.push({ receivedAt, method: request.method, path: request.url, body });

      let message;
      try {
        message = JSON.parse(body);
      } catch {
        response.writeHead(400).end();
        return;
      }

      if (message.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }

      let result;
      if (message.method === "initialize") {
        result = {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "craftstation-smoke-mcp", version: "1.0.0" },
        };
      } else if (message.method === "tools/list") {
        result = {
          tools: [
            {
              name: "smoke_read",
              description: "Read-only smoke fixture tool",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        };
      } else {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  server.unref();
  const address = server.address();
  assert(address && typeof address !== "string", "MCP probe fixture did not bind a TCP port");
  origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    requests,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

async function schedulesScenario(client) {
  const name = `Smoke schedule ${Date.now()}`;
  const input = {
    name,
    prompt: "Deterministic future smoke task. Do not run yet.",
    agentKind: "codex",
    config: { model: "smoke-model", effort: "medium" },
    recurrence: {
      kind: "once",
      runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    enabled: true,
  };
  let created;
  try {
    created = await bridgeInvoke(client, "createSchedule", input);
    assert(created?.id, "schedule create IPC returned no id");
    assert(created.name === name, "created schedule did not preserve its name");
    assert(!("projectId" in created), "device schedule unexpectedly carries a project id");

    const opened = await waitForValue(
      () =>
        evaluate(
          client,
          `(() => {
        const button = [...document.querySelectorAll('button, [role="button"]')].find(
          (candidate) => candidate.getAttribute("aria-label") === "Schedules"
            || candidate.textContent?.trim() === "Schedules"
            || candidate.querySelector(':scope > span')?.textContent?.trim() === "Plan",
        );
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`,
        ),
      Boolean,
      "Schedules shortcut",
    );
    assert(opened, "Plan/Schedules navigation entry was unavailable");
    const rendered = await waitForValue(
      () =>
        evaluate(
          client,
          `(() => ({
            text: document.body.innerText,
            viewKind: window.__craftstationDev.stores.app.getState().view.kind,
            settingsOpen: window.__craftstationDev.stores.panel.getState().settingsOpen,
            runNow: Boolean(document.querySelector('[aria-label="Run now"]')),
            pause: Boolean(document.querySelector('[aria-label="Pause"]')),
          }))()`,
        ),
      (state) =>
        state.viewKind === "schedules" &&
        !state.settingsOpen &&
        state.text.includes(name) &&
        state.runNow &&
        state.pause,
      "scheduled task row",
    );
    assert(rendered.text.includes(name), "created schedule did not render in the main view");

    const paused = await bridgeInvoke(client, "updateSchedule", {
      id: created.id,
      task: { ...input, enabled: false },
    });
    assert(paused.enabled === false, "schedule pause did not persist");
    const listed = await bridgeInvoke(client, "getSchedules");
    assert(
      listed.some((task) => task.id === created.id && task.enabled === false),
      "paused schedule was not returned by the database IPC",
    );

    const screenshotPath = join(outDir, "smoke-02b-schedules.png");
    await screenshot(client, screenshotPath);
    return { scheduleId: created.id, screenshotPath };
  } finally {
    if (created?.id) await bridgeInvoke(client, "deleteSchedule", { id: created.id });
  }
}

async function githubActionsScenario(client) {
  await evaluate(
    client,
    `window.__craftstationDev.openSettings("general"); new Promise((resolve) => setTimeout(resolve, 250))`,
    true,
  );
  const settingsState = await waitForValue(
    () =>
      evaluate(
        client,
        `(() => {
          const settings = window.__craftstationDev.stores.sharedSettings.getState();
          const toggle = [...document.querySelectorAll('[role="option"]')].find(
            (element) => element.textContent?.includes("GitHub Actions"),
          );
          if (!toggle) {
            document.querySelector('button[aria-label="Sidebar shortcuts"]')?.click();
          }
          return {
            hiddenByDefault: settings.sidebarHiddenShortcuts.includes("githubActions"),
            toggleVisible: toggle instanceof HTMLElement,
            toggleSelected: toggle?.getAttribute("aria-selected") === "true",
          };
        })()`,
      ),
    (state) => state.hiddenByDefault && state.toggleVisible,
    "GitHub Actions shortcut setting",
  );
  assert(!settingsState.toggleSelected, "GitHub Actions shortcut should be off by default");

  const opened = await evaluate(
    client,
    `(() => {
      window.__craftstationDev.closeSettings();
      const app = window.__craftstationDev.stores.app.getState();
      const project = app.projects.find((candidate) => !candidate.disabled);
      if (!project) return false;
      app.openGitHubActions(project.id);
      return true;
    })()`,
  );
  assert(opened, "isolated fixture project was not available for GitHub Actions");
  await evaluate(client, "new Promise((resolve) => setTimeout(resolve, 300))", true);
  const actionsState = await waitForValue(
    () =>
      evaluate(
        client,
        `(() => ({
          overlayOpen:
            window.__craftstationDev.stores.panel.getState().githubActionsContext !== null,
          heading: [...document.querySelectorAll("[data-overlay-surface]")].some(
            (element) => element.textContent?.includes("GitHub Actions"),
          ),
          projectPicker: Boolean(document.querySelector('[aria-label="Project"]')),
          crash: /renderer crash|rendered more hooks/i.test(document.body?.innerText ?? ""),
        }))()`,
      ),
    (state) => state.overlayOpen && state.heading && state.projectPicker,
    "GitHub Actions overlay",
  );
  assert(!actionsState.crash, "GitHub Actions view rendered a crash state");
  const screenshotPath = join(outDir, "smoke-02c-github-actions.png");
  await screenshot(client, screenshotPath);
  return { ...settingsState, ...actionsState, screenshotPath };
}

async function controlGeometryScenario(client) {
  // A prior settings scenario may still be closing a nested import dialog.
  // Start from a freshly mounted settings overlay for this independent check.
  await evaluate(
    client,
    "window.__craftstationDev.closeSettings(); new Promise(resolve => setTimeout(resolve, 250))",
    true,
  );
  await evaluate(
    client,
    `window.__craftstationDev.openSettings("general"); new Promise((resolve) => setTimeout(resolve, 250))`,
    true,
  );
  const switchGeometry = await waitForValue(
    () =>
      evaluate(
        client,
        `(() => {
          const read = (selector, pseudo) => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const style = getComputedStyle(element, pseudo);
            return {
              radius: Number.parseFloat(style.borderTopLeftRadius),
              height: Number.parseFloat(style.height),
            };
          };
          return {
            control: read(".switch__control"),
            thumb: read(".switch__thumb"),
          };
        })()`,
      ),
    (geometry) => geometry.control !== null && geometry.thumb !== null,
    "switch geometry",
  );
  assert(isPillGeometry(switchGeometry.control), "switch track is not pill-shaped");
  assert(isPillGeometry(switchGeometry.thumb), "switch thumb is not pill-shaped");

  await evaluate(
    client,
    `window.__craftstationDev.openSettings("appearance"); new Promise((resolve) => setTimeout(resolve, 250))`,
    true,
  );
  const sliderGeometry = await evaluate(
    client,
    `(() => {
      const read = (selector, pseudo) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element, pseudo);
        return {
          radius: Number.parseFloat(style.borderTopLeftRadius),
          height: Number.parseFloat(style.height),
        };
      };
      return {
        track: read(".slider__track"),
        fill: read(".slider__fill"),
        thumb: read(".slider__thumb", "::after"),
      };
    })()`,
  );
  if (sliderGeometry.track) {
    assert(isPillGeometry(sliderGeometry.track), "slider track is not pill-shaped");
  }
  if (sliderGeometry.thumb) {
    assert(isPillGeometry(sliderGeometry.thumb), "slider thumb is not pill-shaped");
  }
  if (sliderGeometry.fill) {
    assert(sliderGeometry.fill.radius === 0, "slider fill must not add an extra rounded cap");
  }
  const screenshotPath = join(outDir, "smoke-02-control-geometry.png");
  await screenshot(client, screenshotPath);
  await evaluate(client, "window.__craftstationDev.closeSettings()");
  return {
    switchGeometry,
    sliderGeometry,
    sliderPresent: sliderGeometry.track !== null,
    screenshotPath,
  };
}

function isPillGeometry(geometry) {
  return geometry !== null && geometry.radius >= geometry.height / 2;
}

async function threadSearchScenario(client) {
  await evaluate(
    client,
    `window.__craftstationDev.stores.panel.setState({ threadSearchOpen: true }); new Promise((resolve) => setTimeout(resolve, 80))`,
    true,
  );
  const state = await waitForValue(
    () =>
      evaluate(
        client,
        `(() => ({
          dialog: Boolean(document.querySelector('[role="dialog"]')),
          searchInput: Boolean(document.querySelector('input[placeholder]')),
          crash: /renderer crash|rendered more hooks/i.test(document.body.innerText),
        }))()`,
      ),
    (candidate) => candidate.dialog && candidate.searchInput,
    "thread search overlay",
  );
  assert(state.dialog && state.searchInput, "thread search overlay did not render");
  assert(!state.crash, "thread search rendered a crash screen");
  const screenshotPath = join(outDir, "smoke-03-thread-search.png");
  await screenshot(client, screenshotPath);
  await evaluate(
    client,
    "window.__craftstationDev.stores.panel.setState({ threadSearchOpen: false })",
  );
  return { ...state, screenshotPath };
}

async function composerCaretScenario(client) {
  // Mock gates may have focused a separate Quick Composer window.
  await bridgeInvoke(client, "focusWindow");
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await evaluate(
    client,
    'window.__craftstationDev.stores.app.getState().openDraft("smoke-project")',
  );
  await waitForValue(
    () =>
      evaluate(
        client,
        'Boolean(document.querySelector(".craftstation-mention-input[contenteditable=true]"))',
      ),
    Boolean,
    "composer caret fixture",
  );
  const results = [];
  for (const text of ["$x$ $y$", "before $x$ then $y^2$ after", "before $x$ then $$y^2$$ after"]) {
    await evaluate(
      client,
      `(() => {
      const editor = document.querySelector('.craftstation-mention-input[contenteditable="true"]');
      editor.replaceChildren();
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", ${JSON.stringify(text)});
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    })()`,
    );
    // Native Chromium editing must follow the paste. DOM Range checks alone
    // miss stale browser selection state after earlier formula nodes change.
    await client.send("Input.insertText", { text: "!" });
    const state = await evaluate(
      client,
      `(() => {
      const editor = document.querySelector('.craftstation-mention-input[contenteditable="true"]');
      const selection = window.getSelection();
      const remainder = document.createRange();
      remainder.selectNodeContents(editor);
      remainder.setStart(selection.anchorNode, selection.anchorOffset);
      const source = [...editor.childNodes].map(node => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        const delimiter = node.dataset.mathDisplay === "true" ? "$$" : "$";
        return delimiter + node.dataset.mathTex + delimiter;
      }).join("");
      return { source, remaining: remainder.toString(), chips: editor.querySelectorAll("[data-math-tex]").length };
    })()`,
    );
    assert(
      state.source === `${text}!`,
      `typing after pasted formulas inserted at the wrong position: ${JSON.stringify(state.source)}`,
    );
    assert(state.remaining === "", "composer caret jumped before the final formula");
    assert(state.chips === 2, "composer formula fixture did not render both formulas");
    results.push({ text, status: "pass" });
  }
  const screenshotPath = join(outDir, "smoke-composer-caret.png");
  await screenshot(client, screenshotPath);
  await evaluate(
    client,
    `(() => {
    const editor = document.querySelector('.craftstation-mention-input[contenteditable="true"]');
    editor.replaceChildren();
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  })()`,
  );
  return { cases: results, screenshotPath };
}

async function previewCloseScenario(client) {
  await bridgeInvoke(client, "focusWindow");
  const previousZoom = await evaluate(
    client,
    "window.__craftstationDev.stores.sharedSettings.getState().zoomFactor",
  );
  const cases = [];
  const screenshots = [];
  await evaluate(
    client,
    `(async () => {
      const react = await import('/node_modules/.vite/deps/react.js');
      const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { AppProvider } = await import('/src/renderer/components/ui/provider.tsx');
      const { default: Markdown } = await import('/src/renderer/components/thread/ChatPane/parts/items/ItemMarkdownInner.tsx');
      const { ImageCard } = await import('/src/renderer/components/thread/ChatPane/parts/items/ImageCard.tsx');
      const { closeImageLightbox } = await import('/src/renderer/components/composer/ImageLightbox.tsx');
      const createElement = react.createElement ?? react.default.createElement;
      const host = document.createElement('div');
      host.id = 'craftstation-preview-close-smoke';
      host.style.cssText = 'position:fixed;inset:140px 200px;z-index:40;overflow:auto;background:var(--background)';
      document.body.append(host);
      const root = (dom.createRoot ?? dom.default.createRoot)(host);
      window.__previewCloseSmoke = {
        render: kind => {
          const text = kind === 'mermaid' ? '~~~mermaid\\nflowchart LR\\n subgraph Env [无头浏览器 (Browser Gym)]\\n A[开始] -->|分支 (x)| B[检查滚轮缩放与关闭按钮] --> C[放大] --> D[拖动] --> E[缩小] --> F[结束]\\n end\\n~~~' : '~~~text\\n关闭按钮点击检查\\n~~~';
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#80b8e0"/></svg>';
          const content = kind === 'image'
            ? createElement(ImageCard, {source:{src:'data:image/svg+xml,' + encodeURIComponent(svg),mime:'image/svg+xml',extension:'svg',fileName:'preview.svg',alt:'预览检查',width:400,height:240}})
            : createElement(Markdown, {text, key:kind});
          root.render(createElement(AppProvider, {syncWindowChrome:false}, content));
        },
        cleanup: () => {closeImageLightbox(); root.unmount(); host.remove(); delete window.__previewCloseSmoke;}
      };
    })()`,
    true,
  );
  try {
    for (const zoom of [1, 1.3, 1.5]) {
      await evaluate(
        client,
        `window.__craftstationDev.stores.sharedSettings.getState().setZoomFactor(${zoom})`,
      );
      for (const kind of ["code", "mermaid", "image"]) {
        await evaluate(client, `window.__previewCloseSmoke.render(${JSON.stringify(kind)})`);
        const opener =
          kind === "image"
            ? "#craftstation-preview-close-smoke [data-craftstation-image-card] > button"
            : "#craftstation-preview-close-smoke .lc-md-code-header button[aria-label]";
        const closer =
          kind === "image" ? ".craftstation-image-lightbox__close" : ".modal__close-trigger";
        await waitForValue(
          () => evaluate(client, `Boolean(document.querySelector(${JSON.stringify(opener)}))`),
          Boolean,
          `waiting for ${kind} preview fixture`,
        );
        for (const fraction of [0.15, 0.5, 0.85]) {
          await evaluate(client, `document.querySelector(${JSON.stringify(opener)}).click()`);
          await waitForValue(
            () => evaluate(client, `Boolean(document.querySelector(${JSON.stringify(closer)}))`),
            Boolean,
            `waiting for ${kind} preview`,
          );
          await evaluate(
            client,
            `(async () => {
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const button = document.querySelector(${JSON.stringify(closer)});
              const overlay = button.closest('.modal__backdrop') ?? button.closest('[role="dialog"]');
              await Promise.all(overlay.getAnimations({subtree:true}).map(a => a.finished.catch(() => {})));
            })()`,
            true,
          );
          const geometry = await evaluate(
            client,
            `(() => {
              const button = document.querySelector(${JSON.stringify(closer)});
              const r = button.getBoundingClientRect();
              // Keep corner samples inside the visible round button.
              const points = [.25,.5,.75].flatMap(x => [.25,.5,.75].map(y => ({x:r.left+r.width*x,y:r.top+r.height*y})));
              return {w:innerWidth,h:innerHeight,points,domReachable:points.every(p => button.contains(document.elementFromPoint(p.x,p.y))),click:{x:r.left+r.width*${fraction},y:r.top+r.height/2}};
            })()`,
          );
          assert(geometry.domReachable, `${kind} close button is covered at zoom ${zoom}`);
          if (fraction === 0.15 && kind !== "code") {
            const wheelZoom = await previewWheelZoom(client, kind, zoom);
            cases.push({ kind, zoom, wheelZoom });
          }
          if (process.platform === "win32" && fraction === 0.15) {
            await bridgeInvoke(client, "focusWindow");
            const result = spawnSync(
              "powershell.exe",
              [
                "-NoProfile",
                "-File",
                join(scriptDir, "craftstation-native-hit-test.ps1"),
                "-CdpPort",
                String(port),
                "-ViewportWidth",
                String(geometry.w),
                "-ViewportHeight",
                String(geometry.h),
                "-PointsJson",
                JSON.stringify(geometry.points),
              ],
              { encoding: "utf8", windowsHide: true, timeout: 15_000 },
            );
            assert(
              result.status === 0,
              `native preview hit test failed: ${result.stderr || result.error}`,
            );
            const native = JSON.parse(result.stdout);
            assert(
              native.samples.every((p) => p.hit === 1),
              `${kind} close button hits native drag/frame region at zoom ${zoom}: ${JSON.stringify(native.samples)}`,
            );
          }
          if (zoom === 1.3 && fraction === 0.15) {
            const path = join(outDir, `smoke-preview-close-${kind}.png`);
            await screenshot(client, path);
            screenshots.push(path);
          }
          await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...geometry.click });
          await client.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            button: "left",
            buttons: 1,
            clickCount: 1,
            ...geometry.click,
          });
          await client.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            button: "left",
            buttons: 0,
            clickCount: 1,
            ...geometry.click,
          });
          await waitForValue(
            () => evaluate(client, `!document.querySelector(${JSON.stringify(closer)})`),
            Boolean,
            `${kind} preview did not close at zoom ${zoom}, fraction ${fraction}`,
          );
        }
        cases.push({
          kind,
          zoom,
          domSamples: 9,
          clicks: 3,
          nativeHitTest: process.platform === "win32" ? "pass" : "not-applicable",
        });
      }
    }
  } finally {
    await evaluate(
      client,
      `window.__previewCloseSmoke?.cleanup(); window.__craftstationDev.stores.sharedSettings.getState().setZoomFactor(${JSON.stringify(previousZoom)})`,
    );
  }
  return { cases, screenshots };
}

async function previewWheelZoom(client, kind, appZoom) {
  const stageSelector =
    kind === "image" ? ".craftstation-image-lightbox__stage" : '[data-preview-zoom="mermaid"]';
  const contentSelector =
    kind === "image" ? ".craftstation-image-lightbox__image" : `${stageSelector} .lc-md-mermaid`;
  await waitForValue(
    () =>
      evaluate(
        client,
        `Boolean(document.querySelector(${JSON.stringify(contentSelector)})?.clientWidth)`,
      ),
    Boolean,
    `waiting for ${kind} zoom content`,
  );
  const geometry = await evaluate(
    client,
    `(() => {
    const stage = document.querySelector(${JSON.stringify(stageSelector)});
    const rect = stage.getBoundingClientRect();
    return {x:rect.left + rect.width / 2, y:rect.top + rect.height / 2, before:document.querySelector(${JSON.stringify(contentSelector)}).getBoundingClientRect().width};
  })()`,
  );
  const wheel = async (deltaY) => {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: geometry.x,
      y: geometry.y,
      deltaX: 0,
      deltaY,
    });
    await evaluate(
      client,
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      true,
    );
  };
  const scale = () =>
    evaluate(
      client,
      `new DOMMatrix(getComputedStyle(document.querySelector(${JSON.stringify(contentSelector)})).transform).a`,
    );
  await wheel(-100);
  await waitForValue(scale, (value) => value > 1.1, `${kind} wheel did not enlarge`);
  const enlarged = await evaluate(
    client,
    `document.querySelector(${JSON.stringify(contentSelector)}).getBoundingClientRect().width`,
  );
  assert(enlarged > geometry.before * 1.1, `${kind} rendered size did not increase`);
  await wheel(100);
  await waitForValue(scale, (value) => Math.abs(value - 1) < 0.001, `${kind} wheel did not shrink`);
  for (let i = 0; i < 9; i++) await wheel(-200);
  await waitForValue(scale, (value) => Math.abs(value - 4) < 0.001, `${kind} upper zoom bound`);

  // Check cursor anchoring on an overflowing axis, with screen/CSS coordinates
  // differing under whole-app zoom. The local point under the cursor must stay put.
  const anchor = await evaluate(
    client,
    `(() => {
    const stage = document.querySelector(${JSON.stringify(stageSelector)}).getBoundingClientRect();
    const content = document.querySelector(${JSON.stringify(contentSelector)}).getBoundingClientRect();
    const horizontal = content.width > stage.width * 1.05;
    const vertical = content.height > stage.height * 1.05;
    const x = stage.left + stage.width / 2 + (horizontal ? stage.width * .05 : 0);
    const y = stage.top + stage.height / 2 + (vertical ? stage.height * .05 : 0);
    return {x,y,horizontal,vertical,localX:(x-content.left)/content.width,localY:(y-content.top)/content.height};
  })()`,
  );
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: anchor.x,
    y: anchor.y,
    deltaX: 0,
    deltaY: 20,
  });
  await waitForValue(scale, (value) => value < 4, `${kind} anchored shrink`);
  const after = await evaluate(
    client,
    `(() => {
    const rect = document.querySelector(${JSON.stringify(contentSelector)}).getBoundingClientRect();
    return {x:(${anchor.x}-rect.left)/rect.width,y:(${anchor.y}-rect.top)/rect.height};
  })()`,
  );
  if (anchor.horizontal)
    assert(
      Math.abs(after.x - anchor.localX) < 0.002,
      `${kind} horizontal cursor drift at ${appZoom}`,
    );
  if (anchor.vertical)
    assert(
      Math.abs(after.y - anchor.localY) < 0.002,
      `${kind} vertical cursor drift at ${appZoom}`,
    );
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: geometry.x,
    y: geometry.y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: geometry.x + 40,
    y: geometry.y + 30,
    button: "left",
    buttons: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: geometry.x + 40,
    y: geometry.y + 30,
    button: "left",
    clickCount: 1,
  });
  const pan = await evaluate(
    client,
    `(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector(${JSON.stringify(contentSelector)})).transform);
    return {x:m.e,y:m.f};
  })()`,
  );
  if (anchor.horizontal || anchor.vertical)
    assert(Math.abs(pan.x) + Math.abs(pan.y) > 1, `${kind} enlarged content did not pan`);
  for (let i = 0; i < 10; i++) await wheel(200);
  await waitForValue(scale, (value) => Math.abs(value - 0.25) < 0.001, `${kind} lower zoom bound`);
  await evaluate(
    client,
    `Array.from(document.querySelector(${JSON.stringify(contentSelector)}).closest('[role="dialog"]').querySelectorAll('button')).find(button => button.textContent.trim().endsWith('%')).click()`,
  );
  await waitForValue(
    scale,
    (value) => Math.abs(value - 1) < 0.001,
    `${kind} reset did not restore size`,
  );
  const finalZoom = await evaluate(
    client,
    "window.__craftstationDev.stores.sharedSettings.getState().zoomFactor",
  );
  assert(finalZoom === appZoom, `${kind} wheel changed whole-app zoom`);
  return {
    enlarged: true,
    shrunk: true,
    min: 0.25,
    max: 4,
    reset: true,
    appZoomPreserved: true,
    cursorAnchoring: anchor.horizontal || anchor.vertical,
  };
}

async function collaborationLayoutScenario(client) {
  const previousZoom = await evaluate(
    client,
    "window.__craftstationDev.stores.sharedSettings.getState().zoomFactor",
  );
  const cases = [];
  await evaluate(
    client,
    `(async () => {
    const react = await import('/node_modules/.vite/deps/react.js');
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { AppProvider } = await import('/src/renderer/components/ui/provider.tsx');
    const { ThreadCollaborationDialog } = await import('/src/renderer/components/thread/ThreadCollaborationDialog.tsx');
    const { registerRemoteProcedureHost } = await import('/src/renderer/remoteProcedureRouter.ts');
    const { remoteOwner, remoteThreadId } = await import('/src/renderer/state/remoteProjection.ts');
    const { useRemoteServersStore } = await import('/src/renderer/state/remoteServersStore.ts');
    const app = window.__craftstationDev.stores.app;
    const originalHost = {
      resolveThreadOwner: id => remoteOwner(app.getState().threads.find(t => t.id === id)),
      resolveProjectOwner: id => remoteOwner(app.getState().projects.find(p => p.id === id)),
      withClient: (id, invoke) => useRemoteServersStore.getState().withClient(id, invoke)
    };
    const desktopId = 'collaboration-layout-fixture';
    const sourceThreadId = remoteThreadId(desktopId, 'source');
    const provenance = id => ({threadId:id,projectId:'fixture-project',title:'讨论架构与实现方案 ' + id,modelId:'gpt-6.1-sol',harnessId:'codex',agentMcpSupported:false,worktreePath:'D:\\Work\\CraftStation'});
    const targets = Array.from({length:5}, (_,i) => ({threadId:'target-'+i,projectId:'fixture-project',title:'讨论架构与实现方案 '+i,status:'idle',attention:'none',provenance:provenance('target-'+i),sameWorktree:true,available:true,sameComposition:false}));
    const exchanges = Array.from({length:6}, (_,i) => ({id:'exchange-'+i,linkId:'link-'+i,projectId:'fixture-project',sourceThreadId:'source',targetThreadId:'target-'+i,sequence:i+1,deliveryMode:'after-current-turn',status:'replied',sourceProvenance:provenance('source'),targetProvenance:provenance('target-'+i),requestItemId:'request-'+i,deliveryBaselineTurnIndex:null,deliveryAnchorItemId:null,replyTurnIndex:null,replyAnchorItemId:null,replyExcerpt:'需要检查布局、输入区与底部操作按钮。长记录应在弹窗内部滚动，输入区保持足够的宽度。'.repeat(5),causalParentExchangeId:null,hopDepth:0,error:null,createdAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z',deliveredAt:null,repliedAt:null}));
    // Use the public remote routing seam with an in-memory client. No request
    // reaches a provider or another thread; restore the normal store host below.
    registerRemoteProcedureHost({
      ...originalHost,
      resolveThreadOwner: id => id === sourceThreadId ? {desktopId,remoteId:'source'} : originalHost.resolveThreadOwner(id),
      withClient: (id, invoke) => id === desktopId ? invoke({listThreadCollaborationTargets:async () => targets,listThreadExchanges:async () => exchanges}) : originalHost.withClient(id, invoke)
    });
    const host = document.createElement('div'); document.body.append(host);
    const root = (dom.createRoot ?? dom.default.createRoot)(host);
    const h = react.createElement ?? react.default.createElement;
    window.__collaborationLayoutSmoke = {cleanup: () => {root.unmount();host.remove();registerRemoteProcedureHost(originalHost);delete window.__collaborationLayoutSmoke;}};
    root.render(h(AppProvider,{syncWindowChrome:false},h(ThreadCollaborationDialog,{isOpen:true,sourceThreadId,onClose:()=>root.render(null)})));
  })()`,
    true,
  );
  try {
    await waitForValue(
      () =>
        evaluate(
          client,
          "document.querySelectorAll('.craftstation-collaboration-dialog [role=option]').length",
        ),
      (n) => n === 5,
      "waiting for collaboration fixture targets",
    );
    await evaluate(
      client,
      "document.querySelector('.craftstation-collaboration-form input[type=checkbox]').click()",
    );
    await waitForValue(
      () =>
        evaluate(
          client,
          "document.querySelectorAll('.craftstation-collaboration-form textarea').length",
        ),
      (n) => n === 2,
      "waiting for the portable context field",
    );
    for (const [width, height, zoom] of [
      [1460, 900, 1],
      [1460, 900, 1.3],
      [1460, 900, 1.5],
      [900, 700, 1.3],
      [560, 720, 1.3],
    ]) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        client,
        `window.__craftstationDev.stores.sharedSettings.getState().setZoomFactor(${zoom})`,
      );
      await evaluate(
        client,
        `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
        true,
      );
      const geometry = await evaluate(
        client,
        `(() => {
        const dialog = document.querySelector('.craftstation-collaboration-dialog');
        const body = dialog.querySelector('.craftstation-collaboration-body');
        const form = dialog.querySelector('.craftstation-collaboration-form');
        const request = dialog.querySelector('textarea[name="thread-collaboration-request"]') ?? dialog.querySelector('textarea');
        const records = dialog.querySelector('section');
        const footer = dialog.querySelector('.modal__footer');
        const box = e => {const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        return {dialog:box(dialog),form:box(form),request:box(request),records:box(records),footer:box(footer),bodyWidth:body.clientWidth,bodyScrollWidth:body.scrollWidth,bodyHeight:body.clientHeight,bodyScrollHeight:body.scrollHeight,columns:getComputedStyle(body).gridTemplateColumns.split(' ').length};
      })()`,
      );
      assert(
        geometry.dialog.left >= -1 &&
          geometry.dialog.right <= width + 1 &&
          geometry.dialog.top >= -1 &&
          geometry.dialog.bottom <= height + 1,
        `collaboration dialog exceeds viewport: ${JSON.stringify({ width, height, zoom, geometry })}`,
      );
      assert(
        geometry.footer.bottom <= height + 1 && geometry.footer.height > 20,
        "collaboration actions are clipped",
      );
      assert(
        geometry.request.width >= geometry.form.width - 4,
        "request does not fill its form column",
      );
      assert(
        geometry.bodyScrollWidth <= geometry.bodyWidth + 1,
        "collaboration body scrolls horizontally",
      );
      const expectedColumns = width / zoom >= 900 ? 2 : 1;
      assert(
        geometry.columns === expectedColumns,
        `collaboration columns do not follow usable dialog width at ${width}, zoom ${zoom}`,
      );
      if (expectedColumns === 2)
        assert(geometry.form.width >= 420, "collaboration input column is too narrow");
      assert(
        geometry.bodyScrollHeight > geometry.bodyHeight,
        "long collaboration content does not scroll inside the dialog",
      );
      await evaluate(
        client,
        "document.querySelector('.craftstation-collaboration-body').scrollTop = 10000",
      );
      const footerVisible = await evaluate(
        client,
        "(() => {const f=document.querySelector('.craftstation-collaboration-dialog .modal__footer');const r=f.getBoundingClientRect();return f.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()",
      );
      assert(footerVisible, "collaboration content covers the footer after scrolling");
      await evaluate(
        client,
        "document.querySelector('.craftstation-collaboration-body').scrollTop = 0",
      );
      const path = join(outDir, `smoke-collaboration-${width}-${zoom}.png`);
      await screenshot(client, path);
      cases.push({
        width,
        height,
        zoom,
        columns: geometry.columns,
        inputWidth: Math.round(geometry.request.width),
        screenshot: path,
      });
    }
    await evaluate(
      client,
      "document.querySelector('.craftstation-collaboration-dialog .modal__close-trigger').click()",
    );
    await waitForValue(
      () => evaluate(client, "!document.querySelector('.craftstation-collaboration-dialog')"),
      Boolean,
      "collaboration close button did not close the dialog",
    );
  } finally {
    await evaluate(
      client,
      `window.__collaborationLayoutSmoke?.cleanup();window.__craftstationDev.stores.sharedSettings.getState().setZoomFactor(${JSON.stringify(previousZoom)})`,
    );
    await client.send("Emulation.clearDeviceMetricsOverride");
  }
  return { cases };
}

async function browserScenario(client) {
  await resetBrowserTabs(client);
  const result = spawnSync(
    process.execPath,
    [
      join(scriptDir, "craftstation-browser-smoke.mjs"),
      ...(sessionFile ? ["--session", sessionFile] : ["--port", String(port), "--appUrl", appUrl]),
      "--outDir",
      join(outDir, "browser"),
      "--commandTimeoutMs",
      "20000",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: process.platform === "win32",
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert(result.status === 0, `browser smoke exited ${result.status}`);
  return { outDir: join(outDir, "browser") };
}

async function resetBrowserTabs(client) {
  const state = await bridgeInvoke(client, "browserGetState");
  for (const tab of state?.tabs ?? []) {
    await bridgeInvoke(client, "browserCloseTab", { tabId: tab.tabId });
  }
}

async function runMockIntegrations(report, client, gates) {
  const fixture = await evaluate(
    client,
    `(() => {
      const state = window.__craftstationDev.stores.app.getState();
      const project =
        state.projects.find((candidate) => candidate.id === "smoke-project") ??
        state.projects.find((candidate) => !candidate.disabled);
      return {
        project,
        threadCount: state.threads.length,
        runtimeRequests: state.runtimeRequestsByThread,
        bridgeKeys: Object.keys(window.craftstation),
        bodyText: document.body.innerText,
      };
    })()`,
  );
  assert(fixture.project?.location, "isolated fixture project is missing");

  const passed = [];
  for (const gate of gates) {
    try {
      const detail = await runMockGate(client, gate, fixture);
      report.manual.find((item) => item.gate === gate).status = "mocked";
      report.manual.find((item) => item.gate === gate).detail = detail;
      passed.push(gate);
      console.log(`MOCK PASS: ${gate} - ${detail}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      report.automated.push({ id: `mock:${gate}`, status: "fail", detail });
      console.log(`MOCK FAIL: ${gate} - ${detail}`);
    }
  }
  report.automated.push({
    id: "mock-integrations",
    status: passed.length === gates.length ? "pass" : "fail",
    detail: `${passed.length}/${gates.length} deterministic mock gates passed`,
  });
}

async function runMockGate(client, gate, fixture) {
  switch (gate) {
    case "changed-surface":
      return "covered by baseline and diff-selected automated scenarios";
    case "file-editor": {
      const result = await bridgeInvoke(client, "listProjectTree", {
        projectLocation: fixture.project.location,
        directoryPath: "",
      });
      assert(result && Array.isArray(result.entries), "project tree bridge did not return entries");
      return "fixture project tree bridge returned successfully";
    }
    case "git-mutations": {
      const result = await bridgeInvoke(client, "getGitStatus", {
        projectLocation: fixture.project.location,
      });
      assert(result && typeof result === "object", "git status bridge returned no result");
      return "fixture git status round-trip returned successfully";
    }
    case "github-actions-live": {
      for (const key of [
        "ghListWorkflows",
        "ghListWorkflowRuns",
        "ghGetWorkflowDefinition",
        "ghRerunWorkflowRun",
        "ghDeleteWorkflowRun",
      ]) {
        assert(fixture.bridgeKeys.includes(key), `GitHub Actions bridge is missing ${key}`);
      }
      return "GitHub Actions list, definition, rerun, and delete bridge contracts are exposed";
    }
    case "ipc-roundtrip": {
      const projects = await bridgeInvoke(client, "dbGetProjects");
      const settings = await bridgeInvoke(client, "getSharedSettings");
      assert(Array.isArray(projects), "database project IPC returned no array");
      assert(settings && typeof settings === "object", "settings IPC returned no object");
      return "database and settings IPC round-trips returned successfully";
    }
    case "mcp-extension": {
      const statuses = await bridgeInvoke(client, "getAgentStatuses", []);
      const discovery = await bridgeInvoke(client, "discoverExternalMcpServers", {
        sourceScope: "workspace",
        projectLocation: fixture.project.location,
      });
      assert(
        statuses && typeof statuses === "object",
        "agent/MCP discovery bridge returned no result",
      );
      assert(
        discovery && Array.isArray(discovery.groups),
        "external MCP workspace discovery bridge returned no groups",
      );
      assert(fixture.bridgeKeys.includes("browserGetState"), "browser MCP bridge is missing");
      return "mock provider status, external MCP discovery, and browser bridge contracts responded";
    }
    case "skills-manager": {
      const initial = await bridgeInvoke(client, "scanSkills", {
        projectLocation: fixture.project.location,
      });
      const managed = initial.skills.find(
        (skill) =>
          skill.name === "smoke-review" && skill.scope === "project" && skill.origin === "managed",
      );
      const external = initial.skills.find(
        (skill) =>
          skill.name === "smoke-external" &&
          skill.scope === "project" &&
          skill.origin === "external",
      );
      assert(managed?.enabled, "managed fixture skill was not discovered as enabled");
      assert(external?.importState === "available", "external fixture skill is not importable");

      await bridgeInvoke(client, "setSkillEnabled", {
        absolutePath: managed.absolutePath,
        enabled: false,
        projectLocation: fixture.project.location,
      });
      const disabledScan = await bridgeInvoke(client, "scanSkills", {
        projectLocation: fixture.project.location,
      });
      const disabled = disabledScan.skills.find(
        (skill) => skill.name === "smoke-review" && skill.origin === "managed",
      );
      assert(disabled && !disabled.enabled, "managed fixture skill did not disable");
      await bridgeInvoke(client, "setSkillEnabled", {
        absolutePath: disabled.absolutePath,
        enabled: true,
        projectLocation: fixture.project.location,
      });

      const imported = await bridgeInvoke(client, "importSkills", {
        skills: [
          {
            sourcePath: external.absolutePath,
            destinationScope: "project",
            mode: "copy",
            replace: false,
            projectLocation: fixture.project.location,
          },
        ],
      });
      assert(imported.imported.length === 1, "external fixture skill did not import");
      const importedScan = await bridgeInvoke(client, "scanSkills", {
        projectLocation: fixture.project.location,
      });
      const importedExternal = importedScan.skills.find(
        (skill) => skill.name === "smoke-external" && skill.origin === "external",
      );
      assert(importedExternal?.enabled, "imported provider fixture was not enabled");
      await bridgeInvoke(client, "setSkillEnabled", {
        absolutePath: importedExternal.absolutePath,
        enabled: false,
        projectLocation: fixture.project.location,
      });
      const disabledExternalScan = await bridgeInvoke(client, "scanSkills", {
        projectLocation: fixture.project.location,
      });
      const disabledExternal = disabledExternalScan.skills.find(
        (skill) => skill.name === "smoke-external" && skill.origin === "external",
      );
      assert(disabledExternal && !disabledExternal.enabled, "provider fixture did not disable");
      await bridgeInvoke(client, "setSkillEnabled", {
        absolutePath: disabledExternal.absolutePath,
        enabled: true,
        projectLocation: fixture.project.location,
      });
      await bridgeInvoke(client, "deleteSkill", {
        absolutePath: imported.imported[0],
        projectLocation: fixture.project.location,
      });
      const finalScan = await bridgeInvoke(client, "scanSkills", {
        projectLocation: fixture.project.location,
      });
      assert(
        !finalScan.skills.some(
          (skill) => skill.name === "smoke-external" && skill.origin === "managed",
        ),
        "imported fixture skill was not deleted",
      );
      return "managed and provider skill disable/enable, copy import, and delete round-tripped";
    }
    case "provider-skill-delivery": {
      const expected = {
        claude: "prompt",
        codex: "dollar",
        gemini: "prompt",
        opencode: "prompt",
        copilot: "slash",
        commandcode: "slash",
        cursor: "slash",
        grok: "slash",
        antigravity: "prompt",
        pi: "skill",
      };
      for (const [agentKind, invocation] of Object.entries(expected)) {
        const result = await bridgeInvoke(client, "scanSkills", {
          projectLocation: fixture.project.location,
          agentKind,
        });
        assert(
          result.invocation === invocation,
          `${agentKind} returned the wrong skill invocation`,
        );
        assert(
          result.skills.some(
            (skill) => skill.name === "smoke-review" && result.effectiveSkillIds.includes(skill.id),
          ),
          `${agentKind} did not receive the managed fixture skill`,
        );
      }
      return "all supported adapters exposed the managed fixture skill with their invocation mode";
    }
    case "native-auth-update": {
      await evaluate(
        client,
        `window.__craftstationDev.setUpdate({ phase: "downloaded", version: "mock-smoke" })`,
      );
      const update = await evaluate(client, "window.__craftstationDev.stores.update.getState()");
      const usageState = await bridgeInvoke(client, "getUsageLoginState", {});
      assert(
        update.phase === "downloaded" && update.version === "mock-smoke",
        "update state mock failed",
      );
      assert(
        usageState && typeof usageState === "object",
        "usage login state bridge returned no result",
      );
      return "update state and usage-auth state were exercised with deterministic mock data";
    }
    case "project-mutations":
      assert(fixture.project.id === "smoke-project", "isolated project fixture is not selected");
      return "isolated seeded project was loaded and selected";
    case "provider-live": {
      const state = await evaluate(
        client,
        `(() => {
          const candidate = {
            kind: "codex",
            label: "Smoke Provider",
            installed: true,
            authState: "authenticated",
            envKind: "posix",
            capabilities: {
              models: [{ id: "smoke-model", label: "Smoke Model" }],
              efforts: ["medium"],
              defaultEffort: "medium",
              modelEfforts: { "smoke-model": ["medium"] },
              modes: ["agent"],
              approvalPolicies: [{ id: "on-request", label: "On Request" }],
              defaultApprovalPolicy: "on-request",
              sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
              defaultSandboxMode: "workspace-write",
              supportsResume: true,
              supportsDirectInput: true,
              supportsOneShot: true,
              liveInputMode: "terminal",
              presentationMode: "terminal",
              presentationModes: ["terminal", "gui"],
              settingDefs: [],
            },
          };
          window.__craftstationDev.stores.agentStatuses.getState().hydrateFromCache({
            windows: [candidate],
            wsl: [],
          });
          window.__craftstationDev.stores.app.getState().openDraft(${JSON.stringify(fixture.project.id)});
          return { hydrated: true, kind: candidate.kind };
        })()`,
      );
      assert(state.hydrated, `provider fixture hydration failed: ${state.reason ?? "unknown"}`);
      const controls = await waitForValue(
        () =>
          evaluate(
            client,
            `(() => ({
              selectControls: document.querySelectorAll('[data-testid="auto-harness-model"], [aria-label="Select model"]').length,
            }))()`,
          ),
        (candidate) => candidate.selectControls > 0,
        "mock provider controls",
      );
      assert(controls.selectControls > 0, "provider model/approval controls did not render");
      return `provider ${state.kind} was hydrated and selector UI rendered without external credentials`;
    }
    case "remote-mobile": {
      const pairing = await bridgeInvoke(client, "getRemoteAccessPairing");
      assert(pairing && typeof pairing === "object", "remote pairing bridge returned no result");
      return "remote pairing state bridge returned successfully";
    }
    case "runtime-requests": {
      assert(
        fixture.runtimeRequests && typeof fixture.runtimeRequests === "object",
        "runtime request store missing",
      );
      assert(
        fixture.bridgeKeys.includes("resolveThreadServerRequest"),
        "runtime request IPC is missing",
      );
      return "runtime request store and resolution IPC contract were checked";
    }
    case "terminal-pty":
      assert(fixture.bridgeKeys.includes("startThread"), "thread launch bridge is missing");
      assert(
        ["startShell", "writeTerminal", "resizeTerminal", "closeThread"].every((key) =>
          fixture.bridgeKeys.includes(key),
        ),
        "terminal lifecycle IPC contract is incomplete",
      );
      return "terminal lifecycle IPC contracts checked; real PTY input/output requires the separate manual gate";
    case "visual-a11y": {
      const result = await evaluate(
        client,
        `(() => ({
          unlabeled: [...document.querySelectorAll("button,input,textarea")].filter((el) => {
            const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.textContent?.trim();
            return !label;
          }).length,
          dark: document.documentElement.classList.contains("dark"),
        }))()`,
      );
      assert(
        result.unlabeled === 0,
        `${result.unlabeled} interactive controls lack an accessible label`,
      );
      assert(result.dark, "dark theme baseline did not render");
      return "interactive labels and dark-theme baseline were checked";
    }
    default:
      return `mock gate acknowledged: ${gate}`;
  }
}

async function bridgeInvoke(client, method, payload) {
  const payloadText = payload === undefined ? "" : JSON.stringify(payload);
  return evaluate(client, `window.craftstation[${JSON.stringify(method)}](${payloadText})`, true);
}

async function resetDrivenState(client) {
  await evaluate(client, "window.__craftstationDev?.reset()");
}

async function installWindowErrorCollector(client) {
  await evaluate(
    client,
    `(() => {
      if (window.__smokeErrors) return;
      window.__smokeErrors = [];
      window.addEventListener("error", (event) => window.__smokeErrors.push("window.error: " + event.message));
      window.addEventListener("unhandledrejection", (event) => window.__smokeErrors.push("unhandledrejection: " + String(event.reason)));
    })()`,
  );
}

async function waitForTarget() {
  const started = Date.now();
  let cdpRespondedWithPages = false;
  let lastPageUrls = [];
  while (Date.now() - started < timeoutMs) {
    try {
      const inspection = await inspectCdpWindowTargets({ port, appUrl, windowKind: "main" });
      if (inspection.ready.length === 1) return inspection.ready[0];
      if (inspection.ready.length > 1) {
        throw new Error(
          `multiple ready main targets match ${appUrl}: ${inspection.ready.map((target) => target.id).join(", ")}`,
        );
      }
      if (inspection.candidates.length === 0 && inspection.pageTargets.length > 0) {
        cdpRespondedWithPages = true;
        lastPageUrls = inspection.pageTargets.map((target) => target.url);
      }
    } catch {
      // Electron is still starting.
    }
    // Once CDP serves page targets that don't match, the URL won't change.
    if (cdpRespondedWithPages) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  if (cdpRespondedWithPages) {
    throw new Error(
      `no CraftStation CDP target matching ${appUrl} on port ${port}. ` +
        `Available page targets: ${lastPageUrls.join(", ")}. ` +
        `Check CRAFTSTATION_APP_URL / port allocation.`,
    );
  }
  throw new Error(`no CraftStation CDP target at ${appUrl} on port ${port}`);
}

async function connectTarget(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const listeners = new Map();
  let id = 0;
  await new Promise((resolveOpen, reject) => {
    ws.onopen = resolveOpen;
    ws.onerror = () => reject(new Error("failed to connect to the Electron CDP target"));
  });
  ws.addEventListener("message", (message) => {
    const payload = JSON.parse(message.data);
    if (payload.id) {
      const request = pending.get(payload.id);
      if (!request) return;
      pending.delete(payload.id);
      clearTimeout(request.timeout);
      if (payload.error) request.reject(new Error(JSON.stringify(payload.error)));
      else request.resolve(payload.result);
      return;
    }
    for (const listener of listeners.get(payload.method) ?? []) listener(payload.params ?? {});
  });
  return {
    on(method, listener) {
      const current = listeners.get(method) ?? [];
      current.push(listener);
      listeners.set(method, current);
    },
    send(method, params = {}) {
      id += 1;
      const requestId = id;
      ws.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolveRequest, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`CDP timeout: ${method}`));
        }, timeoutMs);
        pending.set(requestId, { resolve: resolveRequest, reject, timeout });
      });
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function screenshot(client, path) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  await writeFile(path, Buffer.from(result.data, "base64"));
}

async function waitForValue(read, predicate, label) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(lastValue)}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function printReport(report, reportPath) {
  console.log("\nCraftStation integration smoke report");
  for (const result of report.automated) {
    console.log(`${result.status.toUpperCase()}: ${result.id}`);
  }
  for (const item of report.manual) {
    const statusLabel =
      item.status === "acknowledged" ? "ACK" : item.status === "mocked" ? "MOCK" : "MANUAL";
    console.log(`${statusLabel}: ${item.gate}`);
  }
  console.log(`Console/runtime errors: ${report.errors.length}`);
  console.log(`Report: ${reportPath}`);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
