import { call, getSettings, itemUrl } from "./shared.js";

const $ = (id) => document.getElementById(id);
const show = (id) => ["saved", "setup", "error"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
const status = (text, cls = "") => {
  $("status").textContent = text;
  $("status").className = `status ${cls}`;
};

let itemId = null;
let saveTimer = null;

async function persist() {
  if (!itemId) return;
  const tags = $("tags").value.split(",").map((t) => t.trim()).filter(Boolean);
  try {
    await call("PATCH", `/api/items/${itemId}`, { note: $("note").value, tags });
    status("Saved", "ok");
  } catch (err) {
    status(err.message, "err");
  }
}

function schedule() {
  status("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
}

async function run() {
  const settings = await getSettings();
  if (!settings.token) {
    $("server").value = settings.server;
    status("Not connected", "err");
    show("setup");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) {
    status("");
    $("error-text").textContent = "This page can't be saved. Try a regular web page.";
    show("error");
    return;
  }
  status("Saving…");
  let snapshot;
  try {
    snapshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
  } catch {
    snapshot = undefined;
  }
  try {
    const res = await call("POST", "/api/items", { url: tab.url, title: tab.title, snapshot, source: "extension" });
    itemId = res.id;
    const item = res.item;
    status(res.duplicate ? "Already saved" : "Saved", "ok");
    $("title").textContent = item.title || tab.title || tab.url;
    $("domain").textContent = item.domain || new URL(tab.url).hostname;
    if (snapshot) $("thumb").src = snapshot;
    else if (tab.favIconUrl) $("thumb").src = tab.favIconUrl;
    $("tags").value = (item.tags || []).filter((t) => t.source === "user").map((t) => t.name).join(", ");
    $("note").value = item.note || "";
    $("open").href = itemUrl(settings.server, itemId);
    show("saved");
    $("note").focus();
  } catch (err) {
    status("");
    $("error-text").textContent = err.message;
    show("error");
  }
}

$("tags").addEventListener("input", schedule);
$("note").addEventListener("input", schedule);
$("done").addEventListener("click", async () => {
  clearTimeout(saveTimer);
  await persist();
  window.close();
});
$("retry").addEventListener("click", run);
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("connect").addEventListener("click", async () => {
  await chrome.storage.local.set({ server: $("server").value.trim() || undefined, token: $("token").value.trim() });
  run();
});

run();
