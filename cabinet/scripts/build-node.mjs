// Bundles the library server and the Electron shell with esbuild.
// Dependencies stay external: they ship in node_modules with the app.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
};

await Promise.all([
  build({ ...common, entryPoints: ["src/server/cli.ts"], outfile: "dist/server/cli.js", format: "esm" }),
  build({ ...common, entryPoints: ["src/electron/main.ts"], outfile: "dist/electron/main.js", format: "esm", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/electron/preload.ts"], outfile: "dist/electron/preload.cjs", format: "cjs", external: ["electron"] }),
]);
