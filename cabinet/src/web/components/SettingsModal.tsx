import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, FolderOpen, Import, KeyRound, Monitor, Moon, Puzzle, Sparkles, Sun, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { copyText } from "../actions";
import { api } from "../api";
import { formatBytes } from "../lib/format";
import { useInfo, useSettings } from "../queries";
import { errorToast, setState, toast, useUi, type Theme } from "../store";
import { importBookmarksFlow } from "./TopBar";

const TABS: { id: string; label: string; icon: ReactNode }[] = [
  { id: "general", label: "General", icon: <Monitor size={15} /> },
  { id: "ai", label: "AI", icon: <Sparkles size={15} /> },
  { id: "capture", label: "Browser extension", icon: <Puzzle size={15} /> },
  { id: "data", label: "Import & export", icon: <Import size={15} /> },
];

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="setting-toggle">
      <div>
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <button type="button" role="switch" aria-checked={checked} className={`switch${checked ? " on" : ""}`} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </label>
  );
}

function General() {
  const { data: info } = useInfo();
  const { data: settings } = useSettings();
  const theme = useUi((s) => s.theme);
  const qc = useQueryClient();
  const save = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    try {
      qc.setQueryData(["settings"], await api.updateSettings(patch));
    } catch (err) {
      errorToast(err);
    }
  };
  const themes: { id: Theme; label: string; icon: ReactNode }[] = [
    { id: "system", label: "System", icon: <Monitor size={14} /> },
    { id: "light", label: "Light", icon: <Sun size={14} /> },
    { id: "dark", label: "Dark", icon: <Moon size={14} /> },
  ];
  return (
    <>
      <section className="settings-section">
        <h3>Appearance</h3>
        <div className="segmented wide">
          {themes.map((t) => (
            <button key={t.id} className={theme === t.id ? "is-active" : ""} onClick={() => setState({ theme: t.id })}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <h3>Library</h3>
        <div className="setting-path">
          <code>{info?.path}</code>
          {info?.capabilities.desktop && (
            <button className="button small" onClick={() => void api.reveal()}>
              <FolderOpen size={14} /> Show
            </button>
          )}
          {window.cabinetDesktop && (
            <button className="button small" onClick={() => void window.cabinetDesktop!.chooseLibrary()} title="Open or create a library in another folder. Cabinet restarts.">
              Change…
            </button>
          )}
        </div>
        <p className="setting-hint">
          {info ? `${info.itemCount.toLocaleString()} items · ${info.blobCount.toLocaleString()} files · ${formatBytes(info.blobBytes)}` : ""}. Everything lives in this folder on your
          computer: a SQLite database plus your original files. Back it up like any other folder.
        </p>
      </section>
      {settings && (
        <section className="settings-section">
          <h3>Saving</h3>
          <Toggle
            checked={settings.fetchLinkPreviews}
            onChange={(v) => void save({ fetchLinkPreviews: v })}
            label="Fetch link previews"
            hint="Visit saved links to read their title, image and article text. Nothing else is sent anywhere."
          />
          <Toggle checked={settings.autoTag} onChange={(v) => void save({ autoTag: v })} label="Tag from page keywords" hint="Use the keywords a page declares as tags." />
          <label className="setting-toggle">
            <div>
              <div className="setting-label">Empty trash after</div>
              <div className="setting-hint">Items in the trash are deleted for good after this many days. 0 keeps them until you empty it.</div>
            </div>
            <input
              className="number-input"
              type="number"
              min={0}
              max={3650}
              defaultValue={settings.trashRetentionDays}
              onBlur={(e) => void save({ trashRetentionDays: Number(e.target.value) || 0 })}
            />
          </label>
        </section>
      )}
    </>
  );
}

function Ai() {
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const save = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    try {
      qc.setQueryData(["settings"], await api.updateSettings(patch));
    } catch (err) {
      errorToast(err);
    }
  };
  if (!settings) return null;
  return (
    <>
      <section className="settings-section">
        <h3>AI tagging and descriptions</h3>
        <p className="setting-hint">
          When on, Cabinet asks Claude to tag each new item, summarise articles and notes, and describe images (including any text in them) so you can find
          things by what they show. The item's text and a small copy of its image are sent to Anthropic's API using your own key. Everything else stays on your
          computer.
        </p>
        <Toggle checked={settings.aiEnabled} onChange={(v) => void save({ aiEnabled: v })} label="Enable AI" hint={settings.aiKeySet ? "Your key is saved on this device." : "Add an API key below first."} />
      </section>
      <section className="settings-section">
        <h3>
          <KeyRound size={14} /> Anthropic API key
        </h3>
        <div className="inline-form">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={settings.aiKeySet ? "•••••••••••• (saved)" : "sk-ant-…"} autoComplete="off" />
          <button
            className="button primary"
            disabled={!key.trim()}
            onClick={async () => {
              await save({ aiKey: key.trim() });
              setKey("");
              toast("API key saved on this device");
            }}
          >
            Save
          </button>
          {settings.aiKeySet && (
            <button className="button" onClick={() => void save({ aiKey: null, aiEnabled: false })}>
              Remove
            </button>
          )}
        </div>
        <p className="setting-hint">
          Get a key at console.anthropic.com. It is stored in this computer's app settings, never inside the library folder, so it is not copied if you sync or
          share your library.
        </p>
      </section>
      <section className="settings-section">
        <h3>Model</h3>
        <div className="segmented wide">
          {settings.models.map((m) => (
            <button key={m.id} className={settings.aiModel === m.id ? "is-active" : ""} onClick={() => void save({ aiModel: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="setting-hint">Opus gives the best tags and descriptions. Sonnet and Haiku are faster and cost less per item.</p>
        <div className="inline-form">
          <button
            className="button"
            disabled={testing || (!settings.aiKeySet && !key)}
            onClick={async () => {
              setTesting(true);
              try {
                const r = await api.testAi(key || undefined, settings.aiModel);
                toast(`It works. Example tags: ${r.tags.join(", ")}`, { duration: 6000 });
              } catch (err) {
                errorToast(err);
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? <span className="spinner small" /> : <Check size={14} />} Test connection
          </button>
          <button
            className="button"
            disabled={!settings.aiEnabled || !settings.aiKeySet}
            onClick={async () => {
              try {
                const r = await api.aiBackfill();
                toast(r.queued ? `Analysing ${r.queued.toLocaleString()} existing items in the background` : "Everything is already analysed");
              } catch (err) {
                errorToast(err);
              }
            }}
          >
            <Sparkles size={14} /> Analyse existing items
          </button>
        </div>
      </section>
    </>
  );
}

function Capture() {
  const { data: info } = useInfo();
  const [shown, setShown] = useState(false);
  return (
    <>
      <section className="settings-section">
        <h3>Save from your browser</h3>
        <p className="setting-hint">
          The Cabinet extension adds “Save to Cabinet” to the right-click menu for pages, links, images, videos and selected text, and a toolbar button that
          saves the current page with a snapshot. Hold ⌥ Option and click any image to save it instantly.
        </p>
        <ol className="steps">
          <li>
            Open <code>chrome://extensions</code> (or Edge, Brave, Arc) and turn on <b>Developer mode</b>.
          </li>
          <li>
            Click <b>Load unpacked</b> and choose the <code>extension</code> folder inside the Cabinet source folder.
          </li>
          <li>Open the extension's options and paste the address and key below.</li>
        </ol>
      </section>
      <section className="settings-section">
        <h3>Connection</h3>
        <div className="kv">
          <span>Address</span>
          <code>http://127.0.0.1:{info?.port}</code>
          <button className="icon-button tiny" onClick={() => void copyText(`http://127.0.0.1:${info?.port}`)} aria-label="Copy address">
            <Copy size={13} />
          </button>
        </div>
        <div className="kv">
          <span>Key</span>
          <code className="token">{shown ? info?.token : "••••••••••••••••••••"}</code>
          <button className="button small" onClick={() => setShown(!shown)}>
            {shown ? "Hide" : "Show"}
          </button>
          <button className="icon-button tiny" onClick={() => void copyText(info?.token ?? "", "Key copied")} aria-label="Copy key">
            <Copy size={13} />
          </button>
        </div>
        <p className="setting-hint">Cabinet only listens on this computer (127.0.0.1). The key stops other websites from adding things to your library.</p>
      </section>
    </>
  );
}

function Data() {
  return (
    <>
      <section className="settings-section">
        <h3>Import bookmarks</h3>
        <p className="setting-hint">
          Bring in bookmarks exported from Chrome, Safari, Firefox or Edge (HTML), or a CSV from Pocket, Raindrop, Instapaper or a spreadsheet (needs a
          <code>url</code> column). Folders become tags. Previews are fetched in the background.
        </p>
        <button className="button" onClick={() => void importBookmarksFlow()}>
          <Import size={14} /> Choose a file…
        </button>
      </section>
      <section className="settings-section">
        <h3>Export</h3>
        <p className="setting-hint">Download every item's details, tags and collections as JSON. Original files stay in the library's blobs folder.</p>
        <a className="button" href="/api/export" download>
          <Download size={14} /> Export as JSON
        </a>
      </section>
      <section className="settings-section">
        <h3>Sync</h3>
        <p className="setting-hint">
          Your library is a normal folder, and every change is recorded with a timestamp so libraries can be merged across devices. Cloud sync (S3 and
          compatible storage) is planned; see docs/SYNC.md.
        </p>
      </section>
    </>
  );
}

export function SettingsModal() {
  const open = useUi((s) => s.settingsOpen);
  const tab = useUi((s) => s.settingsTab);
  useEffect(() => {
    if (!open) return;
    // Capture phase: Escape closes settings only, not an item open behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".dialog")) return;
      e.stopPropagation();
      setState({ settingsOpen: false });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={() => setState({ settingsOpen: false })}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-nav">
          <div className="settings-title">Settings</div>
          {TABS.map((t) => (
            <button key={t.id} className={`nav-row${tab === t.id ? " is-active" : ""}`} onClick={() => setState({ settingsTab: t.id })}>
              <span className="nav-icon">{t.icon}</span>
              <span className="nav-label">{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <button className="icon-button settings-close" onClick={() => setState({ settingsOpen: false })} aria-label="Close settings">
            <X size={17} />
          </button>
          {tab === "general" && <General />}
          {tab === "ai" && <Ai />}
          {tab === "capture" && <Capture />}
          {tab === "data" && <Data />}
        </div>
      </div>
    </div>
  );
}
