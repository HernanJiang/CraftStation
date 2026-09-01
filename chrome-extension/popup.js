/** Popup for CraftStation Chrome Control — pure status. The connection to the
 *  CraftStation app is fully automatic, so there is nothing to click. */

const pill = document.getElementById("pill");
const statusText = document.getElementById("statusText");
const desc = document.getElementById("desc");
const version = document.getElementById("version");

function render(status) {
  if (!status) return;
  pill.className = "pill";
  if (status.connected) {
    pill.classList.add("on");
    statusText.textContent = "Connected";
    const tabs = status.attachedTabs && status.attachedTabs.length;
    desc.textContent = tabs
      ? `CraftStation is controlling ${tabs} tab(s) in this browser.`
      : "CraftStation is running and can control this browser.";
  } else if (status.connecting) {
    pill.classList.add("idle");
    statusText.textContent = "Connecting…";
    desc.textContent = "Looking for CraftStation on this machine.";
  } else {
    pill.classList.add("err");
    statusText.textContent = "Disconnected";
    desc.textContent = "Waiting for CraftStation to start — connects automatically.";
  }
  version.textContent = status.version ? `Version ${status.version}` : "";
}

async function refresh() {
  try {
    render(await chrome.runtime.sendMessage({ cmd: "getStatus" }));
  } catch {
    /* worker asleep; it will report via the status event */
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.event === "status") render(message.status);
});

void refresh();
