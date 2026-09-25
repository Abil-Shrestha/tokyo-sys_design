// Development: library server (auto-restarting) + Vite with hot reload.
//   npm run dev             open http://localhost:5173 in a browser
//   npm run dev:electron    same, inside the desktop shell
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const configDir = path.join(root, ".dev-config");
const configFile = path.join(configDir, "config.json");
const port = Number(process.env.CABINET_PORT ?? 47600);
const electron = process.argv.includes("--electron");

fs.mkdirSync(configDir, { recursive: true });
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configFile, "utf8"));
} catch {
  // first run
}
config = {
  deviceId: config.deviceId ?? randomBytes(6).toString("hex"),
  token: config.token ?? randomBytes(24).toString("base64url"),
  libraryPath: config.libraryPath ?? path.join(root, ".dev-library"),
  port,
  ...(config.aiKey ? { aiKey: config.aiKey } : {}),
};
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

const env = { ...process.env, CABINET_CONFIG_DIR: configDir, CABINET_WEB_ROOT: path.join(root, "dist", "web"), CABINET_PORT: String(port), VITE_CABINET_TOKEN: config.token };
const children = [];
const run = (cmd, args, extraEnv = {}) => {
  const child = spawn(cmd, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: "inherit", shell: process.platform === "win32" });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) shutdown(code);
  });
  return child;
};
const shutdown = (code = 0) => {
  for (const c of children) c.kill();
  process.exit(code);
};
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

if (electron) {
  // The desktop shell runs its own copy of the server; the window loads Vite.
  run("node", ["scripts/build-node.mjs"]).on("exit", (code) => {
    if (code) return;
    run("npx", ["vite"]);
    setTimeout(() => run("npx", ["electron", "."], { CABINET_DEV_URL: "http://localhost:5173/" }), 1500);
  });
} else {
  run("npx", ["tsx", "watch", "--clear-screen=false", "src/server/cli.ts", "--port", String(port)]);
  run("npx", ["vite"]);
  console.log(`\n  Cabinet dev: http://localhost:5173  (library: ${config.libraryPath})\n`);
}
