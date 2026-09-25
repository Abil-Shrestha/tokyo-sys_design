// Fills a library with sample content, for trying Cabinet out and for
// screenshots:  npm run seed [-- <library-path> [config-dir]]
// Without arguments it fills the development library used by `npm run dev`.
//
// Images are generated locally; links point at a small local fixture site so
// the script works offline.

import path from "node:path";
import sharp from "sharp";
import { ConfigStore } from "../src/server/config";
import { Cabinet } from "../src/server/engine";
import { silentLogger } from "../src/server/jobs";
import { startFixtureServer } from "../test/helpers";

const libraryPath = path.resolve(process.argv[2] ?? ".dev-library");
const configDir = path.resolve(process.argv[3] ?? path.join(libraryPath, "..", ".dev-config"));

function gradientSvg(w: number, h: number, stops: string[], shape: "circle" | "waves" | "blocks" | "sun"): string {
  const grad = stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)) * 100}%" stop-color="${c}"/>`).join("");
  const shapes = {
    circle: `<circle cx="${w * 0.62}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.28}" fill="${stops[stops.length - 1]}" opacity="0.9"/>`,
    waves: Array.from({ length: 7 }, (_, i) => `<path d="M0 ${h * (0.3 + i * 0.1)} Q ${w / 4} ${h * (0.22 + i * 0.1)} ${w / 2} ${h * (0.3 + i * 0.1)} T ${w} ${h * (0.3 + i * 0.1)}" stroke="${stops[i % stops.length]}" stroke-width="${h * 0.03}" fill="none" opacity="0.85"/>`).join(""),
    blocks: Array.from({ length: 9 }, (_, i) => `<rect x="${(i % 3) * (w / 3) + w * 0.03}" y="${Math.floor(i / 3) * (h / 3) + h * 0.03}" width="${w / 3 - w * 0.06}" height="${h / 3 - h * 0.06}" rx="${w * 0.02}" fill="${stops[i % stops.length]}"/>`).join(""),
    sun: `<rect y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="${stops[0]}" opacity="0.7"/><circle cx="${w / 2}" cy="${h * 0.62}" r="${w * 0.2}" fill="${stops[stops.length - 1]}"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${grad}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${shapes[shape]}</svg>`;
}

async function png(w: number, h: number, stops: string[], shape: "circle" | "waves" | "blocks" | "sun"): Promise<Buffer> {
  return sharp(Buffer.from(gradientSvg(w, h, stops, shape))).png().toBuffer();
}

async function main() {
  const fixtures = await startFixtureServer();
  const config = new ConfigStore(configDir);
  const cabinet = await Cabinet.open({ libraryPath, config, logger: silentLogger });
  const lib = cabinet.lib;

  const moodboard = lib.createCollection({ name: "Studio moodboard", icon: "🎨" });
  const reading = lib.createCollection({ name: "Reading list", icon: "📚" });
  const home = lib.createCollection({ name: "New apartment", icon: "🪴" });
  lib.createCollection({ name: "Blue things", kind: "smart", query: "color:blue" });
  lib.createCollection({ name: "Recipes to try", kind: "smart", query: "type:recipe" });

  const images: [string, number, number, string[], "circle" | "waves" | "blocks" | "sun", string[], string?][] = [
    ["dusk.png", 1200, 1500, ["#1d2c5e", "#8a4fd1", "#f28c28"], "sun", ["sunset", "poster"], moodboard.id],
    ["tide.png", 1600, 900, ["#0d47a1", "#26a69a", "#e3f2fd"], "waves", ["ocean", "pattern"], moodboard.id],
    ["terracotta.png", 1000, 1000, ["#c1440e", "#e8d8b8", "#8a5a36"], "blocks", ["clay", "palette"], home.id],
    ["meadow.png", 900, 1350, ["#1b5e20", "#8bc34a", "#fff176"], "circle", ["nature", "spring"], moodboard.id],
    ["blush.png", 1400, 1000, ["#f8bbd0", "#f06292", "#fff3e0"], "circle", ["pink", "soft"]],
    ["noir.png", 1000, 1250, ["#121212", "#424242", "#e5322d"], "circle", ["contrast", "poster"], moodboard.id],
    ["citrus.png", 1200, 800, ["#fdd835", "#ff9800", "#fff8e1"], "blocks", ["summer"]],
    ["fjord.png", 1000, 1500, ["#90caf9", "#1976d2", "#0d1b2a"], "waves", ["mountains", "blue hour"]],
    ["sage.png", 1100, 1100, ["#a5d6a7", "#556b2f", "#efe6d8"], "sun", ["interior", "calm"], home.id],
    ["violet-hour.png", 1500, 1000, ["#4a148c", "#b39ddb", "#f3e5f5"], "waves", ["night"]],
  ];
  for (const [name, w, h, stops, shape, tags, collectionId] of images) {
    await cabinet.addFile(await png(w, h, stops, shape), { name, tags, collectionId });
  }

  const notes = [
    ["", "Ideas for the studio wall:\n- a big cork board for printouts\n- warm 2700K lamps\n- one plant that doesn't need much light\n\nAsk Mia about the old drafting table."],
    ["Books people recommended", "**Draft No. 4** — John McPhee\n**The Timeless Way of Building** — Christopher Alexander\n**Thinking in Systems** — Donella Meadows"],
    ["", "The best interfaces feel like they were always there. Remove until it breaks, then add one thing back."],
    ["Trip · Kyoto in November", "Stay near Demachiyanagi. Morning walk along the Kamo river, Honen-in before 9, then coffee at a kissaten. Book the joinery workshop tour two weeks ahead."],
    ["", "Gift idea for dad: a good pull saw and a sharpening stone."],
  ];
  for (const [title, body] of notes) cabinet.addNote(body, { title: title || null });

  cabinet.addQuote("Less, but better.", { title: "Dieter Rams", url: "https://example.com/rams" });
  cabinet.addQuote("We shape our buildings; thereafter they shape us.", { title: "Winston Churchill" });
  cabinet.addQuote("The details are not the details. They make the design.", { title: "Charles Eames", url: "https://example.com/eames" });

  const article = await cabinet.addUrl(`${fixtures.url}/articles/joinery`, { tags: ["craft"], collectionId: reading.id });
  const product = await cabinet.addUrl(`${fixtures.url}/shop/chair`, { collectionId: home.id });
  await cabinet.addUrl(`${fixtures.url}/recipes/miso`);
  await cabinet.jobs.idle(60_000);

  lib.updateItem(article.id, { pinned: true, note: "Read before the Kyoto trip." });
  lib.updateItem(product.id, { pinned: true });
  lib.linkItems(article.id, product.id);

  console.log(`Seeded ${lib.itemCount()} items into ${libraryPath}`);
  await cabinet.close();
  await fixtures.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
