import { ArrowUp, Link2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { saveText, uploadFiles } from "../actions";
import { isUrl } from "../lib/format";
import { setState, useUi } from "../store";

export const COMPOSER_HEIGHT = 168;

/** The first card in the grid: type a thought or paste a link and it's saved. */
export function Composer() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composing = useUi((s) => s.composing);

  useEffect(() => {
    if (composing) {
      ref.current?.focus();
      setState({ composing: false });
    }
  }, [composing]);

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const id = await saveText(text);
    setBusy(false);
    if (id) setText("");
  };

  const url = isUrl(text);
  return (
    <div className={`composer${text ? " has-text" : ""}`}>
      <div className="composer-label">{url ? "Save link" : "Add a new note"}</div>
      <textarea
        ref={ref}
        value={text}
        placeholder="Start typing, or paste a link…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") {
            setText("");
            (e.target as HTMLTextAreaElement).blur();
          }
          e.stopPropagation();
        }}
        onPaste={(e) => {
          // Files pasted here are saved as items, not inserted as text.
          if (e.clipboardData.files.length) {
            e.preventDefault();
            void uploadFiles(Array.from(e.clipboardData.files));
          }
          e.stopPropagation();
        }}
        aria-label="New note"
      />
      <div className="composer-actions">
        <button className="icon-button subtle" onClick={() => fileRef.current?.click()} title="Upload files" aria-label="Upload files">
          <Upload size={15} />
        </button>
        <span className="composer-hint">{text ? "⌘↵ to save" : ""}</span>
        <button className="composer-save" disabled={!text.trim() || busy} onClick={() => void save()} aria-label="Save">
          {url ? <Link2 size={15} /> : <ArrowUp size={15} />}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
