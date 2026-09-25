# Architecture

```
┌──────────────────────────── Electron main process ────────────────────────────┐
│                                                                                │
│  Cabinet engine (src/server/engine.ts)                                         │
│  ├── Library (library.ts): SQLite (node:sqlite) + FTS5, change log, events     │
│  ├── BlobStore (blobs.ts): content-addressed files, ThumbnailCache (sharp)     │
│  └── JobRunner (jobs.ts): persistent queue → link enrichment, snapshots, AI    │
│                                                                                │
│  Fastify HTTP API on 127.0.0.1:47600 (http.ts)  ◄──── tray drops, clipboard    │
│         ▲                ▲                  ▲                                  │
└─────────┼────────────────┼──────────────────┼──────────────────────────────────┘
          │ cookie         │ bearer token     │ bearer token
   ┌──────┴──────┐  ┌──────┴────────┐  ┌──────┴──────────┐
   │ Window (UI) │  │ Browser        │  │ `npm run serve`  │
   │ React/Vite  │  │ extension (MV3)│  │ in any browser   │
   └─────────────┘  └───────────────┘  └─────────────────┘
```

Everything the UI can do goes through the same HTTP API that the browser
extension and the headless server use. The desktop shell adds only things a
web page cannot do: native window and menus, the menu-bar drop target, the
global clipboard shortcut, off-screen page snapshots, and "show in folder".

## Library folder

```
Cabinet Library/
  library.db          SQLite database (WAL mode)
  blobs/ab/<sha256>.jpg  original files and preview images, named by content hash
  cache/thumbs/…      WebP thumbnails at 240/480/960/1600 px, safe to delete
  tmp/                in-flight uploads
```

The default location is `~/Cabinet Library`; it can be changed in Settings.
Device settings (library path, API token, AI key, device id) live in the app
config directory (`~/Library/Application Support/Cabinet/config.json` on
macOS), never inside the library.

## Data model

| Table | Purpose |
| --- | --- |
| `items` | One row per saved thing. `kind` is what it is on disk (image, video, audio, pdf, file, link, note, quote); `link_type` refines links (article, product, recipe, video, …). Text fields, preview/asset/favicon blob hashes, dimensions, palette, JSON `meta` (price, reading time, ingredients…), `pinned_at`, `deleted_at`, enrichment status. |
| `item_tags` | `(item_id, tag, source)`; source is `user`, `auto` (page keywords) or `ai`. |
| `item_colors` | Palette per item with Lab values and a colour family, for colour search. |
| `item_links` | Bidirectional connections between items. |
| `collections`, `collection_items` | Manual and smart (saved search) collections; canvas positions per item. |
| `items_fts` | FTS5 index over title, body/notes/summary/article text, tags and metadata. |
| `blobs` | Hash → extension, MIME type, size, dimensions. |
| `changes` | Append-only log of every mutation with an HLC timestamp and device id (for sync). |
| `jobs` | Background work that survives restarts. |
| `settings` | Library-wide preferences. |

## Saving and enrichment

1. **Capture** (UI paste/drop/composer, extension, tray, clipboard shortcut)
   calls `Cabinet.addNote / addQuote / addUrl / addFile / addRemoteFile`.
2. Files are streamed into the blob store and hashed; images are analysed
   immediately (dimensions and a k-means palette in Lab space) so the grid
   can lay them out without a jump.
3. Links are saved at once with status `pending`, then a `link` job fetches
   the page (Electron uses Chromium's network stack via `net.fetch`) and
   reads Open Graph, Twitter cards and JSON-LD to find the title, image,
   site, author, price, recipe data and more. `@mozilla/readability` extracts
   the article for the reader view and full-text search. The preview image
   and favicon are downloaded, so cards survive link rot.
4. If a page has no image, the desktop app renders it off-screen and stores
   a snapshot. The extension can also send a snapshot of the visible tab.
5. If AI is enabled, an `ai` job sends the text and a 1024 px JPEG to Claude
   with a JSON schema and stores tags, a summary or image description, and
   any text in the image. User tags are never replaced.
6. Videos and PDFs get their poster frame / first page and PDF text from the
   UI, which decodes them with the browser's own engines and uploads the
   result once.

Every write emits an event; the UI listens over server-sent events and
patches its caches, so the extension, tray and background jobs show up live.

## Search

`src/shared/query.ts` parses the search box into words, phrases and filters
(`type:`, `#tag`, `site:`, `color:`, `date:`, `in:`, `has:`, `is:pinned`,
negation). `src/server/search.ts` turns that into SQL: an FTS5 match ranked
with BM25 (title weighted highest), plus indexed id-set filters. Bare colour
words ("red") and plural type words ("images") match either the text or the
colour/type. With 5,000 items every query runs in under 10 ms.

## UI

React 19 with TanStack Query for server state and a tiny store for UI state
(`store.ts`). The grid (`Grid.tsx`) is a virtualised masonry: card heights
are computed from known aspect ratios and text length (`lib/layout.ts`), and
the card renderer clamps to exactly those sizes, so thousands of items lay
out without measuring the DOM and only visible cards are mounted.

## Security

- The server binds to `127.0.0.1` only and rejects requests whose `Host` is
  not a local name (DNS-rebinding protection).
- API calls need either the bearer token (extension, dev UI) or the
  `HttpOnly; SameSite=Strict` session cookie set when the UI is served, plus a
  custom header on writes so other sites cannot forge requests.
- CORS is granted only to browser-extension origins.
- Captured article HTML is sanitised with DOMPurify before display; SVG
  originals are served with a CSP that blocks scripts.
- The Electron window uses context isolation and a sandboxed preload; links
  open in the default browser.

## Code map

```
src/shared/     types.ts (API types), query.ts (search language)
src/server/     db.ts, library.ts, search.ts, blobs.ts, images.ts, colors.ts,
                engine.ts (capture + jobs), jobs.ts, http.ts (API), cli.ts,
                importers.ts, config.ts, ids.ts, enrich/{fetch,html,ai}.ts
src/web/        App.tsx, api.ts, queries.ts, store.ts, actions.ts,
                components/*, lib/{layout,media,markdown,format}.ts, styles/
src/electron/   main.ts (window, tray, shortcuts, snapshots), preload.ts
extension/      Chrome MV3 extension (plain JS, no build step)
test/           Vitest suites + HTML fixtures
scripts/        build, dev, icons, demo seed
```
