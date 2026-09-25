// Derived media the server cannot make without heavy native tools: poster
// frames for videos and first-page previews plus searchable text for PDFs.
// The browser already knows how to decode both, so the UI does the work once
// and uploads the result.

import type { ItemCard } from "../../shared/types";
import { api, blobUrl } from "../api";

const attempted = new Set<string>();
let running = 0;
const queue: (() => Promise<void>)[] = [];

function schedule(task: () => Promise<void>): void {
  queue.push(task);
  pump();
}

function pump(): void {
  while (running < 2 && queue.length) {
    const task = queue.shift()!;
    running++;
    void task()
      .catch(() => {})
      .finally(() => {
        running--;
        pump();
      });
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), type, quality));
}

async function videoPoster(item: ItemCard): Promise<void> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = blobUrl(item.asset!);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 20_000);
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(1, (video.duration || 2) * 0.1);
    });
    video.addEventListener("seeked", () => {
      clearTimeout(timer);
      resolve();
    });
    video.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("video error"));
    });
  });
  const scale = Math.min(1, 1280 / (video.videoWidth || 1280));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((video.videoWidth || 1280) * scale);
  canvas.height = Math.round((video.videoHeight || 720) * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  video.removeAttribute("src");
  video.load();
  await api.setPreview(item.id, await canvasToBlob(canvas));
}

async function pdfDerive(item: ItemCard): Promise<void> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ url: blobUrl(item.asset!) });
  const doc = await task.promise;
  try {
    if (!item.preview) {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 900 / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      await api.setPreview(item.id, await canvasToBlob(canvas));
    }
    if (!item.meta.wordCount) {
      const parts: string[] = [];
      const pages = Math.min(doc.numPages, 300);
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        parts.push(content.items.map((t) => ("str" in t ? t.str : "")).join(" "));
      }
      const text = parts.join("\n\n").replace(/[ \t]+/g, " ").trim();
      await api.setText(item.id, text || " ", doc.numPages);
    }
  } finally {
    await task.destroy();
  }
}

/** Called when a card becomes visible; generates missing derived media once. */
export function ensureDerivedMedia(item: ItemCard): void {
  if (!item.asset || attempted.has(item.id)) return;
  if (item.kind === "video" && !item.preview) {
    attempted.add(item.id);
    schedule(() => videoPoster(item));
  } else if (item.kind === "pdf" && (!item.preview || item.meta.wordCount === undefined)) {
    attempted.add(item.id);
    schedule(() => pdfDerive(item));
  }
}
