// Renders the app, tray and extension icons from SVG sources.
import fs from "node:fs";
import sharp from "sharp";

const mark = (bg, fg, accent, rx = 14) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${rx}" fill="${bg}"/>
  <rect x="14" y="14" width="16" height="22" rx="4" fill="${accent}"/>
  <rect x="34" y="14" width="16" height="14" rx="4" fill="${fg}"/>
  <rect x="14" y="40" width="16" height="10" rx="4" fill="${fg}"/>
  <rect x="34" y="32" width="16" height="18" rx="4" fill="${fg}"/>
</svg>`;

// macOS app icons sit inside a rounded square with some margin.
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="100" y="100" width="824" height="824" rx="185" fill="#1f1d1a"/>
  <g transform="translate(100 100) scale(12.875)">
    <rect x="14" y="14" width="16" height="22" rx="4" fill="#ff5f1f"/>
    <rect x="34" y="14" width="16" height="14" rx="4" fill="#f4f1ea"/>
    <rect x="14" y="40" width="16" height="10" rx="4" fill="#f4f1ea"/>
    <rect x="34" y="32" width="16" height="18" rx="4" fill="#f4f1ea"/>
  </g>
</svg>`;

// Menu bar template: black shapes on transparent, macOS tints them.
const tray = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22">
  <rect x="3" y="3" width="7" height="9" rx="1.6" fill="#000"/>
  <rect x="12" y="3" width="7" height="6" rx="1.6" fill="#000"/>
  <rect x="3" y="14" width="7" height="5" rx="1.6" fill="#000"/>
  <rect x="12" y="11" width="7" height="8" rx="1.6" fill="#000"/>
</svg>`;

fs.mkdirSync("build", { recursive: true });
fs.mkdirSync("extension/icons", { recursive: true });
await sharp(Buffer.from(appIcon)).resize(1024, 1024).png().toFile("build/icon.png");
await sharp(Buffer.from(tray)).resize(22, 22).png().toFile("build/trayTemplate.png");
await sharp(Buffer.from(tray)).resize(44, 44).png().toFile("build/trayTemplate@2x.png");
await sharp(Buffer.from(tray.replaceAll("#000", "#444"))).resize(32, 32).png().toFile("build/tray.png");
for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(mark("#1f1d1a", "#f4f1ea", "#ff5f1f", size <= 16 ? 10 : 14))).resize(size, size).png().toFile(`extension/icons/icon-${size}.png`);
}
console.log("icons written");
