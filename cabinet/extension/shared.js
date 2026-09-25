// Talking to the Cabinet app running on this computer.

export const DEFAULT_SERVER = "http://127.0.0.1:47600";

export async function getSettings() {
  const s = await chrome.storage.local.get(["server", "token"]);
  return { server: (s.server || DEFAULT_SERVER).replace(/\/+$/, ""), token: s.token || "" };
}

export class CabinetError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function call(method, path, body) {
  const { server, token } = await getSettings();
  if (!token) throw new CabinetError("Connect the extension to Cabinet first (open its options).", 401);
  let res;
  try {
    res = await fetch(server + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CabinetError("Cabinet isn't running. Open the app and try again.", 0);
  }
  if (!res.ok) {
    let message = `Cabinet answered with ${res.status}`;
    try {
      message = (await res.json()).error || message;
    } catch {}
    if (res.status === 401) message = "The extension key is wrong. Copy it again from Cabinet → Settings → Browser extension.";
    throw new CabinetError(message, res.status);
  }
  return res.json();
}

export function itemUrl(server, id) {
  return `${server}/#/item/${id}`;
}
