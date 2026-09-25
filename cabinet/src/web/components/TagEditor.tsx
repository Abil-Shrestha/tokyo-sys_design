import { Sparkles, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ItemTag } from "../../shared/types";
import { normalizeTag } from "../../shared/query";
import { useTags } from "../queries";
import { setState } from "../store";

export function TagEditor({ tags, onChange }: { tags: ItemTag[]; onChange: (names: string[]) => void }) {
  const [value, setValue] = useState("");
  const [focus, setFocus] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const { data: all = [] } = useTags();
  const inputRef = useRef<HTMLInputElement>(null);
  const names = tags.map((t) => t.name);

  const suggestions = useMemo(() => {
    const v = normalizeTag(value);
    if (!v) return [];
    return all
      .filter((t) => t.name.includes(v) && !names.includes(t.name))
      .sort((a, b) => Number(b.name.startsWith(v)) - Number(a.name.startsWith(v)) || b.count - a.count)
      .slice(0, 6);
  }, [value, all, names]);

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    setValue("");
    setHighlight(-1);
    if (!tag || names.includes(tag)) return;
    onChange([...names, tag]);
  };

  const mine = tags.filter((t) => t.source === "user");
  const machine = tags.filter((t) => t.source !== "user");

  return (
    <div className="tag-editor">
      <div className="tag-list">
        {mine.map((t) => (
          <span key={t.name} className="tag">
            <button className="tag-name" onClick={() => setState({ query: `#${t.name}`, scope: { type: "all" }, openItemId: null })}>
              {t.name}
            </button>
            <button className="tag-remove" onClick={() => onChange(names.filter((n) => n !== t.name))} aria-label={`Remove ${t.name}`}>
              <X size={11} />
            </button>
          </span>
        ))}
        {machine.map((t) => (
          <span key={t.name} className="tag tag-machine" title={t.source === "ai" ? "Added by AI" : "From the page"}>
            {t.source === "ai" && <Sparkles size={10} />}
            <button className="tag-name" onClick={() => setState({ query: `#${t.name}`, scope: { type: "all" }, openItemId: null })}>
              {t.name}
            </button>
            <button className="tag-remove" onClick={() => onChange(names.filter((n) => n !== t.name))} aria-label={`Remove ${t.name}`}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-input"
          value={value}
          placeholder={tags.length ? "Add tag" : "Add a tag…"}
          onChange={(e) => {
            setValue(e.target.value);
            setHighlight(-1);
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setTimeout(() => setFocus(false), 120);
            if (value.trim()) add(value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
              if (!value.trim()) return;
              e.preventDefault();
              add(highlight >= 0 && suggestions[highlight] ? suggestions[highlight].name : value);
            } else if (e.key === "Backspace" && !value && names.length) {
              onChange(names.slice(0, -1));
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(suggestions.length - 1, h + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(-1, h - 1));
            } else if (e.key === "Escape") {
              setValue("");
              inputRef.current?.blur();
            }
          }}
        />
      </div>
      {focus && suggestions.length > 0 && (
        <div className="tag-suggestions">
          {suggestions.map((s, i) => (
            <button key={s.name} className={i === highlight ? "is-active" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => add(s.name)}>
              {s.name}
              <span className="muted">{s.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
