import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.CABINET_PORT ?? 47600);

export default defineConfig({
  root: "src/web",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      "/blobs": { target: `http://127.0.0.1:${apiPort}` },
      "/thumbs": { target: `http://127.0.0.1:${apiPort}` },
    },
  },
});
