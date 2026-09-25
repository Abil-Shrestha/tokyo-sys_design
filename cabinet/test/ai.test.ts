import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openTestCabinet, solidPng } from "./helpers";

// A stand-in for the Anthropic Messages API, so the enrichment pipeline can be
// tested end to end without a key or network access.
interface Captured {
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown> & { messages: { content: { type: string; source?: { media_type: string } }[] }[] };
}

let server: http.Server;
let captured: Captured[] = [];
let respond: (req: Captured) => { status: number; body: unknown } = () => ({ status: 500, body: {} });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const entry = { headers: req.headers, body: JSON.parse(data || "{}") };
      captured.push(entry);
      const r = respond(entry);
      res.writeHead(r.status, { "Content-Type": "application/json", "request-id": "req_test" });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.ANTHROPIC_BASE_URL;
  await new Promise<void>((r) => server.close(() => r()));
});

function message(json: unknown, stop = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: JSON.stringify(json) }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

describe("AI enrichment", () => {
  let ctx: Awaited<ReturnType<typeof openTestCabinet>>;
  beforeEach(async () => {
    captured = [];
    ctx = await openTestCabinet();
    ctx.config.update({ aiKey: "sk-ant-test" });
    ctx.lib.setSettings({ aiEnabled: true });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("tags and describes an image", async () => {
    respond = () => ({
      status: 200,
      body: message({
        tags: ["Ocean", "#blue", "minimal"],
        summary: "",
        image_description: "A calm blue square, like a clear sky.",
        image_text: "SALE 50%",
      }),
    });
    const { id } = await ctx.cabinet.addFile(await solidPng("#2f6fdb", 800, 600), { name: "sky.png", tags: ["mine"] });
    await ctx.cabinet.jobs.idle();

    const item = ctx.lib.getItem(id)!;
    expect(item.tags).toEqual([
      { name: "mine", source: "user" },
      { name: "ocean", source: "ai" },
      { name: "blue", source: "ai" },
      { name: "minimal", source: "ai" },
    ]);
    expect(item.summary).toBe("A calm blue square, like a clear sky.");
    expect(item.meta.imageText).toBe("SALE 50%");
    expect(item.aiStatus).toBe("done");
    // What the model says about an image makes it searchable.
    expect(ctx.lib.listItems({ q: "clear sky" }).total).toBe(1);
    expect(ctx.lib.listItems({ q: "sale" }).total).toBe(1);

    const req = captured[0];
    expect(req.headers["x-api-key"]).toBe("sk-ant-test");
    expect(req.body.model).toBe("claude-opus-5");
    expect(req.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(req.body.fallbacks).toBe("default");
    expect((req.body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    const content = req.body.messages[0].content;
    expect(content[0].type).toBe("image");
    expect(content[0].source?.media_type).toBe("image/jpeg");
    expect(content[1].type).toBe("text");
  });

  it("summarises notes and keeps user tags when re-run", async () => {
    respond = () => ({ status: 200, body: message({ tags: ["gardening"], summary: "Notes on growing tomatoes.", image_description: "", image_text: "" }) });
    const { id } = ctx.cabinet.addNote("Tomatoes want sun, deep watering and a stake.", { tags: ["home"] });
    await ctx.cabinet.jobs.idle();
    expect(ctx.lib.getItem(id)!.summary).toBe("Notes on growing tomatoes.");

    respond = () => ({ status: 200, body: message({ tags: ["vegetables"], summary: "Tomato care.", image_description: "", image_text: "" }) });
    ctx.cabinet.refresh(id);
    await ctx.cabinet.jobs.idle();
    const item = ctx.lib.getItem(id)!;
    expect(item.tags.map((t) => `${t.source}:${t.name}`)).toEqual(["user:home", "ai:vegetables"]);
  });

  it("does not use fallbacks or effort on models that lack them", async () => {
    ctx.lib.setSettings({ aiModel: "claude-haiku-4-5" });
    respond = () => ({ status: 200, body: message({ tags: ["x"], summary: "", image_description: "", image_text: "" }) });
    ctx.cabinet.addNote("hello");
    await ctx.cabinet.jobs.idle();
    const req = captured[0];
    expect(req.body.model).toBe("claude-haiku-4-5");
    expect(req.body.fallbacks).toBeUndefined();
    expect((req.body.output_config as { effort?: string }).effort).toBeUndefined();
  });

  it("records a rejected key without retrying", async () => {
    respond = () => ({ status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } });
    const { id } = ctx.cabinet.addNote("anything");
    await ctx.cabinet.jobs.idle();
    expect(ctx.lib.getItem(id)!.aiStatus).toMatch(/^failed: The Anthropic API key was rejected/);
    expect(captured).toHaveLength(1);
  });

  it("handles a refusal", async () => {
    respond = () => ({ status: 200, body: { ...message({}), content: [], stop_reason: "refusal" } });
    const { id } = ctx.cabinet.addNote("something");
    await ctx.cabinet.jobs.idle();
    expect(ctx.lib.getItem(id)!.aiStatus).toMatch(/declined/);
  });

  it("skips items when AI is off", async () => {
    ctx.lib.setSettings({ aiEnabled: false });
    ctx.cabinet.addNote("private");
    await ctx.cabinet.jobs.idle();
    expect(captured).toHaveLength(0);
  });
});
