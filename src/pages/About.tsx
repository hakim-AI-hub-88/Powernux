import { openUrl } from "@tauri-apps/plugin-opener";
import { faGithub, faLinkedin } from "@fortawesome/free-brands-svg-icons";
import { faUserGraduate } from "@fortawesome/free-solid-svg-icons";
import { APP_INFO } from "../data/app";
import { Icon, Logo } from "../components/Icons";
import { useT } from "../i18n";

export default function About() {
  const t = useT();
  return (
    <div className="page">
      <div className="card about-hero">
        <Logo size={64} />
        <div>
          <h1>{APP_INFO.name}</h1>
          <p className="muted">{t("about.version", { version: APP_INFO.version })}</p>
          <p>
            <Icon icon={faUserGraduate} /> {t("about.createdBy")} <strong>{APP_INFO.developer}</strong> — {t("about.role")}
          </p>
        </div>
      </div>

      <section>
        <h2>{t("about.project")}</h2>
        <div className="card">
          <p>{t("about.p1")}</p>
          <p>{t("about.p2")}</p>
          <p>{t("about.p3")}</p>
        </div>
      </section>

      <section>
        <h2>{t("about.info")}</h2>
        <div className="card settings-group">
          <div className="setting-row">
            <strong>{t("about.developer")}</strong>
            <span>
              {APP_INFO.developer} — {t("about.role")}
            </span>
          </div>
          <div className="setting-row">
            <strong>{t("about.license")}</strong>
            <span>{t("about.licenseValue")}</span>
          </div>
        </div>
      </section>

      <section>
        <h2>{t("about.links")}</h2>
        <div className="links">
          {APP_INFO.links.map((l) => (
            <button key={l.label} className="btn secondary" onClick={() => openUrl(l.url)}>
              <Icon icon={l.icon === "linkedin" ? faLinkedin : faGithub} /> {l.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
