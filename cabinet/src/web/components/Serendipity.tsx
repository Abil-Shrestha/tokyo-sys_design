import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Heart, Maximize2, Pin, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { trashItems } from "../actions";
import { api, blobUrl, thumb } from "../api";
import { isEditable, relativeTime } from "../lib/format";
import { getState, setState, toast } from "../store";
import { Card } from "./Card";

/** A slow, one-at-a-time walk through things you saved and forgot about. */
export function Serendipity() {
  const { data, refetch, isFetching } = useQuery({ queryKey: ["serendipity"], queryFn: () => api.serendipity(30), staleTime: Infinity });
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const items = data ?? [];
  const item = items[index];

  const advance = () => {
    setVisible(false);
    setTimeout(() => {
      if (index + 1 >= items.length) {
        setIndex(0);
        void refetch();
      } else setIndex(index + 1);
      setVisible(true);
    }, 280);
  };

  const forget = async () => {
    if (!item) return;
    await trashItems([item.id]);
    advance();
  };

  const pin = async () => {
    if (!item) return;
    await api.update(item.id, { pinned: true });
    toast("Pinned to Top of Mind");
    advance();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getState();
      if (isEditable(e.target) || s.openItemId || s.paletteOpen || s.settingsOpen) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "k") advance();
      else if (e.key === "Backspace" || e.key === "f") void forget();
      else if (e.key === "Enter" && item) setState({ openItemId: item.id });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!item) {
    return (
      <div className="serendipity">
        <div className="empty">
          <h2>{isFetching ? "Looking back…" : "Nothing to rediscover yet"}</h2>
          {!isFetching && <p>Save a few things and come back later.</p>}
        </div>
      </div>
    );
  }

  const imageHash = item.kind === "image" ? item.asset : null;
  return (
    <div className="serendipity">
      <div className="serendipity-intro">
        <span className="serendipity-kicker">Serendipity</span>
        <span className="muted">Saved {relativeTime(item.createdAt)}. Keep it or let it go.</span>
      </div>
      <div className={`serendipity-stage${visible ? " is-visible" : ""}`} onDoubleClick={() => setState({ openItemId: item.id })}>
        {imageHash ? (
          <img className="serendipity-image" src={item.mime === "image/gif" ? blobUrl(imageHash) : thumb(imageHash, 1600)} alt="" />
        ) : (
          <div className="serendipity-card">
            <Card item={item} width={440} onOpen={() => setState({ openItemId: item.id })} />
          </div>
        )}
      </div>
      <div className="serendipity-actions">
        <button className="button" onClick={() => void forget()} title="Move to trash (F)">
          <Trash2 size={15} /> Forget
        </button>
        <button className="button" onClick={() => void pin()} title="Pin to Top of Mind">
          <Pin size={15} /> Pin
        </button>
        <button className="button" onClick={() => setState({ openItemId: item.id })} title="Open (Enter)">
          <Maximize2 size={15} /> Open
        </button>
        <button className="button primary" onClick={advance} title="Keep and see the next one (→)">
          <Heart size={15} /> Keep <ArrowRight size={15} />
        </button>
      </div>
      <div className="serendipity-progress">
        {index + 1} / {items.length}
      </div>
    </div>
  );
}
