import { useEffect, useState } from "react";
import { faArrowLeft, faPowerOff, faTriangleExclamation, faXmark, faUser, faEye, faEyeSlash, faCheck, faPlus, faSpinner, faCode } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../components/Icons";
import ToolIcon, { iconByName } from "../components/ToolIcon";
import Toggle from "../components/Toggle";
import ConfirmButton from "../components/ConfirmButton";
import ShortcutRecorder from "../components/ShortcutRecorder";
import ToolControls, { statusOf, ToolStatusNotice } from "../components/ToolControls";
import { api, type CollectionDef, type CollectionItem, type DesktopApp, type FieldDef, type SettingDef, type Tool } from "../lib/api";
import { displayKeys } from "../lib/shortcut";
import { useTools } from "../state/tools";
import { useT, type Translate } from "../i18n";
import { toolText, useToolText } from "../lib/toolText";
import { useLang } from "../i18n";

/** Page d'un outil installé : ON/OFF, réglages et actions générés depuis son manifest. */
export default function ToolDetails({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, run, errors, clearError, progress } = useTools();
  const t = useT();
  const [devMode, setDevMode] = useState(false);
  const text = useToolText();
  const tool = data?.tools.find((x) => x.id === id);

  if (!tool) {
    return (
      <div className="page">
        <BackButton onBack={onBack} />
        <p className="muted">{t("tool.notFound")}</p>
      </div>
    );
  }

  const st = statusOf(tool, t);
  const tt = text(tool);
  const settingDefs = tool.manifest?.settings ?? [];
  const hasAdvanced = settingDefs.some((d) => d.advanced || d.options.some((o) => o.advanced));
  // Mode développeur : activé à la demande, ou d'office si une option avancée est déjà choisie.
  const usesAdvanced = settingDefs.some((d) =>
    d.options.some((o) => o.advanced && JSON.stringify(o.value) === JSON.stringify(tool.settings[d.key])),
  );
  const dev = devMode || usesAdvanced;
  const visibleSettings = settingDefs.filter(
    (d) =>
      (dev || !d.advanced) &&
      (!d.showIf || JSON.stringify(tool.settings[d.showIf.key] ?? null) === JSON.stringify(d.showIf.value)),
  );
  const busy = Boolean(progress[id]);

  return (
    <div className="page">
      <BackButton onBack={onBack} />

      <div className="card tool-hero">
        <div className="tool-icon big">
          <ToolIcon name={tool.icon} />
        </div>
        <div className="tool-body">
          <h1>{tt.name}</h1>
          <p className="muted">{tt.description}</p>
          <div className="tool-meta">
            <span>
              {t("tools.version")} <strong>{tool.installedVersion ?? tool.latestVersion ?? "—"}</strong>
            </span>
            <span>
              {t("tools.status")} <span className={`status status-${st.kind}`}>{st.label}</span>
            </span>
            {tool.author && (
              <span>
                <Icon icon={faUser} /> {tool.author}
              </span>
            )}
          </div>
        </div>
        <ToolControls tool={tool} showToggle={false} />
      </div>

      <ToolStatusNotice tool={tool} />

      {errors[id] && (
        <div className="notice error">
          <Icon icon={faTriangleExclamation} /> <span className="grow">{errors[id]}</span>
          <button className="icon-btn" onClick={() => clearError(id)}>
            <Icon icon={faXmark} />
          </button>
        </div>
      )}

      {tool.installed && tool.manifest && (
        <>
          <section>
            <h2>{t("tool.activation")}</h2>
            <div className="card settings-group">
              <div className="setting-row">
                <div className="setting-label">
                  <Icon icon={faPowerOff} fixedWidth />
                  <div>
                    <strong>{tt.name}</strong>
                    <p className="muted">
                      {t("tools.status")} {tool.enabled ? t("state.on") : t("state.off")}
                    </p>
                  </div>
                </div>
                <div className="onoff">
                  <span className={tool.enabled ? "on" : ""}>{tool.enabled ? t("state.on") : t("state.off")}</span>
                  <Toggle
                    checked={tool.enabled}
                    disabled={busy}
                    onChange={(v) => run(id, () => api.setEnabled(id, v))}
                  />
                </div>
              </div>
            </div>
          </section>

          {visibleSettings.length > 0 && (
            <section>
              <div className="section-head">
                <h2>{t("tool.settings")}</h2>
                {hasAdvanced && (
                  <button
                    className={`btn small ${dev ? "" : "secondary"}`}
                    disabled={usesAdvanced}
                    title={t("tool.devModeHint")}
                    onClick={() => setDevMode((v) => !v)}
                  >
                    <Icon icon={faCode} /> {dev ? t("tool.devModeOn") : t("tool.devMode")}
                  </button>
                )}
              </div>
              <div className="card settings-group">
                {visibleSettings.map((def) => (
                  <SettingRow key={def.key} tool={tool} def={def} disabled={busy} devMode={dev} />
                ))}
              </div>
            </section>
          )}

          {tool.manifest.collections.map((c) => (
            <CollectionSection key={c.id} tool={tool} def={c} />
          ))}

          {tool.manifest.actions.length > 0 && (
            <section>
              <h2>{t("tool.actions")}</h2>
              <div className="actions">
                {tool.manifest.actions.map((a) =>
                  a.confirm ? (
                    <ConfirmButton
                      key={a.id}
                      disabled={!tool.enabled}
                      confirmLabel={t("common.confirm")}
                      onConfirm={() => run(id, () => api.action(id, a.id))}
                    >
                      <Icon icon={iconByName(a.icon)} /> {tt.action(a)}
                    </ConfirmButton>
                  ) : (
                    <button
                      key={a.id}
                      className="btn"
                      disabled={!tool.enabled}
                      onClick={() => run(id, () => api.action(id, a.id))}
                    >
                      <Icon icon={iconByName(a.icon)} /> {tt.action(a)}
                    </button>
                  ),
                )}
              </div>
              {!tool.enabled && <p className="muted small-text">{t("tool.enableForActions")}</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <button className="back" onClick={onBack}>
      <Icon icon={faArrowLeft} /> {t("nav.tools")}
    </button>
  );
}

function SettingRow({ tool, def, disabled, devMode }: { tool: Tool; def: SettingDef; disabled: boolean; devMode: boolean }) {
  const { run, data } = useTools();
  const t = useT();
  const tt = toolText(tool, useLang());
  const label = tt.setting(def);
  const [warning, setWarning] = useState("");
  const value = tool.settings[def.key] ?? def.default;
  const save = (v: string | number | boolean) => run(tool.id, () => api.setSetting(tool.id, def.key, v));

  if (def.type === "shortcut") {
    const change = async (accel: string) => {
      if (accel === value) return;
      setWarning("");
      const conflict = await api.shortcutConflict(tool.id, accel);
      if (conflict) {
        setWarning(t("tool.shortcutTaken", { keys: displayKeys(accel).join(" + "), by: conflict }));
        return;
      }
      save(accel);
    };
    return (
      <div className="setting-row column">
        <div>
          <strong>{label.label}</strong>
          {label.description && <p className="muted">{label.description}</p>}
        </div>
        <ShortcutRecorder value={String(value)} disabled={disabled} onChange={change} />
        {warning && <p className="hint">{warning}</p>}
        {data && !data.gnome && <p className="hint">{t("tool.gnomeOnly")}</p>}
      </div>
    );
  }

  if (def.type === "text" || def.type === "secret") {
    return (
      <div className="setting-row column">
        <div>
          <strong>{label.label}</strong>
          {label.description && <p className="muted">{label.description}</p>}
        </div>
        <TextSetting value={String(value ?? "")} secret={def.type === "secret"} disabled={disabled} onSave={save} />
      </div>
    );
  }

  return (
    <div className="setting-row">
      <div>
        <strong>{label.label}</strong>
        {label.description && <p className="muted">{label.description}</p>}
      </div>
      {def.type === "toggle" && <Toggle checked={Boolean(value)} disabled={disabled} onChange={save} />}
      {def.type === "select" && (
        <select
          className="select"
          disabled={disabled}
          value={JSON.stringify(value)}
          onChange={(e) => save(JSON.parse(e.target.value))}
        >
          {def.options
            .filter((o) => devMode || !o.advanced || JSON.stringify(o.value) === JSON.stringify(value))
            .map((o) => (
              <option key={JSON.stringify(o.value)} value={JSON.stringify(o.value)}>
                {tt.option(def, o.value, o.label)}
              </option>
            ))}
        </select>
      )}
    </div>
  );
}

/** Champ texte (ou secret, ex. clé API) enregistré avec le bouton ou la touche Entrée. */
function TextSetting({
  value,
  secret,
  disabled,
  onSave,
}: {
  value: string;
  secret: boolean;
  disabled: boolean;
  onSave: (v: string) => void;
}) {
  const t = useT();
  // Une clé déjà enregistrée n'est jamais renvoyée à l'interface : seulement « __keyring__ ».
  const stored = secret && value !== "";
  const current = stored ? "" : value;
  const [draft, setDraft] = useState(current);
  const [visible, setVisible] = useState(false);
  useEffect(() => setDraft(current), [current]);
  const dirty = draft.trim() !== current && draft.trim() !== "";

  return (
    <form
      className="registry-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) onSave(draft.trim());
      }}
    >
      <input
        className="search plain"
        type={secret && !visible ? "password" : "text"}
        value={draft}
        disabled={disabled}
        placeholder={secret ? (stored ? t("tool.keyStored") : t("tool.pasteKey")) : ""}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
      />
      {secret && (
        <button type="button" className="btn secondary" onClick={() => setVisible((v) => !v)} title={visible ? t("common.hide") : t("common.show")}>
          <Icon icon={visible ? faEyeSlash : faEye} />
        </button>
      )}
      <button type="submit" className="btn" disabled={disabled || !dirty}>
        <Icon icon={faCheck} /> {t("common.save")}
      </button>
      {stored && (
        <button type="button" className="btn secondary danger" disabled={disabled} onClick={() => onSave("")}>
          {t("tool.keyDelete")}
        </button>
      )}
    </form>
  );
}

/** Liste gérée par le module (ex. espaces de travail) : créer, restaurer, supprimer… */
function CollectionSection({ tool, def }: { tool: Tool; def: CollectionDef }) {
  const t = useT();
  const ct = toolText(tool, useLang()).collection(def);
  const [items, setItems] = useState<CollectionItem[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Action d'un élément qui demande une valeur (ex. raccourci d'un espace de travail).
  const [editing, setEditing] = useState<{ item: string; action: string; value: unknown } | null>(null);

  const load = () =>
    api
      .collectionList(tool.id, def.id)
      .then(setItems)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.id, def.id, tool.installedVersion]);

  const act = async (key: string, action: string, item?: string, value?: string, json?: Record<string, unknown>) => {
    setBusy(key);
    setError("");
    try {
      await api.collectionAction(tool.id, def.id, action, item, value, json);
      if (action === "create") setName("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <h2>{ct.label}</h2>
      <div className="card settings-group">
        {ct.description && (
          <div className="setting-row">
            <p className="muted">{ct.description}</p>
          </div>
        )}
        {def.create && def.create.fields.length > 0 && (
          <CreateForm
            def={def}
            text={ct}
            t={t}
            disabled={!tool.enabled || busy !== null}
            busy={busy === "create"}
            onSubmit={(values) => act("create", "create", undefined, undefined, values)}
          />
        )}
        {def.create && def.create.fields.length === 0 && (
          <form
            className="setting-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) act("create", "create", undefined, name.trim());
            }}
          >
            <div className="registry-row grow">
              <input
                className="search plain"
                placeholder={ct.createPlaceholder}
                value={name}
                disabled={!tool.enabled}
                onChange={(e) => setName(e.target.value)}
              />
              <button className="btn" type="submit" disabled={!tool.enabled || !name.trim() || busy !== null}>
                <Icon icon={busy === "create" ? faSpinner : faPlus} spin={busy === "create"} /> {ct.createLabel}
              </button>
            </div>
          </form>
        )}
        {items?.length === 0 && (
          <div className="setting-row">
            <p className="muted">{ct.empty}</p>
          </div>
        )}
        {items?.map((item) => (
          <div key={item.id} className="collection-item">
          <div className="setting-row">
            <div>
              <strong>{item.name}</strong>
              {item.description && <p className="muted">{item.description}</p>}
            </div>
            <div className="tool-controls">
              {def.itemActions.map((a) => {
                const key = `${a.id}:${item.id}`;
                const content = (
                  <>
                    <Icon icon={busy === key ? faSpinner : iconByName(a.icon)} spin={busy === key} /> {ct.itemAction(a)}
                  </>
                );
                if (a.field) {
                  return (
                    <button
                      key={a.id}
                      className="btn secondary"
                      disabled={!tool.enabled || busy !== null}
                      onClick={() =>
                        setEditing(
                          editing?.item === item.id && editing.action === a.id
                            ? null
                            : { item: item.id, action: a.id, value: a.field!.default ?? "" },
                        )
                      }
                    >
                      {content}
                    </button>
                  );
                }
                return a.confirm ? (
                  <ConfirmButton
                    key={a.id}
                    className="btn secondary danger"
                    disabled={!tool.enabled || busy !== null}
                    confirmLabel={t("common.confirm")}
                    onConfirm={() => act(key, a.id, item.id)}
                  >
                    {content}
                  </ConfirmButton>
                ) : (
                  <button
                    key={a.id}
                    className={a.primary ? "btn" : "btn secondary"}
                    disabled={!tool.enabled || busy !== null}
                    onClick={() => act(key, a.id, item.id)}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          </div>
          {editing?.item === item.id &&
            def.itemActions
              .filter((a) => a.id === editing.action && a.field)
              .map((a) => {
                const ft = ct.itemField(a);
                return (
                  <div key={a.id} className="setting-row column item-field">
                    <div>
                      <strong>{ft.label}</strong>
                      {ft.description && <p className="muted small-text">{ft.description}</p>}
                    </div>
                    <FieldInput
                      field={a.field!}
                      text={ft}
                      t={t}
                      value={editing.value}
                      onChange={(v) => setEditing({ ...editing, value: v })}
                    />
                    <div className="actions">
                      <button
                        className="btn"
                        disabled={busy !== null}
                        onClick={async () => {
                          await act(`${a.id}:${item.id}`, a.id, item.id, String(editing.value ?? ""));
                          setEditing(null);
                        }}
                      >
                        <Icon icon={faCheck} /> {t("common.save")}
                      </button>
                      <button className="btn secondary" onClick={() => setEditing(null)}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        ))}
      </div>
      {error && <p className="hint">{error}</p>}
      {!tool.enabled && <p className="muted small-text">{t("tool.enableForFeature")}</p>}
    </section>
  );
}

const defaults = (fields: FieldDef[]) => Object.fromEntries(fields.map((f) => [f.key, f.default ?? ""]));

/** Formulaire de création généré depuis le manifest (ex. nouveau mode de concentration). */
type CollectionText = ReturnType<ReturnType<typeof toolText>["collection"]>;

function CreateForm({
  def,
  text,
  t,
  disabled,
  busy,
  onSubmit,
}: {
  def: CollectionDef;
  text: CollectionText;
  t: Translate;
  disabled: boolean;
  busy: boolean;
  onSubmit: (values: Record<string, unknown>) => Promise<void> | void;
}) {
  const fields = def.create!.fields;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>(() => defaults(fields));
  const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));
  const visible = fields.filter((f) => !f.showIf || values[f.showIf.key] === f.showIf.value);

  if (!open) {
    return (
      <div className="setting-row">
        <button className="btn" disabled={disabled} onClick={() => setOpen(true)}>
          <Icon icon={faPlus} /> {text.createLabel}
        </button>
      </div>
    );
  }

  return (
    <form
      className="create-form"
      onSubmit={async (e) => {
        e.preventDefault();
        // Seuls les champs visibles sont envoyés.
        const payload = Object.fromEntries(visible.map((f) => [f.key, values[f.key]]));
        await onSubmit({ ...values, ...payload });
        setValues(defaults(fields));
        setOpen(false);
      }}
    >
      {visible.map((f) => {
        const ft = text.field(f);
        return (
          <div key={f.key} className={`form-field ${f.type === "apps" ? "wide" : ""}`}>
            <label>
              <strong>{ft.label}</strong>
              {ft.description && <span className="muted small-text">{ft.description}</span>}
            </label>
            <FieldInput field={f} text={ft} t={t} value={values[f.key]} onChange={(v) => set(f.key, v)} />
          </div>
        );
      })}
      <div className="actions">
        <button className="btn" type="submit" disabled={disabled}>
          <Icon icon={busy ? faSpinner : faCheck} spin={busy} /> {text.createLabel}
        </button>
        <button className="btn secondary" type="button" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

function FieldInput({
  field,
  text,
  t,
  value,
  onChange,
}: {
  field: FieldDef;
  text: ReturnType<CollectionText["field"]>;
  t: Translate;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case "toggle":
      return <Toggle checked={Boolean(value)} onChange={onChange} />;
    case "number":
      return (
        <input
          className="search plain number"
          type="number"
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case "select":
      return (
        <select className="select" value={JSON.stringify(value)} onChange={(e) => onChange(JSON.parse(e.target.value))}>
          {field.options.map((o) => (
            <option key={JSON.stringify(o.value)} value={JSON.stringify(o.value)}>
              {text.option(o.value, o.label)}
            </option>
          ))}
        </select>
      );
    case "apps":
      return <AppPicker t={t} value={(value as string[]) ?? []} onChange={onChange} />;
    case "shortcut":
      return (
        <ShortcutRecorder
          value={String(value ?? "")}
          onChange={onChange}
          presets={field.options.map((o) => String(o.value))}
          optional
        />
      );
    default:
      return (
        <input
          className="search plain"
          value={String(value ?? "")}
          placeholder={text.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

let appsCache: Promise<DesktopApp[]> | null = null;

/** Sélection d'applications installées (recherche + puces). */
function AppPicker({ t, value, onChange }: { t: Translate; value: string[]; onChange: (v: string[]) => void }) {
  const [apps, setApps] = useState<DesktopApp[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    appsCache ??= api.systemApps();
    appsCache.then(setApps);
  }, []);
  const name = (id: string) => apps.find((a) => a.id === id)?.name ?? id;
  const q = query.trim().toLowerCase();
  const results = q ? apps.filter((a) => a.name.toLowerCase().includes(q) && !value.includes(a.id)).slice(0, 6) : [];

  return (
    <div className="app-picker">
      <div className="chips">
        {value.map((id) => (
          <button key={id} type="button" className="chip active" onClick={() => onChange(value.filter((v) => v !== id))}>
            {name(id)} <Icon icon={faXmark} />
          </button>
        ))}
      </div>
      <input
        className="search plain"
        placeholder={t("tool.searchApp")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <div className="app-results">
          {results.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onChange([...value, a.id]);
                setQuery("");
              }}
            >
              <Icon icon={faPlus} /> {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
