import { APP_INFO } from "../data/app";
import type { PageId } from "../components/Sidebar";
import { faLayerGroup, faCircleCheck, faDownload, faCodeBranch } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../components/Icons";
import { useTools } from "../state/tools";
import { useT } from "../i18n";
import { useAppUpdate } from "../state/update";
import { faCircleUp } from "@fortawesome/free-solid-svg-icons";

export default function Dashboard({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const { data } = useTools();
  const t = useT();
  const { update } = useAppUpdate();
  const tools = data?.tools ?? [];
  const available = tools.filter((t) => t.downloadable).length;
  const installed = tools.filter((t) => t.installed).length;
  const active = tools.filter((t) => t.enabled).length;

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t("dashboard.welcome", { name: APP_INFO.name })}</h1>
        <p className="muted">{t("about.tagline")}</p>
      </header>

      {update?.available && (
        <button className="notice update-banner" onClick={() => onNavigate("settings")}>
          <Icon icon={faCircleUp} /> <strong>{t("update.banner", { version: update.latest ?? "" })}</strong>
          <span className="grow" />
          <span>{t("update.install")} →</span>
        </button>
      )}

      <section className="stats">
        <button className="card stat clickable" onClick={() => onNavigate("tools")}>
          <Icon icon={faLayerGroup} className="stat-icon" />
          <span className="stat-value">{tools.length}</span>
          <span className="muted">{t("dashboard.catalog")}</span>
        </button>
        <button className="card stat clickable" onClick={() => onNavigate("tools")}>
          <Icon icon={faCircleCheck} className="stat-icon" />
          <span className="stat-value">{available}</span>
          <span className="muted">{t("dashboard.available")}</span>
        </button>
        <button className="card stat clickable" onClick={() => onNavigate("tools")}>
          <Icon icon={faDownload} className="stat-icon" />
          <span className="stat-value">{installed}</span>
          <span className="muted">{t("dashboard.installed", { active })}</span>
        </button>
        <div className="card stat">
          <Icon icon={faCodeBranch} className="stat-icon" />
          <span className="stat-value">v{APP_INFO.version}</span>
          <span className="muted">{t("dashboard.version")}</span>
        </div>
      </section>

    </div>
  );
}
