import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLocalPairingServiceWorkerJs } from "@/main/remote/pairingPage";

describe("PWA service workers", () => {
  it.each([
    ["hosted", readFileSync("public/service-worker.js", "utf8")],
    ["desktop-served", buildLocalPairingServiceWorkerJs("test")],
  ])("%s worker forwards push payloads to the in-app notification surface", (_surface, worker) => {
    expect(worker).toContain('self.addEventListener("push"');
    expect(worker).toContain('type: "thread-user-notification"');
    expect(worker).toContain("client.postMessage");
    expect(worker).not.toContain("showNotification");
    expect(worker).not.toContain('self.addEventListener("notificationclick"');
  });
});
