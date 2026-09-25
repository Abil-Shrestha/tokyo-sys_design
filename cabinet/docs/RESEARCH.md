# Research: Atlas and mymind

Cabinet is modelled on two products. This note records what each does, what
people like and dislike about them, and how Cabinet responds. Sources are
listed at the end (researched September 2026).

## Atlas for Mac (atlasformac.com)

A native macOS "moodboard, reference and inspiration library" by a solo
developer. One-time purchase ($39, a year of updates), macOS 14+.

What it does:

- **Local-first library.** The library is a folder of your files on disk.
  Store it anywhere (internal disk, external drive, Dropbox, iCloud); sync
  and team sharing are done by putting that folder in a synced cloud folder.
  No Atlas cloud.
- **Three views:** *Grid* for scanning thousands of items with a zoom slider,
  *Canvas* for arranging items freely, *Infinity* for endless drifting.
- **Collections** you can nest and reorder, plus smart folders and tags.
- **Capture:** Safari/Chrome extensions (right-click an image or video, or
  ⌥-click to save straight to the Inbox), a menu-bar pin you drop things
  onto, pasting X/Instagram posts, and connected folders that are browsed
  in place.
- **Links** with website snapshots, the site's preview image or a title card;
  snapshots can come from the browser extension so logged-in pages look right.
- **Semantic search** with downloadable on-device models ("warm bar interior
  at night"), and **MCP support** so AI assistants can use the library.
- Import from Eagle; iOS companion app announced.
- Emphasis on speed: scrolling and zooming thousands of items without hitches.

## mymind (mymind.com)

"The extension for your mind. Remember everything. Organise nothing." A
private, subscription-based web/desktop/mobile app ($4.99–12.99 a month).

What it does:

- **No folders.** Save anything and AI tags and classifies it; search replaces
  filing. Reviews say the auto-tagging is good enough that "no organising"
  mostly works, especially for visual material.
- **Smart bookmarking.** Links are recognised as articles, products (with
  prices), books, recipes, videos… and shown as appropriate cards.
- **Search by colour, keyword, brand or date**; text inside images is
  recognised (OCR) so screenshots are searchable.
- **Notes** with a focus mode; **bidirectional links** between items.
- **Reader mode** for articles; AI summaries (top tier).
- **Smart Spaces** that fill themselves from a rule; **Top of Mind** for
  pinned priorities; **Serendipity**, a slow mode that resurfaces forgotten
  things so you can keep or forget them.
- **Privacy stance:** no social features, no sharing, no tracking, no ads.
- Weak spots from reviews: no free tier, the best AI costs extra, retrieval
  of long-form articles by meaning is weaker than visual recall, thin
  import/export, no collaboration.

## What Cabinet takes from each

| Idea | Source | Cabinet |
| --- | --- | --- |
| Library is a local folder you own; no account | Atlas | ✅ SQLite + original files in a folder of your choice |
| Save without filing; types detected automatically | mymind | ✅ Articles, products, recipes, videos, books, music, repos, posts, places |
| AI tags, summaries, image descriptions, text in images | mymind | ✅ Optional, with your own Anthropic key; off by default |
| Search by words, colour, type, site, date, tag | mymind | ✅ Full-text (FTS5) + colour palette index + query language |
| Grid with size slider, fast with thousands of items | Atlas | ✅ Virtualised masonry (5k items: ~70 DOM nodes, 60 fps) |
| Freeform canvas per collection | Atlas | ✅ Pan, zoom, drag, resize, tidy up |
| Collections + smart collections | both | ✅ Manual collections and saved-search collections |
| Top of Mind, Serendipity | mymind | ✅ |
| Notes with focus mode, quotes | mymind | ✅ Markdown notes, quote cards |
| Bidirectional links between items | mymind | ✅ "Connections" on every item |
| Reader mode, local copy of articles | mymind | ✅ Readability extraction, stored locally |
| Similar items ("Same Vibe") | mymind | ✅ Tags, colours, site and words |
| Browser extension, ⌥-click images, snapshots from the tab | Atlas | ✅ Chrome/Edge/Brave/Arc (MV3) |
| Menu-bar drop target, clipboard capture | Atlas | ✅ Tray icon accepts drops; ⌘⌥S saves the clipboard |
| Website snapshots for links without images | Atlas | ✅ Rendered off-screen by the desktop app |
| Import | both (weak in mymind) | ✅ Browser bookmarks (HTML) and CSV (Pocket, Raindrop…) |
| Export | — | ✅ JSON metadata; files are already plain files |
| Cross-device sync | both | 🧭 Designed for (change log + content-addressed files); see SYNC.md |
| On-device semantic search (CLIP) | Atlas | 🧭 Planned; needs model download |
| iOS app, MCP server, connected folders, Eagle import | Atlas | 🧭 Not in this version |

## Sources

- [Atlas — Moodboard, reference & inspiration library for Mac](https://atlasformac.com/)
- [Atlas release notes](https://atlasformac.com/release-notes)
- [mymind — the extension for your mind](https://mymind.com/) and [manifesto](https://mymind.com/manifesto)
- [mymind Review 2026 (Marqly)](https://www.marqly.com/blog/mymind-review-2026)
- [mymind reviews on Product Hunt](https://www.producthunt.com/products/my-mind/reviews)
