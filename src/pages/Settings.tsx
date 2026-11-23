import { useEffect, useState } from "react";
import { ACCENTS, useSettings, type Language, type Theme } from "../state/settings";
import Toggle from "../components/Toggle";
import { useTools } from "../state/tools";
import { api } from "../lib/api";
import { useT } from "../i18n";
import { useAppUpdate } from "../state/update";
import ConfirmButton from "../components/ConfirmButton";
import { openUrl } from "@tauri-apps/plugin-opener";

const THEMES: Theme[] = ["system", "light", "dark"];
const LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
];

export default function Settings() {
  const { settings, update, reset } = useSettings();
  const t = useT();

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t("nav.settings")}</h1>
        <p className="muted">{t("settings.subtitle")}</p>
      </header>

      <section>
        <h2>{t("settings.language")}</h2>
        <div className="card settings-group">
          <div className="setting-row">
            <div>
              <strong>{t("settings.language")}</strong>
              <p className="muted">{t("settings.languageHint")}</p>
            </div>
            <div className="segmented">
              {LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  className={settings.language === l.id ? "active" : ""}
                  onClick={() => update("language", l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2>{t("settings.appearance")}</h2>
        <div className="card settings-group">
          <div className="setting-row">
            <div>
              <strong>{t("settings.theme")}</strong>
              <p className="muted">{t("settings.themeHint")}</p>
            </div>
            <div className="segmented">
              {THEMES.map((theme) => (
                <button
                  key={theme}
                  className={settings.theme === theme ? "active" : ""}
                  onClick={() => update("theme", theme)}
                >
                  {t(`settings.theme.${theme}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-row">
            <div>
              <strong>{t("settings.accent")}</strong>
              <p className="muted">{t("settings.accentHint")}</p>
            </div>
            <div className="swatches">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${settings.accent === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => update("accent", c)}
                  aria-label={`Accent ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="setting-row">
            <div>
              <strong>{t("settings.compact")}</strong>
              <p className="muted">{t("settings.compactHint")}</p>
            </div>
            <Toggle checked={settings.compactSidebar} onChange={(v) => update("compactSidebar", v)} />
          </div>
        </div>
      </section>

      <UpdateSection />

      <StartupSection />

      <RegistrySection />

      <section>
        <h2>{t("settings.storage")}</h2>
        <div className="card settings-group">
          <div className="setting-row">
            <p className="muted small-text">{t("settings.storageHint")}</p>
          </div>
        </div>
      </section>

      <UninstallSection />

      <div>
        <button className="btn secondary" onClick={reset}>
          {t("settings.reset")}
        </button>
      </div>
    </div>
  );
}

/** Démarrage des outils à l'ouverture de session, sans l'application complète. */
function StartupSection() {
  const { data, refresh } = useTools();
  const t = useT();
  if (!data) return null;
  const active = data.tools.filter((tool) => tool.enabled).length;
  return (
    <section>
      <h2>{t("settings.startup")}</h2>
      <div className="card settings-group">
        <div className="setting-row">
          <div>
            <strong>{t("settings.autostart")}</strong>
            <p className="muted">{t("settings.autostartHint", { active })}</p>
          </div>
          <Toggle checked={data.autostart} onChange={(v) => api.setAutostart(v).then(() => refresh())} />
        </div>
      </div>
    </section>
  );
}

/** Source du catalogue d'outils (registry.json local ou sur GitHub). */
function RegistrySection() {
  const { data, refresh } = useTools();
  const t = useT();
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(data?.registryUrl ?? ""), [data?.registryUrl]);

  const apply = async (value: string | null) => {
    await api.setRegistryUrl(value);
    await refresh(true);
  };

  return (
    <section>
      <h2>{t("settings.source")}</h2>
      <div className="card settings-group">
        <div className="setting-row column">
          <div>
            <strong>{t("settings.catalog")}</strong>
            <p className="muted">{t("settings.catalogHint")}</p>
          </div>
          <div className="registry-row">
            <input className="search plain" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            <button className="btn" onClick={() => apply(url)}>
              {t("common.save")}
            </button>
            <button className="btn secondary" onClick={() => apply(null)}>
              {t("settings.default")}
            </button>
          </div>
          {data?.registryError && <p className="hint">{data.registryError}</p>}
          {data && (
            <p className="muted small-text">
              {t("settings.platform", { version: data.coreVersion, platform: data.platform })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Mise à jour de l'application depuis GitHub Releases. */
function UpdateSection() {
  const t = useT();
  const [force, setForce] = useState(0);
  const { update, error, checking } = useAppUpdate(force);
  const [state, setState] = useState<"idle" | "installing" | "opened" | "error">("idle");
  const [installError, setInstallError] = useState("");

  const install = async () => {
    if (!update?.url) return;
    setState("installing");
    try {
      await api.installUpdate(update.url, update.digest);
      setState("opened");
    } catch (e) {
      setInstallError(String(e));
      setState("error");
    }
  };

  return (
    <section>
      <h2>{t("update.title")}</h2>
      <div className="card settings-group">
        <div className="setting-row">
          <div>
            <strong>{t("update.current", { version: update?.current ?? "…" })}</strong>
            <p className="muted">
              {checking
                ? t("update.checking")
                : error
                  ? error
                  : update?.available
                    ? t("update.available", { version: update.latest ?? "" })
                    : update?.latest
                      ? t("update.upToDate")
                      : t("update.none")}
            </p>
            {state === "opened" && <p className="hint ok-text">{t("update.opened")}</p>}
            {state === "error" && <p className="hint">{installError}</p>}
          </div>
          <div className="tool-controls">
            {update?.page && update.available && (
              <button className="btn secondary" onClick={() => openUrl(update.page!)}>
                {t("update.notes")}
              </button>
            )}
            {update?.available ? (
              <button className="btn" disabled={state === "installing"} onClick={install}>
                {state === "installing" ? t("update.installing") : t("update.install")}
              </button>
            ) : (
              <button className="btn secondary" disabled={checking} onClick={() => setForce((n) => n + 1)}>
                {t("update.check")}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Supprime tout ce que Powernux a installé, avant `sudo apt remove powernux`. */
function UninstallSection() {
  const t = useT();
  const { refresh } = useTools();
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  return (
    <section>
      <h2>{t("uninstall.title")}</h2>
      <div className="card settings-group">
        <div className="setting-row">
          <div>
            <strong>{t("uninstall.label")}</strong>
            <p className="muted">{t("uninstall.hint")}</p>
            {done && (
              <p className="hint ok-text">
                {t("uninstall.done")} <code>sudo apt remove powernux</code>
              </p>
            )}
            {error && <p className="hint">{error}</p>}
          </div>
          <ConfirmButton
            className="btn secondary danger"
            confirmLabel={t("uninstall.confirm")}
            onConfirm={() =>
              api
                .uninstallAll()
                .then(() => {
                  setDone(true);
                  refresh(true);
                })
                .catch((e) => setError(String(e)))
            }
          >
            {t("uninstall.button")}
          </ConfirmButton>
        </div>
      </div>
    </section>
  );
}
