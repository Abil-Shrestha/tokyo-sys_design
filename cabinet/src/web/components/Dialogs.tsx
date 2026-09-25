import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Promise-based prompt/confirm dialogs (Electron does not implement
// window.prompt, and native dialogs look out of place anyway).

interface DialogState {
  kind: "prompt" | "confirm";
  title: string;
  message?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (value: string | boolean | null) => void;
}

let current: DialogState | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Resolves with the text entered ("" if left empty), or null if cancelled. */
export function promptText(opts: { title: string; message?: string; initial?: string; placeholder?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    current = { kind: "prompt", ...opts, resolve: (v) => resolve(typeof v === "string" ? v : null) };
    notify();
  });
}

export function confirmDialog(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    current = { kind: "confirm", ...opts, resolve: (v) => resolve(v === true) };
    notify();
  });
}

function close(value: string | boolean | null) {
  const c = current;
  current = null;
  notify();
  c?.resolve(value);
}

export function DialogHost() {
  const state = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!state) return;
    setValue(state.initial ?? "");
    setTimeout(() => {
      if (state.kind === "prompt") {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else buttonRef.current?.focus();
    }, 20);
  }, [state]);

  if (!state) return null;
  const submit = () => close(state.kind === "prompt" ? value.trim() : true);
  return (
    <div className="dialog-backdrop" onMouseDown={() => close(state.kind === "prompt" ? null : false)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") close(state.kind === "prompt" ? null : false);
        }}
      >
        <h2>{state.title}</h2>
        {state.message && <p>{state.message}</p>}
        {state.kind === "prompt" && <input ref={inputRef} value={value} placeholder={state.placeholder} onChange={(e) => setValue(e.target.value)} />}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => close(state.kind === "prompt" ? null : false)}>
            Cancel
          </button>
          <button ref={buttonRef} type="submit" className={`button ${state.danger ? "danger" : "primary"}`}>
            {state.confirmLabel ?? (state.kind === "prompt" ? "Save" : "OK")}
          </button>
        </div>
      </form>
    </div>
  );
}
