import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { faClipboard, faEllipsis, faThumbtack, faTrashCan, faXmark } from "@fortawesome/free-solid-svg-icons";
import { invoke } from "@tauri-apps/api/core";
import { FontAwesomeIcon as Icon } from "@fortawesome/react-fontawesome";
// Même feuille de style que Powernux pour garder une apparence cohérente.
import "../../../src/styles.css";

interface ClipItem {
  id: number;
  text: string;
  pinned: boolean;
  timestamp: number;
}

const CLIPBOARD_UPDATED = "clipboard://updated";
const CLIPBOARD_SHOWN = "clipboard://shown";

const api = {
  history: () => invoke<ClipItem[]>("history"),
  use: (id: number) => invoke<void>("use_item", { id }),
  remove: (id: number) => invoke<void>("delete_item", { id }),
  togglePin: (id: number) => invoke<void>("toggle_pin", { id }),
  clear: () => invoke<void>("clear"),
  hidePopup: () => invoke<void>("hide"),
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "À l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `Il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Il y a ${h} h`;
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Fenêtre flottante du presse-papiers (ouverte par le raccourci clavier). */
export default function Popup() {
  const [items, setItems] = useState<ClipItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [menu, setMenu] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => api.history().then(setItems), []);

  useEffect(() => {
    refresh();
    const subs = [
      listen(CLIPBOARD_UPDATED, refresh),
      listen(CLIPBOARD_SHOWN, () => {
        refresh();
        setSelected(0);
        setMenu(null);
        listRef.current?.scrollTo({ top: 0 });
        listRef.current?.focus();
      }),
      // Comme sous Windows : la fenêtre se ferme quand elle perd le focus.
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (!focused) api.hidePopup();
      }),
    ];
    return () => {
      subs.forEach((p) => p.then((f) => f()));
    };
  }, [refresh]);

  useEffect(() => {
    if (selected >= items.length) setSelected(Math.max(0, items.length - 1));
  }, [items, selected]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (menu !== null) setMenu(null);
      else api.hidePopup();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && items[selected]) {
      api.use(items[selected].id);
    } else if (e.key === "Delete" && items[selected]) {
      api.remove(items[selected].id);
    }
  };

  return (
    <div className="popup" onKeyDown={onKey} onClick={() => setMenu(null)}>
      <header className="popup-header" data-tauri-drag-region>
        <div className="popup-title" data-tauri-drag-region>
          <Icon icon={faClipboard} /> Presse-papiers
        </div>
        <button className="icon-btn" onClick={() => api.hidePopup()} title="Fermer">
          <Icon icon={faXmark} />
        </button>
      </header>

      <div className="popup-sub">
        <span className="muted">Historique</span>
        <button className="btn secondary small" disabled={!items.some((i) => !i.pinned)} onClick={() => api.clear()}>
          Tout effacer
        </button>
      </div>

      <div className="popup-list" ref={listRef} tabIndex={0}>
        {items.length === 0 && (
          <div className="popup-empty">
            <Icon icon={faClipboard} size="2x" />
            <p>Rien ici pour l'instant.</p>
            <p className="muted">Les éléments que vous copiez apparaîtront ici.</p>
          </div>
        )}
        {items.map((item, index) => (
          <div
            key={item.id}
            data-index={index}
            className={`clip ${index === selected ? "selected" : ""}`}
            onMouseEnter={() => setSelected(index)}
            onClick={() => api.use(item.id)}
          >
            <p className="clip-text">{item.text}</p>
            <div className="clip-footer">
              <span className="muted">{timeAgo(item.timestamp)}</span>
              <button
                className={`icon-btn ${item.pinned ? "pinned" : ""}`}
                title={item.pinned ? "Désépingler" : "Épingler"}
                onClick={(e) => {
                  e.stopPropagation();
                  api.togglePin(item.id);
                }}
              >
                <Icon icon={faThumbtack} />
              </button>
            </div>
            <button
              className="icon-btn clip-menu-btn"
              title="Plus d'options"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(menu === item.id ? null : item.id);
              }}
            >
              <Icon icon={faEllipsis} />
            </button>
            {menu === item.id && (
              <div className="clip-menu" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => {
                    api.togglePin(item.id);
                    setMenu(null);
                  }}
                >
                  <Icon icon={faThumbtack} fixedWidth /> {item.pinned ? "Désépingler" : "Épingler"}
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    api.remove(item.id);
                    setMenu(null);
                  }}
                >
                  <Icon icon={faTrashCan} fixedWidth /> Supprimer
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
