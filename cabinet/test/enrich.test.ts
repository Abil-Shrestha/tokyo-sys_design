import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { extractPage } from "../src/server/enrich/html";
import { cleanUrl } from "../src/server/enrich/fetch";
import { FIXTURES, openTestCabinet, startFixtureServer, type FixtureServer } from "./helpers";

describe("extractPage", () => {
  it("reads an article", () => {
    const html = readFileSync(path.join(FIXTURES, "article.html"), "utf8");
    const page = extractPage(html, "https://example.com/articles/joinery?utm_source=x");
    expect(page.title).toBe("The Quiet Craft of Japanese Joinery");
    expect(page.siteName).toBe("Woodworking Weekly");
    expect(page.author).toBe("Aiko Tanaka");
    expect(page.linkType).toBe("article");
    expect(page.image).toBe("https://example.com/images/joinery.png");
    expect(page.favicon).toBe("https://example.com/favicon.png");
    expect(page.canonical).toBe("https://example.com/articles/joinery");
    expect(page.keywords).toEqual(["Woodworking", "Japan"]);
    expect(page.article?.text).toContain("hinoki cypress");
    expect(page.article?.html).toContain('src="https://example.com/images/joinery.png"');
    expect(page.meta.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  it("reads a product from JSON-LD", () => {
    const html = readFileSync(path.join(FIXTURES, "product.html"), "utf8");
    const page = extractPage(html, "https://shop.example/chair");
    expect(page.linkType).toBe("product");
    expect(page.meta.price).toBe(1249);
    expect(page.meta.currency).toBe("EUR");
    expect(page.meta.brand).toBe("Studio Nord");
    expect(page.meta.availability).toBe("InStock");
    expect(page.meta.rating).toBe(4.8);
  });

  it("reads a recipe from JSON-LD", () => {
    const html = readFileSync(path.join(FIXTURES, "recipe.html"), "utf8");
    const page = extractPage(html, "https://food.example/miso");
    expect(page.linkType).toBe("recipe");
    expect(page.meta.totalTime).toBe("25 min");
    expect(page.meta.ingredients).toHaveLength(4);
    expect(page.image).toBe("https://food.example/images/food.png");
    expect(page.keywords).toEqual(expect.arrayContaining(["Side dish", "Japanese", "umami", "quick"]));
  });

  it("classifies well-known sites by URL", () => {
    expect(extractPage("<title>x</title>", "https://www.youtube.com/watch?v=abc").linkType).toBe("video");
    expect(extractPage("<title>x</title>", "https://github.com/owner/repo").linkType).toBe("repository");
    expect(extractPage("<title>x</title>", "https://github.com/owner").linkType).toBe("website");
  });

  it("removes tracking parameters", () => {
    expect(cleanUrl("https://a.com/x?utm_source=tw&id=3&fbclid=9#top")).toBe("https://a.com/x?id=3#top");
  });
});

describe("saving links", () => {
  let server: FixtureServer;
  let ctx: Awaited<ReturnType<typeof openTestCabinet>>;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(async () => {
    ctx = await openTestCabinet();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("fetches metadata, a local preview, favicon and auto tags", async () => {
    const { id } = await ctx.cabinet.addUrl(`${server.url}/articles/joinery?utm_medium=email`, { title: "Captured title" });
    expect(ctx.lib.getItem(id)!.status).toBe("pending");
    await ctx.cabinet.jobs.idle();
    const item = ctx.lib.getItem(id)!;
    expect(item.status).toBe("ready");
    expect(item.url).toBe(`${server.url}/articles/joinery`);
    expect(item.title).toBe("The Quiet Craft of Japanese Joinery");
    expect(item.linkType).toBe("article");
    expect(item.preview).toMatch(/^[0-9a-f]{64}$/);
    expect(item.favicon).toMatch(/^[0-9a-f]{64}$/);
    expect(item.width).toBe(800);
    expect(item.contentHtml).toContain("sashimono");
    expect(item.tags.map((t) => [t.name, t.source])).toEqual([
      ["woodworking", "auto"],
      ["japan", "auto"],
    ]);
    // The article body is searchable.
    expect(ctx.lib.listItems({ q: "hinoki" }).items.map((i) => i.id)).toEqual([id]);
    expect(ctx.lib.listItems({ q: "type:article" }).total).toBe(1);
    expect(ctx.lib.listItems({ q: "color:brown" }).total).toBe(1);
  });

  it("recognises a duplicate link", async () => {
    const first = await ctx.cabinet.addUrl(`${server.url}/shop/chair`);
    const again = await ctx.cabinet.addUrl(`${server.url}/shop/chair?utm_source=x`, { tags: ["wishlist"] });
    expect(again).toEqual({ id: first.id, duplicate: true });
    await ctx.cabinet.jobs.idle();
    const item = ctx.lib.getItem(first.id)!;
    expect(item.linkType).toBe("product");
    expect(item.meta.price).toBe(1249);
    expect(item.tags.map((t) => t.name)).toContain("wishlist");
    expect(ctx.lib.listItems({ q: "products" }).total).toBe(1);
  });

  it("downloads direct image links as images", async () => {
    const { id } = await ctx.cabinet.addUrl(`${server.url}/images/photo.jpg`);
    const item = ctx.lib.getItem(id)!;
    expect(item.kind).toBe("image");
    expect(item.width).toBe(500);
    expect(item.height).toBe(700);
    expect(ctx.lib.listItems({ q: "color:blue" }).total).toBe(1);
  });

  it("keeps a failed link with an error and retries on refresh", async () => {
    const { id } = await ctx.cabinet.addUrl(`${server.url}/missing-page`, { title: "Missing" });
    await ctx.cabinet.jobs.idle();
    const item = ctx.lib.getItem(id)!;
    expect(item.status).toBe("failed");
    expect(item.error).toContain("404");
    expect(item.title).toBe("Missing");
    ctx.cabinet.refresh(id);
    expect(ctx.lib.getItem(id)!.status).toBe("pending");
    await ctx.cabinet.jobs.idle();
    expect(ctx.lib.getItem(id)!.status).toBe("failed");
  });

  it("saves images from a page with the page as source", async () => {
    const { id } = await ctx.cabinet.addRemoteFile(`${server.url}/images/chair.png`, { pageUrl: `${server.url}/shop/chair` });
    const item = ctx.lib.getItem(id)!;
    expect(item.kind).toBe("image");
    expect(item.url).toBe(`${server.url}/shop/chair`);
    expect(item.meta.sourceUrl).toBe(`${server.url}/images/chair.png`);
  });

  it("stores a snapshot sent along with a link", async () => {
    const { solidPng } = await import("./helpers");
    const { id } = await ctx.cabinet.addUrl(`${server.url}/recipes/miso`, { snapshot: await solidPng("#f06ea9", 1280, 800) });
    const before = ctx.lib.getItem(id)!;
    expect(before.preview).toBeTruthy();
    expect(before.meta.snapshot).toBe(true);
    await ctx.cabinet.jobs.idle();
    const after = ctx.lib.getItem(id)!;
    expect(after.linkType).toBe("recipe");
    // The page's own image replaces the snapshot.
    expect(after.preview).not.toBe(before.preview);
  });
});
