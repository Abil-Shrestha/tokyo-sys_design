import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyColor, extractPalette, hexToLab } from "../src/server/colors";
import { openTestCabinet, solidPng, splitPng } from "./helpers";
import sharp from "sharp";

type Ctx = Awaited<ReturnType<typeof openTestCabinet>>;

describe("library", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await openTestCabinet({ startJobs: false });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("creates notes and finds them with prefix search", () => {
    const { id } = ctx.cabinet.addNote("Remember to try the persimmon tart from the Saturday market", { tags: ["Food", "#weekend"] });
    ctx.cabinet.addNote("Unrelated thought about typography");
    const page = ctx.lib.listItems({ q: "persim" });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(id);
    expect(page.items[0].tags.map((t) => t.name)).toEqual(["food", "weekend"]);
    expect(ctx.lib.listItems({ q: "#weekend" }).total).toBe(1);
    expect(ctx.lib.listItems({ q: "type:note" }).total).toBe(2);
    expect(ctx.lib.listItems({ q: "-typography" }).total).toBe(1);
  });

  it("updates items, tags and pins, and records changes", () => {
    const { id } = ctx.cabinet.addNote("draft");
    const before = ctx.lib.changesSince(0).length;
    const item = ctx.lib.updateItem(id, { body: "final text", pinned: true, tags: ["a", "b"], note: "my note" })!;
    expect(item.body).toBe("final text");
    expect(item.pinned).toBe(true);
    expect(item.tags.map((t) => t.name).sort()).toEqual(["a", "b"]);
    ctx.lib.updateItem(id, { tags: ["b", "c"] });
    expect(ctx.lib.getItem(id)!.tags.map((t) => t.name).sort()).toEqual(["b", "c"]);
    expect(ctx.lib.listItems({ q: "is:pinned" }).total).toBe(1);
    expect(ctx.lib.listItems({ q: "has:note" }).total).toBe(1);
    const changes = ctx.lib.changesSince(0);
    expect(changes.length).toBeGreaterThan(before);
    expect(changes.every((c) => /^\d{13}-\d{4}-/.test(c.hlc))).toBe(true);
    // Clocks are strictly increasing in log order.
    const hlcs = changes.map((c) => c.hlc);
    expect([...hlcs].sort()).toEqual(hlcs);
  });

  it("moves items to trash, restores and purges them", async () => {
    const a = ctx.cabinet.addNote("one").id;
    const b = ctx.cabinet.addNote("two").id;
    ctx.lib.trashItems([a]);
    expect(ctx.lib.listItems({}).total).toBe(1);
    expect(ctx.lib.listItems({ trash: true }).items.map((i) => i.id)).toEqual([a]);
    ctx.lib.restoreItems([a]);
    expect(ctx.lib.listItems({}).total).toBe(2);
    ctx.lib.trashItems([a, b]);
    expect(await ctx.lib.emptyTrash()).toBe(2);
    expect(ctx.lib.getItem(a)).toBeNull();
  });

  it("stores images once, analyses colours and deletes unused files", async () => {
    const png = await solidPng("#e5322d", 300, 200);
    const first = await ctx.cabinet.addFile(png, { name: "red.png" });
    const second = await ctx.cabinet.addFile(png, { name: "copy.png" });
    const item = ctx.lib.getItem(first.id)!;
    expect(item.kind).toBe("image");
    expect(item.width).toBe(300);
    expect(item.height).toBe(200);
    expect(item.colors[0].weight).toBeGreaterThan(0.9);
    expect(ctx.lib.getItem(second.id)!.asset).toBe(item.asset);
    expect(ctx.lib.listItems({ q: "color:red" }).total).toBe(2);
    expect(ctx.lib.listItems({ q: "red" }).total).toBe(2); // soft colour word
    expect(ctx.lib.listItems({ q: "color:blue" }).total).toBe(0);

    ctx.lib.trashItems([first.id]);
    await ctx.lib.emptyTrash();
    expect(ctx.lib.blobs.filePath(item.asset!)).not.toBeNull(); // still used by the copy
    ctx.lib.trashItems([second.id]);
    await ctx.lib.emptyTrash();
    expect(ctx.lib.blobs.filePath(item.asset!)).toBeNull();
  });

  it("turns small text files into notes", async () => {
    const { id } = await ctx.cabinet.addFile(Buffer.from("# Ideas\n\n- one\n- two"), { name: "ideas.md" });
    const item = ctx.lib.getItem(id)!;
    expect(item.kind).toBe("note");
    expect(item.body).toContain("- two");
  });

  it("manages manual and smart collections", async () => {
    const note = ctx.cabinet.addNote("typeface specimen", { tags: ["type"] }).id;
    const img = (await ctx.cabinet.addFile(await solidPng("#2f6fdb"), { name: "blue.png" })).id;
    const board = ctx.lib.createCollection({ name: "Moodboard" });
    ctx.lib.addToCollection(board.id, [note, img]);
    expect(ctx.lib.listItems({ collectionId: board.id }).total).toBe(2);
    expect(ctx.lib.listItems({ q: 'in:"moodboard" type:image' }).total).toBe(1);
    ctx.lib.removeFromCollection(board.id, [note]);
    expect(ctx.lib.listCollections().find((c) => c.id === board.id)!.count).toBe(1);

    const smart = ctx.lib.createCollection({ name: "Blue things", kind: "smart", query: "color:blue" });
    expect(ctx.lib.listCollections().find((c) => c.id === smart.id)!.count).toBe(1);
    expect(ctx.lib.listItems({ collectionId: smart.id }).items[0].id).toBe(img);
    expect(() => ctx.lib.addToCollection(smart.id, [note])).toThrow();

    ctx.lib.setCanvas(board.id, [{ itemId: img, x: 10, y: 20, w: 300, z: 2 }]);
    expect(ctx.lib.getCanvas(board.id)).toEqual([{ itemId: img, x: 10, y: 20, w: 300, z: 2 }]);
  });

  it("renames and deletes tags across items", () => {
    const a = ctx.cabinet.addNote("a", { tags: ["colour"] }).id;
    ctx.cabinet.addNote("b", { tags: ["colour", "x"] });
    ctx.lib.renameTag("colour", "color");
    expect(ctx.lib.listTags().find((t) => t.name === "color")?.count).toBe(2);
    ctx.lib.deleteTag("color");
    expect(ctx.lib.getItem(a)!.tags).toEqual([]);
  });

  it("links items both ways and finds similar ones", async () => {
    const a = ctx.cabinet.addNote("a", { tags: ["garden", "spring"] }).id;
    const b = ctx.cabinet.addNote("b", { tags: ["garden", "spring"] }).id;
    ctx.cabinet.addNote("c", { tags: ["finance"] });
    ctx.lib.linkItems(a, b);
    expect(ctx.lib.getItem(b)!.links.map((l) => l.id)).toEqual([a]);
    expect(ctx.lib.similar(a).map((i) => i.id)).toContain(b);
    ctx.lib.unlinkItems(b, a);
    expect(ctx.lib.getItem(a)!.links).toEqual([]);
  });

  it("paginates with a cursor and reports facets", () => {
    for (let i = 0; i < 25; i++) ctx.cabinet.addNote(`note ${i}`, { tags: i % 2 ? ["odd"] : ["even"] });
    const first = ctx.lib.listItems({ limit: 10 });
    expect(first.items).toHaveLength(10);
    const second = ctx.lib.listItems({ limit: 10, cursor: first.nextCursor });
    expect(second.items[0].id).not.toBe(first.items[0].id);
    const third = ctx.lib.listItems({ limit: 10, cursor: second.nextCursor });
    expect(third.items).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    const facets = ctx.lib.facets();
    expect(facets.total).toBe(25);
    expect(facets.kinds.note).toBe(25);
    expect(facets.tags.find((t) => t.name === "even")?.count).toBe(13);
  });
});

describe("colours", () => {
  it("classifies colour families", () => {
    expect(classifyColor(hexToLab("#e5322d"))).toBe("red");
    expect(classifyColor(hexToLab("#2f6fdb"))).toBe("blue");
    expect(classifyColor(hexToLab("#3aa655"))).toBe("green");
    expect(classifyColor(hexToLab("#111111"))).toBe("black");
    expect(classifyColor(hexToLab("#fafafa"))).toBe("white");
    expect(classifyColor(hexToLab("#808080"))).toBe("gray");
    expect(classifyColor(hexToLab("#f5d033"))).toBe("yellow");
    expect(classifyColor(hexToLab("#f06ea9"))).toBe("pink");
  });

  it("extracts a two-colour palette", async () => {
    const png = await splitPng("#2f6fdb", "#f5d033");
    const { data, info } = await sharp(png).resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const palette = extractPalette(data, info.channels);
    expect(palette).toHaveLength(2);
    const families = palette.map((p) => classifyColor(hexToLab(p.hex))).sort();
    expect(families).toEqual(["blue", "yellow"]);
    expect(palette[0].weight).toBeCloseTo(0.5, 1);
  });
});
