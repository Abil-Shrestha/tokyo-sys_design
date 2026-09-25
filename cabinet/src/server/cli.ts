#!/usr/bin/env node
// Runs Cabinet's library server without the desktop shell:
//   npm run serve -- [--library <path>] [--port <n>] [--open]
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigStore } from "./config";
import { Cabinet } from "./engine";
import { createServer, listen } from "./http";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const config = new ConfigStore(arg("config") ?? undefined);
  const libraryArg = arg("library");
  if (libraryArg) config.update({ libraryPath: path.resolve(libraryArg) });
  const { libraryPath, port } = config.get();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webRoot = process.env.CABINET_WEB_ROOT ?? path.resolve(here, "../web");

  const cabinet = await Cabinet.open({ libraryPath, config });
  const app = await createServer(cabinet, { webRoot, version: process.env.npm_package_version });
  const bound = await listen(app, Number(arg("port") ?? port));
  const url = `http://127.0.0.1:${bound}/`;
  console.log(`Cabinet is running at ${url}`);
  console.log(`Library: ${libraryPath}`);
  console.log(`Extension token: ${config.get().token}`);

  if (process.argv.includes("--open")) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    execFile(cmd, [url], () => {});
  }

  const shutdown = async () => {
    await app.close();
    await cabinet.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
