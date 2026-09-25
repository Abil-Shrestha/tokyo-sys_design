import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { ConfigStore } from "../src/server/config";
import { Cabinet } from "../src/server/engine";
import { silentLogger } from "../src/server/jobs";

export const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures");

export async function tempDir(prefix = "cabinet-test-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function solidPng(color: string, width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

/** Two-tone image: left half one colour, right half another. */
export async function splitPng(left: string, right: string, width = 400, height = 300): Promise<Buffer> {
  const half = await sharp({ create: { width: width / 2, height, channels: 3, background: right } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: left } })
    .composite([{ input: half, left: width / 2, top: 0 }])
    .png()
    .toBuffer();
}

export interface FixtureServer {
  url: string;
  close(): Promise<void>;
  hits: string[];
}

/** Serves the HTML fixtures plus generated images on a random local port. */
export async function startFixtureServer(): Promise<FixtureServer> {
  const images: Record<string, Buffer> = {
    "/images/joinery.png": await splitPng("#8a5a36", "#e8d8b8", 800, 500),
    "/images/chair.png": await solidPng("#c9a43a", 600, 600),
    "/images/food.png": await solidPng("#3aa655", 640, 480),
    "/images/photo.jpg": await sharp({ create: { width: 500, height: 700, channels: 3, background: "#2f6fdb" } }).jpeg().toBuffer(),
    "/favicon.png": await solidPng("#e5322d", 32, 32),
  };
  const hits: string[] = [];
  let base = "";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    hits.push(url.pathname);
    if (images[url.pathname]) {
      res.writeHead(200, { "Content-Type": url.pathname.endsWith(".jpg") ? "image/jpeg" : "image/png" });
      res.end(images[url.pathname]);
      return;
    }
    const pages: Record<string, string> = {
      "/articles/joinery": "article.html",
      "/shop/chair": "product.html",
      "/recipes/miso": "recipe.html",
    };
    if (pages[url.pathname]) {
      const html = readFileSync(path.join(FIXTURES, pages[url.pathname]), "utf8").replaceAll("https://FIXTURE", base);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (url.pathname === "/slow") {
      setTimeout(() => res.end("late"), 60_000);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    hits,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export async function openTestCabinet(opts: { startJobs?: boolean } = {}) {
  const dir = await tempDir();
  const config = new ConfigStore(path.join(dir, "config"));
  const cabinet = await Cabinet.open({
    libraryPath: path.join(dir, "library"),
    config,
    logger: silentLogger,
    startJobs: opts.startJobs,
  });
  return {
    dir,
    config,
    cabinet,
    lib: cabinet.lib,
    async cleanup() {
      await cabinet.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
