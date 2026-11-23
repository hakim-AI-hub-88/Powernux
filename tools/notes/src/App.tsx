import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FontAwesomeIcon as Icon } from "@fortawesome/react-fontawesome";
import {
  faBold,
  faBook,
  faCheck,
  faCode,
  faEye,
  faHeading,
  faItalic,
  faListCheck,
  faListUl,
  faMagnifyingGlass,
  faMinus,
  faNoteSticky,
  faPen,
  faPlus,
  faQuoteLeft,
  faThumbtack,
  faTrashCan,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { faWindowMaximize } from "@fortawesome/free-regular-svg-icons";
import { makeT, type Lang } from "./i18n";
import { renderMarkdown, snippet, stats, toggleTask } from "./markdown";
// Même charte que Powernux (couleurs, thème clair/sombre), puis styles propres aux notes.
import "../../../src/styles.css";
import "./notes.css";

interface Notebook {
  id: string;
  name: string;
}
interface Note {
  id: string;
  notebookId: string | null;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}
interface Store {
  notebooks: Notebook[];
  notes: Note[];
}
type Filter = { kind: "all" } | { kind: "pinned" } | { kind: "notebook"; id: string };

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const win = getCurrentWindow();

export default function App() {
  const [lang, setLang] = useState<Lang>("en");
  const t = useMemo(() => makeT(lang), [lang]);
  const [store, setStore] = useState<Store | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingNotebook, setAddingNotebook] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    invoke<string>("ui_language").then((l) => setLang(l === "fr" ? "fr" : "en"));
    invoke<Store>("load_store").then((s) => {
      setStore(s);
      const first = [...s.notes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (first) setSelected(first.id);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Enregistrement automatique (300 ms après la dernière modification).
  const persist = useCallback((next: Store) => {
    setStore(next);
    setSaving(true);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      invoke("save_store", { store: next }).finally(() => setSaving(false));
    }, 300);
  }, []);

  const notes = useMemo(() => {
    if (!store) return [];
    const q = query.trim().toLowerCase();
    return store.notes
      .filter((n) =>
        filter.kind === "pinned" ? n.pinned : filter.kind === "notebook" ? n.notebookId === filter.id : true,
      )
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [store, filter, query]);

  const current = store?.notes.find((n) => n.id === selected) ?? null;

  const updateNote = (id: string, patch: Partial<Note>) => {
    if (!store) return;
    persist({
      ...store,
      notes: store.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)),
    });
  };

  const createNote = () => {
    if (!store) return;
    const now = Date.now();
    const note: Note = {
      id: newId(),
      notebookId: filter.kind === "notebook" ? filter.id : null,
      title: "",
      content: "",
      pinned: filter.kind === "pinned",
      createdAt: now,
      updatedAt: now,
    };
    persist({ ...store, notes: [note, ...store.notes] });
    setSelected(note.id);
    setPreview(false);
    setQuery("");
    setTimeout(() => document.getElementById("nt-title")?.focus(), 0);
  };

  const deleteNote = (id: string) => {
    if (!store) return;
    persist({ ...store, notes: store.notes.filter((n) => n.id !== id) });
    setSelected(notes.find((n) => n.id !== id)?.id ?? null);
  };

  const addNotebook = (name: string) => {
    if (!store || !name.trim()) return;
    const nb = { id: newId(), name: name.trim() };
    persist({ ...store, notebooks: [...store.notebooks, nb] });
    setFilter({ kind: "notebook", id: nb.id });
  };

  const renameNotebook = (id: string, name: string) => {
    if (!store || !name.trim()) return;
    persist({ ...store, notebooks: store.notebooks.map((nb) => (nb.id === id ? { ...nb, name: name.trim() } : nb)) });
  };

  // Supprimer un carnet garde ses notes (elles passent dans « Aucun carnet »).
  const deleteNotebook = (id: string) => {
    if (!store) return;
    persist({
      notebooks: store.notebooks.filter((nb) => nb.id !== id),
      notes: store.notes.map((n) => (n.notebookId === id ? { ...n, notebookId: null } : n)),
    });
    setFilter({ kind: "all" });
  };

  // Mise en forme : préfixe de ligne (titres, listes) ou entoure la sélection (gras, code…).
  const format = (kind: "h1" | "h2" | "bold" | "italic" | "bullet" | "task" | "code" | "quote") => {
    const el = editorRef.current;
    if (!el || !current) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const wrap = { bold: "**", italic: "*", code: "`" } as Record<string, string>;
    let next: string;
    let cursor: number;
    if (kind in wrap) {
      const w = wrap[kind];
      next = value.slice(0, s) + w + value.slice(s, e) + w + value.slice(e);
      cursor = e + w.length * 2;
    } else {
      const prefix = { h1: "# ", h2: "## ", bullet: "- ", task: "- [ ] ", quote: "> " }[kind as "h1"]!;
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      cursor = e + prefix.length;
    }
    updateNote(current.id, { content: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  // Entrée dans une liste : continue la liste (« - », « - [ ] », « 1. »).
  const onEditorKey = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key !== "Enter" || !current) return;
    const el = ev.currentTarget;
    const { selectionStart: s, value } = el;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const line = value.slice(lineStart, s);
    const m = /^(\s*)(- \[[ xX]\] |[-*] |(\d+)\. )(.*)$/.exec(line);
    if (!m) return;
    ev.preventDefault();
    if (!m[4].trim()) {
      // Ligne de liste vide : on sort de la liste.
      const next = value.slice(0, lineStart) + value.slice(s);
      updateNote(current.id, { content: next });
      requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
      return;
    }
    const bullet = m[3] ? `${Number(m[3]) + 1}. ` : m[2].startsWith("- [") ? "- [ ] " : m[2];
    const insert = `\n${m[1]}${bullet}`;
    const next = value.slice(0, s) + insert + value.slice(s);
    updateNote(current.id, { content: next });
    requestAnimationFrame(() => el.setSelectionRange(s + insert.length, s + insert.length));
  };

  // Raccourcis : Ctrl+N nouvelle note, Ctrl+F recherche, Ctrl+E aperçu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      if (e.key === "n") {
        e.preventDefault();
        createNote();
      } else if (e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "e") {
        e.preventDefault();
        setPreview((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const when = (ts: number) => {
    const min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return t("justNow");
    if (min < 60) return t("minutesAgo", { n: min });
    if (min < 24 * 60) return t("hoursAgo", { n: Math.floor(min / 60) });
    return new Date(ts).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short" });
  };

  if (!store) return null;
  const count = (f: Filter) =>
    store.notes.filter((n) => (f.kind === "pinned" ? n.pinned : f.kind === "notebook" ? n.notebookId === f.id : true))
      .length;
  const st = current ? stats(current.content) : null;

  return (
    <div className="nt-app">
      <header className="nt-titlebar" data-tauri-drag-region>
        <span className="nt-app-name" data-tauri-drag-region>
          <Icon icon={faNoteSticky} /> {t("appName")}
        </span>
        <div className="titlebar-buttons">
          <button onClick={() => win.minimize()} title={t("minimize")}>
            <Icon icon={faMinus} />
          </button>
          <button onClick={() => win.toggleMaximize()} title={t("maximize")}>
            <Icon icon={faWindowMaximize} />
          </button>
          <button className="close" onClick={() => win.close()} title={t("close")}>
            <Icon icon={faXmark} />
          </button>
        </div>
      </header>

      <div className="nt-body">
        {/* Carnets */}
        <aside className="nt-sidebar">
          <div className="search-wrap">
            <Icon icon={faMagnifyingGlass} />
            <input ref={searchRef} className="search" placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <nav>
            <button className={`nt-nav ${filter.kind === "all" ? "active" : ""}`} onClick={() => setFilter({ kind: "all" })}>
              <Icon icon={faNoteSticky} fixedWidth /> <span>{t("all")}</span>
              <em>{count({ kind: "all" })}</em>
            </button>
            <button className={`nt-nav ${filter.kind === "pinned" ? "active" : ""}`} onClick={() => setFilter({ kind: "pinned" })}>
              <Icon icon={faThumbtack} fixedWidth /> <span>{t("pinned")}</span>
              <em>{count({ kind: "pinned" })}</em>
            </button>
          </nav>
          <div className="nt-section">
            <span>{t("notebooks")}</span>
            <button className="icon-btn" title={t("newNotebook")} onClick={() => setAddingNotebook(true)}>
              <Icon icon={faPlus} />
            </button>
          </div>
          <nav>
            {store.notebooks.map((nb) =>
              renaming === nb.id ? (
                <InlineInput
                  key={nb.id}
                  initial={nb.name}
                  placeholder={t("notebookName")}
                  onDone={(name) => {
                    if (name) renameNotebook(nb.id, name);
                    setRenaming(null);
                  }}
                />
              ) : (
                <div key={nb.id} className="nt-notebook">
                  <button
                    className={`nt-nav ${filter.kind === "notebook" && filter.id === nb.id ? "active" : ""}`}
                    onClick={() => setFilter({ kind: "notebook", id: nb.id })}
                    onDoubleClick={() => setRenaming(nb.id)}
                  >
                    <Icon icon={faBook} fixedWidth /> <span>{nb.name}</span>
                    <em>{count({ kind: "notebook", id: nb.id })}</em>
                  </button>
                  <div className="nt-notebook-actions">
                    <button className="icon-btn" title={t("rename")} onClick={() => setRenaming(nb.id)}>
                      <Icon icon={faPen} />
                    </button>
                    <ConfirmIcon title={t("delete")} confirm={t("confirm")} onConfirm={() => deleteNotebook(nb.id)} />
                  </div>
                </div>
              ),
            )}
            {addingNotebook && (
              <InlineInput
                initial=""
                placeholder={t("notebookName")}
                onDone={(name) => {
                  addNotebook(name);
                  setAddingNotebook(false);
                }}
              />
            )}
          </nav>
        </aside>

        {/* Liste des notes */}
        <section className="nt-list">
          <button className="btn nt-new" onClick={createNote}>
            <Icon icon={faPlus} /> {t("newNote")}
          </button>
          <div className="nt-items">
            {notes.map((n) => (
              <button
                key={n.id}
                className={`nt-item ${n.id === selected ? "active" : ""}`}
                onClick={() => {
                  setSelected(n.id);
                  setPreview(false);
                }}
              >
                <div className="nt-item-title">
                  {n.pinned && <Icon icon={faThumbtack} className="nt-pin" />}
                  <strong>{n.title || t("untitled")}</strong>
                </div>
                <p>{snippet(n.content)}</p>
                <span className="nt-item-date">{when(n.updatedAt)}</span>
              </button>
            ))}
            {notes.length === 0 && (
              <div className="nt-empty">
                <Icon icon={faNoteSticky} size="2x" />
                <strong>{query ? t("noResult") : t("empty")}</strong>
                {!query && <span>{t("emptyHint")}</span>}
              </div>
            )}
          </div>
        </section>

        {/* Éditeur */}
        <main className="nt-editor">
          {current ? (
            <>
              <div className="nt-editor-head">
                <input
                  id="nt-title"
                  className="nt-title"
                  placeholder={t("titlePlaceholder")}
                  value={current.title}
                  onChange={(e) => updateNote(current.id, { title: e.target.value })}
                />
                <div className="nt-head-actions">
                  <select
                    className="select"
                    value={current.notebookId ?? ""}
                    onChange={(e) => updateNote(current.id, { notebookId: e.target.value || null })}
                  >
                    <option value="">{t("noNotebook")}</option>
                    {store.notebooks.map((nb) => (
                      <option key={nb.id} value={nb.id}>
                        {nb.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className={`icon-btn ${current.pinned ? "pinned" : ""}`}
                    title={current.pinned ? t("unpin") : t("pin")}
                    onClick={() => updateNote(current.id, { pinned: !current.pinned })}
                  >
                    <Icon icon={faThumbtack} />
                  </button>
                  <ConfirmIcon title={t("delete")} confirm={t("confirm")} onConfirm={() => deleteNote(current.id)} />
                </div>
              </div>

              <div className="nt-toolbar">
                {!preview && (
                  <>
                    <ToolButton icon={faHeading} label="H1" title={t("heading1")} onClick={() => format("h1")} />
                    <ToolButton icon={faHeading} label="H2" title={t("heading2")} onClick={() => format("h2")} small />
                    <ToolButton icon={faBold} title={t("bold")} onClick={() => format("bold")} />
                    <ToolButton icon={faItalic} title={t("italic")} onClick={() => format("italic")} />
                    <span className="nt-sep" />
                    <ToolButton icon={faListUl} title={t("bullet")} onClick={() => format("bullet")} />
                    <ToolButton icon={faListCheck} title={t("checklist")} onClick={() => format("task")} />
                    <ToolButton icon={faQuoteLeft} title={t("quote")} onClick={() => format("quote")} />
                    <ToolButton icon={faCode} title={t("code")} onClick={() => format("code")} />
                  </>
                )}
                <div className="grow" />
                <div className="segmented">
                  <button className={!preview ? "active" : ""} onClick={() => setPreview(false)}>
                    <Icon icon={faPen} /> {t("edit")}
                  </button>
                  <button className={preview ? "active" : ""} onClick={() => setPreview(true)}>
                    <Icon icon={faEye} /> {t("preview")}
                  </button>
                </div>
              </div>

              {preview ? (
                <article
                  className="nt-preview"
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    // Liens : ouverts dans le navigateur, jamais dans la fenêtre des notes.
                    const link = target.closest("a");
                    if (link) {
                      e.preventDefault();
                      invoke("open_url", { url: link.getAttribute("href") ?? "" });
                      return;
                    }
                    if (target instanceof HTMLInputElement && target.dataset.line) {
                      updateNote(current.id, { content: toggleTask(current.content, Number(target.dataset.line)) });
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(current.content) }}
                />
              ) : (
                <textarea
                  ref={editorRef}
                  className="nt-textarea"
                  placeholder={t("contentPlaceholder")}
                  value={current.content}
                  onKeyDown={onEditorKey}
                  onChange={(e) => updateNote(current.id, { content: e.target.value })}
                  spellCheck
                />
              )}

              <footer className="nt-footer">
                <span>{t("edited", { when: when(current.updatedAt) })}</span>
                <span>{t("words", { n: st!.words })}</span>
                {st!.total > 0 && <span>{t("tasks", { done: st!.done, total: st!.total })}</span>}
                <div className="grow" />
                <span className={saving ? "" : "nt-saved"}>
                  {saving ? t("saving") : <><Icon icon={faCheck} /> {t("saved")}</>}
                </span>
              </footer>
            </>
          ) : (
            <div className="nt-empty big">
              <Icon icon={faNoteSticky} size="3x" />
              <span>{t("selectNote")}</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  title,
  onClick,
  small,
}: {
  icon: typeof faBold;
  label?: string;
  title: string;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button className={`nt-tool ${small ? "small" : ""}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {label ? <span className="nt-tool-label">{label}</span> : <Icon icon={icon} />}
    </button>
  );
}

/** Champ de saisie en ligne (nouveau carnet, renommage) : Entrée valide, Échap annule. */
function InlineInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      className="search plain nt-inline"
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(value.trim());
        if (e.key === "Escape") onDone("");
      }}
    />
  );
}

/** Bouton corbeille avec confirmation au second clic. */
function ConfirmIcon({ title, confirm, onConfirm }: { title: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      className={`icon-btn nt-delete ${armed ? "armed" : ""}`}
      title={armed ? confirm : title}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) onConfirm();
        setArmed(!armed);
      }}
    >
      {armed ? <span className="nt-confirm">{confirm}</span> : <Icon icon={faTrashCan} />}
    </button>
  );
}
