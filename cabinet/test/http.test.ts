import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server/http";
import { FIXTURES, openTestCabinet, solidPng } from "./helpers";

type Ctx = Awaited<ReturnType<typeof openTestCabinet>>;

function multipartBody(files: { field: string; name: string; type: string; data: Buffer }[], fields: Record<string, string> = {}) {
  const boundary = "----cabinettest" + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    chunks.push(f.data);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("http api", () => {
  let ctx: Ctx;
  let app: FastifyInstance;
  let auth: Record<string, string>;

  beforeEach(async () => {
    ctx = await openTestCabinet({ startJobs: false });
    app = await createServer(ctx.cabinet, { webRoot: null });
    auth = { authorization: `Bearer ${ctx.config.get().token}` };
  });
  afterEach(async () => {
    await app.close();
    await ctx.cleanup();
  });

  it("rejects requests without a token and from foreign hosts", async () => {
    expect((await app.inject({ method: "GET", url: "/api/items" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/items", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    const rebinding = await app.inject({ method: "GET", url: "/api/items", headers: { ...auth, host: "evil.example:47600" } });
    expect(rebinding.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/items", headers: auth })).statusCode).toBe(200);
  });

  it("accepts the session cookie, but writes need the client header", async () => {
    const cookie = `cabinet_session=${encodeURIComponent(ctx.config.get().token)}`;
    expect((await app.inject({ method: "GET", url: "/api/items", headers: { cookie } })).statusCode).toBe(200);
    const forged = await app.inject({ method: "POST", url: "/api/items", headers: { cookie }, payload: { kind: "note", body: "x" } });
    expect(forged.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/items", headers: { cookie, "x-cabinet-client": "web" }, payload: { kind: "note", body: "x" } });
    expect(ok.statusCode).toBe(200);
  });

  it("answers CORS preflights from browser extensions only", async () => {
    const pre = await app.inject({
      method: "OPTIONS",
      url: "/api/items",
      headers: { origin: "chrome-extension://abcdef", "access-control-request-method": "POST" },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdef");
    const site = await app.inject({ method: "GET", url: "/api/items", headers: { ...auth, origin: "https://evil.example" } });
    expect(site.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("creates, edits, lists, tags and trashes items", async () => {
    const created = await app.inject({ method: "POST", url: "/api/items", headers: auth, payload: { kind: "note", body: "Hello **world**", tags: ["Greeting"] } });
    expect(created.statusCode).toBe(200);
    const { id, item } = created.json();
    expect(item.tags).toEqual([{ name: "greeting", source: "user" }]);

    const quote = await app.inject({
      method: "POST",
      url: "/api/items",
      headers: auth,
      payload: { kind: "quote", body: "Less, but better.", pageUrl: "https://example.com/rams", pageTitle: "Dieter Rams" },
    });
    expect(quote.json().item.domain).toBe("example.com");

    const patched = await app.inject({ method: "PATCH", url: `/api/items/${id}`, headers: auth, payload: { note: "said hi", pinned: true } });
    expect(patched.json().pinned).toBe(true);

    const list = await app.inject({ method: "GET", url: "/api/items?q=hello", headers: auth });
    expect(list.json().total).toBe(1);

    const facets = await app.inject({ method: "GET", url: "/api/facets", headers: auth });
    expect(facets.json().kinds).toEqual({ note: 1, quote: 1 });

    const bulk = await app.inject({ method: "POST", url: "/api/items/bulk", headers: auth, payload: { action: "trash", ids: [id] } });
    expect(bulk.json().count).toBe(1);
    const trash = await app.inject({ method: "GET", url: "/api/items?trash=1", headers: auth });
    expect(trash.json().items[0].id).toBe(id);
    const emptied = await app.inject({ method: "DELETE", url: "/api/trash", headers: auth });
    expect(emptied.json().count).toBe(1);
  });

  it("uploads files and serves originals and thumbnails", async () => {
    const png = await solidPng("#3aa655", 1200, 800);
    const { body, contentType } = multipartBody([{ field: "file", name: "green.png", type: "image/png", data: png }], { tags: "nature,green" });
    const res = await app.inject({ method: "POST", url: "/api/upload", headers: { ...auth, "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(200);
    const [id] = res.json().ids;
    const item = (await app.inject({ method: "GET", url: `/api/items/${id}`, headers: auth })).json();
    expect(item.kind).toBe("image");
    expect(item.tags.map((t: { name: string }) => t.name)).toEqual(["nature", "green"]);

    const original = await app.inject({ method: "GET", url: `/blobs/${item.asset}` });
    expect(original.statusCode).toBe(200);
    expect(original.headers["content-type"]).toContain("image/png");
    expect(original.rawPayload.equals(png)).toBe(true);

    const ranged = await app.inject({ method: "GET", url: `/blobs/${item.asset}`, headers: { range: "bytes=0-9" } });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.rawPayload.length).toBe(10);

    const thumb = await app.inject({ method: "GET", url: `/thumbs/${item.asset}?w=300` });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers["content-type"]).toBe("image/webp");
    expect(thumb.rawPayload.length).toBeLessThan(png.length);

    expect((await app.inject({ method: "GET", url: `/blobs/${"0".repeat(64)}` })).statusCode).toBe(404);
  });

  it("accepts poster frames for videos", async () => {
    const fakeVideo = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64)]);
    const { body, contentType } = multipartBody([{ field: "file", name: "clip.mp4", type: "video/mp4", data: fakeVideo }]);
    const [id] = (await app.inject({ method: "POST", url: "/api/upload", headers: { ...auth, "content-type": contentType }, payload: body })).json().ids;
    const poster = await solidPng("#8a4fd1", 640, 360);
    const res = await app.inject({ method: "POST", url: `/api/items/${id}/preview`, headers: { ...auth, "content-type": "image/png" }, payload: poster });
    expect(res.statusCode).toBe(200);
    const item = (await app.inject({ method: "GET", url: `/api/items/${id}`, headers: auth })).json();
    expect(item.kind).toBe("video");
    expect(item.preview).toBeTruthy();
    expect(item.width).toBe(640);
  });

  it("imports a browser bookmarks file", async () => {
    const html = readFileSync(path.join(FIXTURES, "bookmarks.html"));
    const { body, contentType } = multipartBody([{ field: "file", name: "bookmarks.html", type: "text/html", data: html }]);
    const res = await app.inject({ method: "POST", url: "/api/import/bookmarks", headers: { ...auth, "content-type": contentType }, payload: body });
    expect(res.json()).toEqual({ imported: 4, skipped: 0 });
    const tagged = (await app.inject({ method: "GET", url: "/api/items?q=%23design", headers: auth })).json();
    expect(tagged.total).toBe(2);
    const again = await app.inject({ method: "POST", url: "/api/import/bookmarks", headers: { ...auth, "content-type": contentType }, payload: body });
    expect(again.json()).toEqual({ imported: 0, skipped: 4 });
  });

  it("manages collections and canvas positions", async () => {
    const note = (await app.inject({ method: "POST", url: "/api/items", headers: auth, payload: { body: "idea" } })).json().id;
    const c = (await app.inject({ method: "POST", url: "/api/collections", headers: auth, payload: { name: "Ideas", itemIds: [note] } })).json();
    expect(c.count).toBe(1);
    await app.inject({ method: "PUT", url: `/api/collections/${c.id}/canvas`, headers: auth, payload: [{ itemId: note, x: 5, y: 6, w: 200, z: 1 }] });
    const canvas = (await app.inject({ method: "GET", url: `/api/collections/${c.id}/canvas`, headers: auth })).json();
    expect(canvas).toEqual([{ itemId: note, x: 5, y: 6, w: 200, z: 1 }]);
    const renamed = (await app.inject({ method: "PATCH", url: `/api/collections/${c.id}`, headers: auth, payload: { name: "Big ideas", view: "canvas" } })).json();
    expect(renamed.name).toBe("Big ideas");
    expect(renamed.view).toBe("canvas");
  });

  it("stores the AI key on the device, not in the library", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/settings", headers: auth, payload: { aiKey: "sk-test", aiEnabled: true } });
    expect(res.json().aiKeySet).toBe(true);
    expect(res.json().aiEnabled).toBe(true);
    expect(ctx.config.get().aiKey).toBe("sk-test");
    const rows = ctx.lib.db.all<{ key: string; value: string }>("SELECT key, value FROM settings");
    expect(rows.some((r) => r.value.includes("sk-test"))).toBe(false);
  });
});
