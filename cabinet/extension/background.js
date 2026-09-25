import { call } from "./shared.js";

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "save-page", title: "Save page to Cabinet", contexts: ["page"] });
    chrome.contextMenus.create({ id: "save-link", title: "Save link to Cabinet", contexts: ["link"] });
    chrome.contextMenus.create({ id: "save-image", title: "Save image to Cabinet", contexts: ["image"] });
    chrome.contextMenus.create({ id: "save-video", title: "Save video to Cabinet", contexts: ["video"] });
    chrome.contextMenus.create({ id: "save-selection", title: "Save quote to Cabinet", contexts: ["selection"] });
  });
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

async function flash(tabId, ok, message) {
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#2e8b47" : "#d93a2b", tabId });
  chrome.action.setBadgeText({ text: ok ? "✓" : "!", tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }), 2500);
  // A small toast in the page itself (only where scripts may run).
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [message, ok],
      func: (text, success) => {
        const el = document.createElement("div");
        el.textContent = text;
        el.setAttribute(
          "style",
          `position:fixed;z-index:2147483647;right:20px;bottom:20px;padding:10px 16px;border-radius:12px;font:500 14px -apple-system,system-ui,sans-serif;color:#fff;background:${success ? "#1f1d1a" : "#d93a2b"};box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .3s,transform .3s;opacity:0;transform:translateY(8px)`,
        );
        document.documentElement.appendChild(el);
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = "none";
        });
        setTimeout(() => {
          el.style.opacity = "0";
          setTimeout(() => el.remove(), 300);
        }, 2200);
      },
    });
  } catch {
    // chrome:// pages and the web store don't allow scripts
  }
}

async function capture(tab) {
  try {
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 82 });
  } catch {
    return undefined;
  }
}

async function savePage(tab) {
  const snapshot = await capture(tab);
  return call("POST", "/api/items", { url: tab.url, title: tab.title, snapshot, source: "extension" });
}

async function selectionText(tabId, fallback) {
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => String(getSelection() || "") });
    return (result && result.result) || fallback;
  } catch {
    return fallback;
  }
}

async function handle(action, info, tab) {
  switch (action) {
    case "save-page":
      return savePage(tab);
    case "save-link":
      return call("POST", "/api/items", { url: info.linkUrl, source: "extension" });
    case "save-image":
      if (!info.srcUrl || info.srcUrl.startsWith("blob:")) return savePage(tab);
      return call("POST", "/api/items", { kind: "image", src: info.srcUrl, pageUrl: info.pageUrl, pageTitle: tab.title, source: "extension" });
    case "save-video":
      // Streaming sites play from blob: URLs; save the page instead.
      if (!info.srcUrl || info.srcUrl.startsWith("blob:")) return savePage(tab);
      return call("POST", "/api/items", { kind: "video", src: info.srcUrl, pageUrl: info.pageUrl, pageTitle: tab.title, source: "extension" });
    case "save-selection": {
      const text = await selectionText(tab.id, info.selectionText);
      return call("POST", "/api/items", { kind: "quote", body: text, pageUrl: info.pageUrl, pageTitle: tab.title, source: "extension" });
    }
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  try {
    const res = await handle(info.menuItemId, info, tab);
    await flash(tab.id, true, res.duplicate ? "Already in Cabinet" : "Saved to Cabinet");
  } catch (err) {
    await flash(tab.id, false, err.message);
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "save-page" || !tab) return;
  try {
    const res = await savePage(tab);
    await flash(tab.id, true, res.duplicate ? "Already in Cabinet" : "Saved to Cabinet");
  } catch (err) {
    await flash(tab.id, false, err.message);
  }
});

// ⌥-click on an image in a page (see content.js).
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "save-image") return false;
  call("POST", "/api/items", { kind: "image", src: message.src, pageUrl: message.pageUrl, pageTitle: message.pageTitle, source: "extension" })
    .then((res) => reply({ ok: true, duplicate: !!res.duplicate }))
    .catch((err) => reply({ ok: false, error: err.message }));
  return true;
});
