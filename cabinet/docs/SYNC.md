# Cross-device sync and cloud storage (design)

Cabinet is local-only today. This document describes how sync across devices
and cloud storage (S3 or anything S3-compatible: Cloudflare R2, Backblaze B2,
MinIO, Wasabi) fit onto what is already built, so adding them is an
extension rather than a rewrite.

## Goals

- Every device keeps a complete, fully working local library; the cloud is
  a mailbox, not the source of truth. Offline works exactly as today.
- No Cabinet server to run. A bucket (or a synced folder) is enough.
- Changes made on two devices at once merge without losing either.
- Optional end-to-end encryption, so the storage provider sees nothing.

## What is already in place

| Piece | Where | Why it matters for sync |
| --- | --- | --- |
| ULID ids for items and collections | `src/server/ids.ts` | Globally unique without coordination |
| Hybrid logical clock (HLC) per device | `src/server/ids.ts` | Orders changes across devices even with skewed clocks |
| Append-only change log with field-level data | `changes` table, written by `Library` in the same transaction as every mutation | The unit of replication |
| Tags, collection membership and item links stored as sets keyed by value | `item_tags`, `collection_items`, `item_links` | Merge as add/remove sets, no id clashes (two devices creating `#travel` agree) |
| Soft deletes (trash) and explicit purge ops | `deleted_at`, `op: "delete"` | Deletions replicate |
| Content-addressed files (SHA-256) | `src/server/blobs.ts` | A file's name is the same everywhere; upload once, never conflict |
| Derived data kept out of the log | thumbnails in `cache/`, enrichment status fields unlogged | Only real edits travel |
| Device-local config outside the library | `ConfigStore` (API key, token, device id) | Secrets never reach the bucket |

`Library.changesSince(seq)` already returns the log in order.

## Storage layout (per library)

```
<bucket>/<library-id>/
  blobs/<sha256>                 original files and preview images, immutable
  ops/<device-id>/<first-seq>-<last-seq>.jsonl.gz
                                 each device's change log, append-only segments
  snapshots/<hlc>.sqlite.gz      occasional full database snapshot for bootstrapping
  devices/<device-id>.json       name, last seen, last segment written
```

Nothing is ever overwritten except `devices/*.json`, so there are no write
races between devices and S3's consistency model is enough.

## The Remote interface

```ts
interface Remote {
  list(prefix: string): AsyncIterable<{ key: string; size: number }>;
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer | Readable, opts?: { ifNoneMatch?: boolean }): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Two implementations cover everything:

- `FolderRemote`: a directory, for example inside iCloud Drive or Dropbox. The
  sync service moves the files; Cabinet only ever adds new ones, which those
  services handle well.
- `S3Remote`: `@aws-sdk/client-s3` with endpoint, region, bucket, access key
  and secret from the device config. Works with any S3-compatible service.

## Sync loop

Runs on start, after local changes (debounced) and on a timer.

1. **Push files.** For each blob referenced by the log that is not yet
   uploaded (tracked in a `synced_blobs` table), `PUT blobs/<hash>` with
   `If-None-Match: *`.
2. **Push changes.** Take local changes after the last pushed `seq`, write
   them as one gzipped JSONL segment under `ops/<this-device>/`.
3. **Pull changes.** List `ops/*/`, fetch segments from other devices newer
   than the stored cursor for that device, and apply them in HLC order.
4. **Pull files lazily.** A missing blob is fetched the first time a card or
   thumbnail needs it (the `/blobs` and `/thumbs` routes fall through to the
   remote), or eagerly when "keep everything offline" is on.

## Merging

- **Fields (items, collections, settings):** last writer wins *per field*,
  comparing HLCs. The winning clock for a field is the latest local change
  that touched it, which the `changes` table already records. A remote op
  applies a field only if its HLC is newer. Editing the note on one device
  and the tags on another keeps both.
- **Sets (tags, collection membership, links):** each element is keyed
  (`item\u0000tag`), and the latest add/remove by HLC wins. A tag removed on
  one device and re-added later on another ends up present.
- **Deletes:** trash is just a field (`deleted_at`). A purge is final and
  beats later field edits to the same item.
- **Applying** remote ops goes through the same `Library` methods with the
  remote HLC and device, inside a transaction, so the full-text index and
  colour index stay correct, and the UI updates through the usual events.
  The clock observes every remote HLC (`HybridClock.observe`).

## Bootstrapping a new device

Download the newest snapshot, then apply segments with HLCs after it. A
device writes a snapshot every N thousand ops. Segments older than the
oldest cursor of all active devices (and older than the newest snapshot)
can be deleted.

## Encryption (optional)

With a passphrase set, derive a key (Argon2id) and encrypt every segment,
snapshot and blob with XChaCha20-Poly1305 before upload. Blob keys become
`HMAC(key, sha256)` so the bucket does not reveal which files you have.

## Why not just put the library folder in Dropbox?

It works if only one computer uses Cabinet at a time: the library is a plain
folder. SQLite files can be corrupted if two devices write while a sync
service copies them, and file sync cannot merge two edited databases. The
design above avoids both problems by syncing immutable files only.

## Implementation checklist

1. `sync_state` tables: pushed seq, per-device cursors, synced blobs.
2. `Remote` interface with `FolderRemote` and `S3Remote`.
3. `Library.applyRemote(op)` with the merge rules above, plus tests that
   replay interleaved ops from two libraries and compare the results.
4. Sync loop in the engine; settings UI for the bucket and credentials
   (stored in `ConfigStore`, never in the library).
5. Lazy blob fetch in the `/blobs` and `/thumbs` routes.
6. Snapshots and segment garbage collection.
7. Optional encryption.
