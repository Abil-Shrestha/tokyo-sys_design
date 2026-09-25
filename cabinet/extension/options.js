import { DEFAULT_SERVER, call, getSettings } from "./shared.js";

const $ = (id) => document.getElementById(id);

async function detect() {
  const s = await getSettings();
  $("server").value = s.server;
  $("token").value = s.token;
  if (!s.token) {
    try {
      const res = await fetch(`${s.server}/api/ping`);
      if (res.ok) $("result").textContent = "Cabinet is running. Paste the key to connect.";
    } catch {
      $("result").textContent = "Cabinet doesn't seem to be running at this address.";
    }
  }
}

$("save").addEventListener("click", async () => {
  const server = ($("server").value.trim() || DEFAULT_SERVER).replace(/\/+$/, "");
  await chrome.storage.local.set({ server, token: $("token").value.trim() });
  $("result").textContent = "Testing…";
  try {
    const info = await call("GET", "/api/info");
    $("result").textContent = `Connected to your library (${info.itemCount.toLocaleString()} items). You're all set.`;
    $("result").style.color = "#2e8b47";
  } catch (err) {
    $("result").textContent = err.message;
    $("result").style.color = "#d93a2b";
  }
});

detect();
