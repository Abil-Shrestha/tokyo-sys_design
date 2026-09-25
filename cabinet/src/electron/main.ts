// Cabinet desktop shell: runs the library server in-process and shows it in a
// native window, with a menu bar icon you can drop things on and a global
// shortcut that saves whatever is on the clipboard.

import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, session, shell, Tray } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { ConfigStore } from "../server/config";
import { Cabinet } from "../server/engine";
import { isHttpUrl } from "../server/enrich/fetch";
import { createServer, listen } from "../server/http";

const here = path.dirname(fileURLToPath(import.meta.url));
const isMac = process.platform === "darwin";
const SHORTCUT = "CommandOrControl+Alt+S";

let cabinet: Cabinet | null = null;
let server: FastifyInstance | null = null;
let baseUrl = "";
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setName("Cabinet");

function assetPath(...parts: string[]): string {
  const packaged = path.join(process.resourcesPath ?? "", ...parts);
  if (app.isPackaged && existsSync(packaged)) return packaged;
  return path.join(here, "..", "..", "build", ...parts);
}

// ---------------------------------------------------------------------------
// Page snapshots for links without a preview image

let snapshotQueue: Promise<unknown> = Promise.resolve();

function snapshot(url: string): Promise<Buffer | null> {
  const run = async (): Promise<Buffer | null> => {
    if (!isHttpUrl(url)) return null;
    const shot = new BrowserWindow({
      show: false,
      width: 1280,
      height: 960,
      webPreferences: { offscreen: true, partition: "persist:snapshots", sandbox: true, javascript: true },
    });
    shot.webContents.setAudioMuted(true);
    shot.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    try {
      await Promise.race([
        shot.loadURL(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error("snapshot timed out")), 20_000)),
      ]);
      await new Promise((r) => setTimeout(r, 1500));
      const image = await shot.webContents.capturePage();
      if (image.isEmpty()) return null;
      return image.resize({ width: 1280 }).toPNG();
    } catch {
      return null;
    } finally {
      shot.destroy();
    }
  };
  const next = snapshotQueue.then(run, run);
  snapshotQueue = next.catch(() => null);
  return next;
}

// ---------------------------------------------------------------------------
// Saving from outside the window

function notify(title: string, body?: string): void {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

async function saveClipboard(): Promise<void> {
  if (!cabinet) return;
  try {
    // Electron's clipboard follows the async web Clipboard API.
    const items = await clipboard.read();
    const get = async (match: (type: string) => boolean): Promise<{ type: string; blob: Blob } | null> => {
      for (const item of items) {
        const type = item.types.find(match);
        if (type) return { type, blob: (await item.getType(type)) as Blob };
      }
      return null;
    };
    const uriList = await get((t) => t === "text/uri-list");
    const fileUrls = uriList
      ? (await uriList.blob.text())
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith("file://"))
      : [];
    if (fileUrls.length) {
      await saveDroppedFiles(fileUrls.map((u) => fileURLToPath(u)));
      return;
    }
    const image = await get((t) => t.startsWith("image/"));
    if (image) {
      const data = Buffer.from(await image.blob.arrayBuffer());
      await cabinet.addFile(data, { name: `clipboard.${image.type.split("/")[1]?.replace("svg+xml", "svg") ?? "png"}`, mime: image.type, source: "clipboard" });
      notify("Saved to Cabinet", "Image from the clipboard");
      return;
    }
    const text = (await clipboard.readText()).trim();
    if (text && isHttpUrl(text)) {
      const r = await cabinet.addUrl(text, { source: "clipboard" });
      notify(r.duplicate ? "Already in Cabinet" : "Saved to Cabinet", text);
    } else if (text) {
      cabinet.addNote(text, { source: "clipboard" });
      notify("Saved to Cabinet", text.slice(0, 80));
    } else {
      notify("Nothing to save", "The clipboard is empty.");
    }
  } catch (err) {
    notify("Couldn't save", (err as Error).message);
  }
}

async function saveDroppedFiles(files: string[]): Promise<void> {
  if (!cabinet) return;
  const fs = await import("node:fs");
  let n = 0;
  for (const file of files) {
    try {
      if (fs.statSync(file).isFile()) {
        await cabinet.addFile(fs.createReadStream(file), { name: path.basename(file), source: "tray" });
        n++;
      }
    } catch {
      // skip unreadable files
    }
  }
  if (n) notify("Saved to Cabinet", n === 1 ? path.basename(files[0]) : `${n} files`);
}

async function saveDroppedText(text: string): Promise<void> {
  if (!cabinet || !text.trim()) return;
  const value = text.trim();
  if (isHttpUrl(value)) await cabinet.addUrl(value, { source: "tray" });
  else cabinet.addNote(value, { source: "tray" });
  notify("Saved to Cabinet", value.slice(0, 80));
}

