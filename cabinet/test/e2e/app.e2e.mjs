// End-to-end check of the desktop app: launches the built Electron app on a
// throwaway library and goes through the main things a person does.
//
//   npm run build && npm run test:e2e
//
// Needs a display (on Linux CI, run it under xvfb-run).

import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cabinet-e2e-"));
const port = 47700 + Math.floor(Math.random() * 200);
fs.mkdirSync(path.join(tmp, "config"));
fs.writeFileSync(
  path.join(tmp, "config", "config.json"),
  JSON.stringify({ deviceId: "e2e000000001", token: "e2e-token-0123456789abcdef", libraryPath: path.join(tmp, "library"), port }),
);

// A tiny local website to save links from.
const site = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><html lang="en"><head><title>Linen, washed</title>
    <meta property="og:title" content="How to care for linen">
    <meta property="og:site_name" content="Home Notes">
    <meta name="description" content="Wash cool, dry flat, never iron it bone dry."></head>
    <body><article><h1>How to care for linen</h1>${"<p>Linen softens with every wash. Use cool water and a gentle cycle, then dry it flat in the shade so the fibres relax.</p>".repeat(8)}</article></body></html>`);
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const siteUrl = `http://127.0.0.1:${site.address().port}/linen`;

let failures = 0;
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    results.push(`  ✗ ${name}\n      ${String(err.message).split("\n")[0]}`);
  }
}

const executablePath = path.join(root, "node_modules", "electron", "dist", process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : process.platform === "win32" ? "electron.exe" : "electron");
const app = await electron.launch({
  executablePath,
  args: [root, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
  cwd: root,
  env: { ...process.env, CABINET_CONFIG_DIR: path.join(tmp, "config") },
});
const win = await app.firstWindow();
const pageErrors = [];
win.on("pageerror", (e) => pageErrors.push(e.message));
const api = (p, init) =>
  win.evaluate(
    async ([p, init]) => {
      const r = await fetch(p, { ...init, headers: { "X-Cabinet-Client": "web", "Content-Type": "application/json", ...(init?.headers ?? {}) } });
      return r.json();
    },
    [p, init],
  );

await step("app window opens on an empty library", async () => {
  await win.waitForSelector(".composer", { timeout: 30_000 });
  await win.waitForSelector(".empty.welcome");
});

await step("write a note in the composer", async () => {
  await win.locator(".composer textarea").fill("Buy a linen duvet cover, stonewashed");
  await win.locator(".composer textarea").press("Control+Enter");
  await win.waitForSelector(".card--note:has-text('linen duvet')");
});

await step("save a link and fetch its details", async () => {
  await win.locator(".composer textarea").fill(siteUrl);
  await win.locator(".composer textarea").press("Control+Enter");
  await win.waitForSelector(".card:has-text('How to care for linen')", { timeout: 20_000 });
});

await step("upload an image and extract its colours", async () => {
  const png = path.join(tmp, "orange.png");
  const b64 = await win.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 400;
    const g = c.getContext("2d");
    g.fillStyle = "#f28c28";
    g.fillRect(0, 0, 600, 400);
    return c.toDataURL("image/png").split(",")[1];
  });
  fs.writeFileSync(png, Buffer.from(b64, "base64"));
  const [chooser] = await Promise.all([win.waitForEvent("filechooser"), win.locator(".composer [aria-label='Upload files']").click()]);
  await chooser.setFiles(png);
  await win.waitForSelector(".card--image");
  const r = await api("/api/items?q=color:orange");
  if (r.total !== 1) throw new Error(`colour search found ${r.total}`);
});

await step("search finds text inside a saved article", async () => {
  await win.locator(".search-input").fill("fibres");
  await win.waitForFunction(() => document.querySelectorAll(".card").length === 1, null, { timeout: 5000 });
  await win.locator(".search-input").fill("");
  await win.waitForFunction(() => document.querySelectorAll(".card").length === 3, null, { timeout: 5000 });
});

await step("open an item, tag it and write a note", async () => {
  await win.locator(".card--note").first().click();
  await win.waitForSelector(".panel");
  await win.locator(".tag-input").fill("home");
  await win.locator(".tag-input").press("Enter");
  await win.locator(".panel-note").fill("For the guest room");
  await win.waitForTimeout(900);
  await win.keyboard.press("Escape");
  await win.locator(".panel-note").evaluate((el) => el.blur());
  await win.keyboard.press("Escape");
  await win.waitForSelector(".viewer", { state: "detached" });
  const r = await api("/api/items?q=%23home");
  if (r.total !== 1) throw new Error("tag not saved");
  const item = await api(`/api/items/${r.items[0].id}`);
  if (item.note !== "For the guest room") throw new Error(`note is ${JSON.stringify(item.note)}`);
});

await step("create a collection and add a card by dragging", async () => {
  const col = await api("/api/collections", { method: "POST", body: JSON.stringify({ name: "Bedroom" }) });
  await win.waitForSelector(".nav-row:has-text('Bedroom')");
  await win.locator(".card--image").first().dragTo(win.locator(".nav-row", { hasText: "Bedroom" }));
  await win.waitForFunction(async (id) => (await (await fetch(`/api/items?collection=${id}`)).json()).total === 1, col.id, { timeout: 5000 });
});

await step("trash an item and undo", async () => {
  await win.locator(".card--note").first().click({ button: "right" });
  await win.locator(".menu-item", { hasText: "Move to trash" }).click();
  await win.waitForSelector(".toast-action:has-text('Undo')");
  await win.locator(".toast-action", { hasText: "Undo" }).click();
  await win.waitForSelector(".card--note");
});

await step("settings and command palette open", async () => {
  await win.keyboard.press("Control+,");
  await win.waitForSelector(".modal.settings");
  await win.keyboard.press("Escape");
  await win.keyboard.press("Control+k");
  await win.waitForSelector(".palette");
  await win.keyboard.press("Escape");
});

await step("no errors in the page", async () => {
  if (pageErrors.length) throw new Error(pageErrors.join("; "));
});

await app.close();
site.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Cabinet end-to-end\n${results.join("\n")}\n${failures ? `${failures} failed` : "all passed"}`);
process.exit(failures ? 1 : 0);
