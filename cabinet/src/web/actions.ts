import { api } from "./api";
import { confirmDialog } from "./components/Dialogs";
import { isUrl, plural } from "./lib/format";
import { queryClient } from "./queries";
import { errorToast, getState, setState, toast } from "./store";

function currentCollection(): string | null {
  const s = getState().scope;
  return s.type === "collection" ? s.id : null;
}

function refreshLists(): void {
  void queryClient.invalidateQueries({ queryKey: ["items"] });
  void queryClient.invalidateQueries({ queryKey: ["facets"] });
  void queryClient.invalidateQueries({ queryKey: ["collections"] });
}

export async function saveText(text: string, opts: { open?: boolean } = {}): Promise<string | null> {
  const value = text.trim();
  if (!value) return null;
  try {
    const collectionId = currentCollection() ?? undefined;
    const res = isUrl(value)
      ? await api.create({ url: value, collectionId, source: "app" })
      : await api.create({ kind: "note", body: text, collectionId, source: "app" });
    refreshLists();
    if (res.duplicate) {
      toast("Already in your cabinet", { action: { label: "Show", run: () => setState({ openItemId: res.id }) } });
    } else {
      toast(isUrl(value) ? "Link saved" : "Note saved");
    }
    if (opts.open) setState({ openItemId: res.id });
    return res.id;
  } catch (err) {
    errorToast(err);
    return null;
  }
}

export async function uploadFiles(files: File[]): Promise<string[]> {
  if (!files.length) return [];
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > 30 * 1024 * 1024) toast(`Saving ${plural(files.length, "file")}…`);
  try {
    const { ids } = await api.upload(files, { collectionId: currentCollection() });
    refreshLists();
    toast(files.length === 1 ? "Saved" : `Saved ${plural(ids.length, "item")}`);
    return ids;
  } catch (err) {
    errorToast(err);
    return [];
  }
}

/** Handles anything dropped or pasted into the window. */
export async function saveTransfer(data: DataTransfer): Promise<void> {
  const files = Array.from(data.files ?? []);
  if (files.length) {
    await uploadFiles(files);
    return;
  }
  const html = data.getData("text/html");
  const uriList = data.getData("text/uri-list");
  const text = data.getData("text/plain");
  // An image dragged from a web page arrives as HTML with an <img>.
  const imgSrc = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
  if (imgSrc && /^(https?:|data:image\/)/.test(imgSrc)) {
    try {
      const res = await api.create({ kind: "image", src: imgSrc, pageUrl: uriList && isUrl(uriList.split("\n")[0]) && uriList.split("\n")[0] !== imgSrc ? uriList.split("\n")[0] : undefined, collectionId: currentCollection() ?? undefined });
      refreshLists();
      toast(res.duplicate ? "Already saved" : "Image saved");
      return;
    } catch {
      // fall back to saving the link
    }
  }
  const urls = (uriList || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && isUrl(l));
  if (urls.length > 1) {
    for (const u of urls) await api.create({ url: u, collectionId: currentCollection() ?? undefined, source: "app" }).catch(() => null);
    refreshLists();
    toast(`Saved ${plural(urls.length, "link")}`);
    return;
  }
  const value = urls[0] ?? text;
  if (value) await saveText(value);
}

export async function trashItems(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await api.bulk("trash", ids);
    setState((s) => ({ selection: new Set([...s.selection].filter((id) => !ids.includes(id))), openItemId: ids.includes(s.openItemId ?? "") ? null : s.openItemId }));
    refreshLists();
    toast(ids.length === 1 ? "Moved to trash" : `Moved ${plural(ids.length, "item")} to trash`, {
      action: {
        label: "Undo",
        run: async () => {
          await api.bulk("restore", ids);
          refreshLists();
        },
      },
    });
  } catch (err) {
    errorToast(err);
  }
}

export async function restoreItems(ids: string[]): Promise<void> {
  await api.bulk("restore", ids);
  refreshLists();
  toast(ids.length === 1 ? "Restored" : `Restored ${plural(ids.length, "item")}`);
}

export async function purgeItems(ids: string[]): Promise<void> {
  const ok = await confirmDialog({
    title: ids.length === 1 ? "Delete forever?" : `Delete ${ids.length} items forever?`,
    message: "This removes the files from your library and cannot be undone.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  await api.bulk("purge", ids);
  setState({ selection: new Set(), openItemId: null });
  refreshLists();
}

export async function addToCollection(collectionId: string, ids: string[], name?: string): Promise<void> {
  try {
    await api.bulk("collect", ids, { collectionId });
    refreshLists();
    toast(`Added ${ids.length === 1 ? "" : `${ids.length} items `}to ${name ?? "collection"}`);
  } catch (err) {
    errorToast(err);
  }
}

export async function setPinned(ids: string[], pinned: boolean): Promise<void> {
  await api.bulk(pinned ? "pin" : "unpin", ids);
  refreshLists();
  toast(pinned ? "Pinned to Top of Mind" : "Removed from Top of Mind");
}

export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyText(text: string, label = "Copied"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    errorToast("Could not copy to the clipboard");
  }
}

export function refreshAll(): void {
  refreshLists();
  void queryClient.invalidateQueries({ queryKey: ["tags"] });
}

/** Opens the system file picker and saves the chosen files. */
export function pickFiles(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = () => void uploadFiles(Array.from(input.files ?? []));
  input.click();
}