// ---------------------------------------------------------------------------
// Window

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "Cabinet",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121110" : "#f3f1ec",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 20, y: 18 } : undefined,
    autoHideMenuBar: !isMac,
    icon: isMac ? undefined : assetPath("icon.png"),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      plugins: true,
      spellcheck: true,
      additionalArguments: [`--cabinet-version=${app.getVersion()}`],
    },
  });
  w.once("ready-to-show", () => w.show());
  void w.loadURL(baseUrl);

  // Links open in the default browser; the window only ever shows Cabinet.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url) && !url.startsWith(baseUrl)) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(baseUrl)) return;
    e.preventDefault();
    if (isHttpUrl(url)) void shell.openExternal(url);
  });
  w.on("close", (e) => {
    if (isMac && !quitting) {
      e.preventDefault();
      w.hide();
    }
  });
  w.on("closed", () => {
    if (win === w) win = null;
  });
  return w;
}

function showWindow(): void {
  if (!win) win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function sendCommand(command: string): void {
  showWindow();
  win?.webContents.send("cabinet:command", command);
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: "Cabinet",
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => sendCommand("settings") },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "New Note", accelerator: "CmdOrCtrl+N", click: () => sendCommand("new-note") },
        { label: "Add Files…", accelerator: "CmdOrCtrl+O", click: () => sendCommand("upload") },
        { label: "Save Clipboard", accelerator: SHORTCUT, click: () => void saveClipboard() },
        { type: "separator" },
        { label: "Import Bookmarks…", click: () => sendCommand("import") },
        { label: "Show Library in Folder", click: () => cabinet && shell.openPath(cabinet.lib.path) },
        ...(isMac ? [] : [{ type: "separator" as const }, { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => sendCommand("settings") }, { role: "quit" as const }]),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Search…", accelerator: "CmdOrCtrl+K", click: () => sendCommand("palette") },
        { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+\\", click: () => sendCommand("sidebar") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray(): void {
  const iconFile = assetPath(isMac ? "trayTemplate.png" : "tray.png");
  if (!existsSync(iconFile)) return;
  const image = nativeImage.createFromPath(iconFile);
  if (isMac) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Cabinet — drop things here to save them");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Cabinet", click: showWindow },
      { label: "Save Clipboard", accelerator: SHORTCUT, click: () => void saveClipboard() },
      { type: "separator" },
      { label: "Quit Cabinet", role: "quit" },
    ]),
  );
  tray.on("drop-files", (_e, files) => void saveDroppedFiles(files));
  tray.on("drop-text", (_e, text) => void saveDroppedText(text));
}

// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  const config = new ConfigStore(app.getPath("userData"));
  let { libraryPath } = config.get();

  try {
    cabinet = await Cabinet.open({
      libraryPath,
      config,
      fetch: (input, init) => net.fetch(input, init as RequestInit),
      snapshot,
    });
  } catch (err) {
    const choice = dialog.showMessageBoxSync({
      type: "error",
      message: "Cabinet couldn't open its library",
      detail: `${libraryPath}\n\n${(err as Error).message}`,
      buttons: ["Choose Another Folder…", "Quit"],
    });
    if (choice === 0) {
      const picked = dialog.showOpenDialogSync({ properties: ["openDirectory", "createDirectory"] });
      if (picked?.[0]) {
        config.update({ libraryPath: picked[0] });
        app.relaunch();
      }
    }
    app.exit(1);
    return;
  }
  libraryPath = cabinet.lib.path;

  server = await createServer(cabinet, {
    webRoot: path.join(here, "..", "web"),
    version: app.getVersion(),
    desktop: true,
    reveal: (p) => shell.showItemInFolder(p),
  });
  const port = await listen(server, config.get().port);
  baseUrl = `http://127.0.0.1:${port}/`;

  // Snapshots should look like a normal browser visit.
  session.fromPartition("persist:snapshots").setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  );

  ipcMain.handle("cabinet:choose-library", async () => {
    const picked = await dialog.showOpenDialog({
      title: "Choose a folder for your Cabinet library",
      buttonLabel: "Use This Folder",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: libraryPath,
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    config.update({ libraryPath: picked.filePaths[0] });
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 300);
    return picked.filePaths[0];
  });

  buildMenu();
  createTray();
  if (!globalShortcut.register(SHORTCUT, () => void saveClipboard())) {
    console.warn(`[cabinet] could not register ${SHORTCUT}`);
  }
  win = createWindow();
}

app.on("second-instance", showWindow);
app.on("activate", showWindow);
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", (e) => {
  globalShortcut.unregisterAll();
  if (server || cabinet) {
    e.preventDefault();
    const s = server;
    const c = cabinet;
    server = null;
    cabinet = null;
    void (async () => {
      await s?.close().catch(() => {});
      await c?.close().catch(() => {});
      app.quit();
    })();
  }
});
app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

app.whenReady().then(start, (err) => {
  console.error(err);
  app.exit(1);
});
