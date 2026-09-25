import { describe, expect, it } from "vitest";
import { parseDateRange, parseQuery } from "../src/shared/query";

describe("parseQuery", () => {
  it("splits words, phrases and filters", () => {
    const q = parseQuery('oak chair "lounge chair" type:product #furniture site:www.example.com -plastic');
    expect(q.words).toEqual(["oak", "chair"]);
    expect(q.phrases).toEqual(["lounge chair"]);
    expect(q.types).toEqual(["product"]);
    expect(q.tags).toEqual(["furniture"]);
    expect(q.sites).toEqual(["example.com"]);
    expect(q.notWords).toEqual(["plastic"]);
  });

  it("treats colour and plural type words as soft terms", () => {
    const q = parseQuery("red images of cats");
    expect(q.soft).toEqual([
      { word: "red", color: "red" },
      { word: "images", type: "image" },
    ]);
    expect(q.words).toEqual(["of", "cats"]);
  });

  it("understands is:pinned, has:, in: and negated tags", () => {
    const q = parseQuery('is:pinned has:note in:"Mood board" -tag:old');
    expect(q.pinned).toBe(true);
    expect(q.has).toEqual(["note"]);
    expect(q.collections).toEqual(["Mood board"]);
    expect(q.notTags).toEqual(["old"]);
  });

  it("parses colours by name and hex", () => {
    expect(parseQuery("color:Blue color:#F0A").colors).toEqual(["blue", "#ff00aa"]);
    expect(parseQuery("color:nope").colors).toEqual([]);
  });

  it("keeps unknown key:value pairs as text", () => {
    expect(parseQuery("https://example.com").words).toEqual(["https://example.com"]);
    expect(parseQuery("foo:bar").words).toEqual(["foo:bar"]);
  });

  it("resolves date expressions", () => {
    const now = new Date(2026, 8, 25, 15, 0, 0);
    const [from, to] = parseDateRange("today", now)!;
    expect(new Date(from).getDate()).toBe(25);
    expect(to - from).toBe(86_400_000);
    const [mFrom, mTo] = parseDateRange("2024-02", now)!;
    expect(new Date(mFrom).getMonth()).toBe(1);
    expect(new Date(mTo).getMonth()).toBe(2);
    const q = parseQuery("date:yesterday", now);
    expect(q.after).toBeLessThan(q.before!);
    expect(parseQuery("after:7d", now).after).toBe(now.getTime() - 7 * 86_400_000);
  });
});
