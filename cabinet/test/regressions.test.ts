// Regression tests for bugs found in review.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, listen } from "../src/server/http";
import { JobRunner, silentLogger } from "../src/server/jobs";
import { parseBookmarksHtml } from "../src/server/importers";
import { extractPage } from "../src/server/enrich/html";
import { openTestCabinet, solidPng } from "./helpers";

type Ctx = Awaited<ReturnType<typeof openTestCabinet>>;

describe("http regressions", () => {
  let ctx: Ctx;
  let auth: Record<string, string>;
  beforeEach(async () => {
    ctx = await openTestCabinet({ startJobs: false });
    auth = { authorization: `Bearer ${ctx.config.get().token}` };
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("does not let percent-encoded paths skip authentication", async () => {
    const app = await createServer(ctx.cabinet, { webRoot: null });
    for (const url of ["/%61pi/info", "/%61%70%69/items", "/api/%69nfo"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
    const del = await app.inject({ method: "DELETE", url: "/%61pi/trash" });
    expect(del.statusCode).toBe(401);
    await app.close();
  });

  it("deletes tags that contain a percent sign", async () => {
    const app = await createServer(ctx.cabinet, { webRoot: null });
    const { id } = ctx.cabinet.addNote("sale", { tags: ["100%"] });
    const res = await app.inject({ method: "DELETE", url: `/api/tags/${encodeURIComponent("100%")}`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(ctx.lib.getItem(id)!.tags).toEqual([]);
    await app.close();
  });

  it("ignores non-numeric limit and seed", async () => {
    const app = await createServer(ctx.cabinet, { webRoot: null });
    ctx.cabinet.addNote("one");
    for (const q of ["limit=abc", "sort=random&seed=abc", "limit=-5", "cursor=xyz"]) {
      const res = await app.inject({ method: "GET", url: `/api/items?${q}`, headers: auth });
      expect(res.statusCode, q).toBe(200);
    }
    expect((await app.inject({ method: "GET", url: "/api/serendipity?limit=nope", headers: auth })).statusCode).toBe(200);
    await app.close();
  });

  it("never serves stored HTML as a page on the app's origin", async () => {
    const app = await createServer(ctx.cabinet, { webRoot: null });
    const { id } = await ctx.cabinet.addFile(Buffer.from("<html><script>alert(1)</script></html>"), { name: "evil.html", mime: "text/html" });
    const asset = ctx.lib.getItem(id)!.asset!;
    for (const url of [`/blobs/${asset}`, `/thumbs/${asset}`]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.headers["content-disposition"], url).toMatch(/^attachment/);
      expect(res.headers["content-security-policy"], url).toContain("sandbox");
    }
    // Images still display inline.
    const img = await ctx.cabinet.addFile(await solidPng("#123456"), { name: "a.png" });
    const res = await app.inject({ method: "GET", url: `/blobs/${ctx.lib.getItem(img.id)!.asset}` });
    expect(res.headers["content-disposition"]).toBeUndefined();
    await app.close();
  });

  it("shuts down while a live-update stream is open", async () => {
    const app = await createServer(ctx.cabinet, { webRoot: null });
    const port = await listen(app, 0);
    await new Promise<void>((resolve) => {
      http.get({ host: "127.0.0.1", port, path: "/api/events", headers: auth }, (res) => {
        res.once("data", () => resolve());
        res.on("error", () => {});
      });
    });
    const started = Date.now();
    await app.close();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("search regressions", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await openTestCabinet({ startJobs: false });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("negated types keep items that are not links", async () => {
    ctx.cabinet.addNote("a note");
    await ctx.cabinet.addFile(await solidPng("#ff0000"), { name: "red.png" });
    expect(ctx.lib.listItems({ q: "-type:article" }).total).toBe(2);
    expect(ctx.lib.listItems({ q: "-type:video" }).total).toBe(2);
    expect(ctx.lib.listItems({ q: "-type:note" }).total).toBe(1);
  });

  it("a search inside a smart collection stays inside it", async () => {
    ctx.cabinet.addNote("tomato note", { tags: ["garden"] });
    await ctx.cabinet.addFile(await solidPng("#3aa655"), { name: "leaf.png", tags: ["garden"] });
    ctx.cabinet.addNote("unrelated note");
    const smart = ctx.lib.createCollection({ name: "Garden", kind: "smart", query: "#garden" });
    expect(ctx.lib.listItems({ collectionId: smart.id }).total).toBe(2);
    expect(ctx.lib.listItems({ collectionId: smart.id, q: "type:note" }).total).toBe(1);
    expect(ctx.lib.listItems({ collectionId: smart.id, q: "unrelated" }).total).toBe(0);
    const images = ctx.lib.createCollection({ name: "Images", kind: "smart", query: "type:image" });
    expect(ctx.lib.listItems({ collectionId: images.id, q: "type:note" }).total).toBe(0);
    expect(ctx.lib.facets({ collectionId: images.id, q: "type:note" }).total).toBe(0);
  });
});

describe("parsing regressions", () => {
  it("survives invalid numeric entities", () => {
    const list = parseBookmarksHtml('<DL><DT><A HREF="https://a.example/">Bad &#99999999; &#x110000; title</A></DL>');
    expect(list[0].title).toBe("Bad � � title");
    const page = extractPage('<meta property="og:title" content="Caf&#99999999;">', "https://a.example/");
    expect(page.title).toBe("Caf�");
  });
});

describe("job runner regressions", () => {
  it("does not run the same job for the same item twice at once", async () => {
    const ctx = await openTestCabinet({ startJobs: false });
    let running = 0;
    let maxRunning = 0;
    let calls = 0;
    const runner = new JobRunner(
      ctx.lib.db,
      {
        slow: async () => {
          calls++;
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((r) => setTimeout(r, 150));
          running--;
        },
      },
      silentLogger,
    );
    runner.start();
    runner.enqueue("slow", "item-1");
    await new Promise((r) => setTimeout(r, 30));
    runner.enqueue("slow", "item-1");
    runner.enqueue("slow", "item-1");
    await runner.idle();
    expect(maxRunning).toBe(1);
    expect(calls).toBe(2); // the running one, plus one coalesced follow-up
    await runner.stop();
    await ctx.cleanup();
  });
});

describe("enrichment regressions", () => {
  let site: http.Server;
  let base = "";
  const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(6 * 1024 * 1024, 0x20)]);
  beforeEach(async () => {
    site = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end(big);
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((r) => site.close(() => r()));
  });

  it("saves the whole file when a link turns out to be a large file", async () => {
    const ctx = await openTestCabinet();
    const { id } = await ctx.cabinet.addUrl(`${base}/paper/2401.00001`);
    await ctx.cabinet.jobs.idle();
    const item = ctx.lib.getItem(id)!;
    expect(item.kind).toBe("pdf");
    expect(item.size).toBe(big.length);
    await ctx.cleanup();
  });
});
