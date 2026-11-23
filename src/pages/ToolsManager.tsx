import { useMemo, useState } from "react";
import {
  faMagnifyingGlass,
  faChevronRight,
  faRotateRight,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../components/Icons";
import ToolIcon from "../components/ToolIcon";
import ToolControls, { statusOf, ToolStatusNotice } from "../components/ToolControls";
import { useTools } from "../state/tools";
import { categoryLabel, useT } from "../i18n";
import { useToolText } from "../lib/toolText";

const ALL = "*";

export default function ToolsManager({ onOpen }: { onOpen: (toolId: string) => void }) {
  const { data, loading, errors, refresh, clearError } = useTools();
  const t = useT();
  const text = useToolText();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);

  const categories = useMemo(
    () => [ALL, ...new Set((data?.tools ?? []).map((tool) => tool.category).filter(Boolean))],
    [data],
  );

  const tools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.tools ?? [])
      .filter((tool) => {
        const tt = text(tool);
        return (
          (category === ALL || tool.category === category) &&
          (!q || tt.name.toLowerCase().includes(q) || tt.description.toLowerCase().includes(q))
        );
      })
      // Installés d'abord, puis disponibles, puis « bientôt ».
      .sort((a, b) => Number(b.installed) - Number(a.installed) || Number(b.downloadable) - Number(a.downloadable));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, category, text]);

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1>{t("nav.tools")}</h1>
          <p className="muted">{t("tools.subtitle")}</p>
        </div>
        <button className="btn secondary" disabled={loading} onClick={() => refresh(true)} title={t("tools.refreshTitle")}>
          <Icon icon={faRotateRight} spin={loading} /> {t("tools.refresh")}
        </button>
      </header>

      {data?.registryError && (
        <div className="notice error">
          <Icon icon={faTriangleExclamation} />
          <div>
            {t("tools.catalogError", { error: data.registryError })}
            <br />
            <span className="muted">{t("tools.catalogErrorHint")}</span>
          </div>
        </div>
      )}

      <div className="toolbar">
        <div className="search-wrap">
          <Icon icon={faMagnifyingGlass} />
          <input
            className="search"
            type="search"
            placeholder={t("tools.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chips">
          {categories.map((c) => (
            <button key={c} className={`chip ${category === c ? "active" : ""}`} onClick={() => setCategory(c)}>
              {c === ALL ? t("tools.all") : categoryLabel(t, c)}
            </button>
          ))}
        </div>
      </div>

      <div className="tool-list">
        {tools.map((tool) => {
          const st = statusOf(tool, t);
          const tt = text(tool);
          const version = tool.installedVersion ?? tool.latestVersion;
          return (
            <div key={tool.id} className="tool-entry">
              <div
                className={`card tool ${tool.installed ? "clickable" : ""}`}
                onClick={() => tool.installed && onOpen(tool.id)}
              >
                <div className="tool-icon">
                  <ToolIcon name={tool.icon} />
                </div>
                <div className="tool-body">
                  <div className="tool-title">
                    <strong>{tt.name}</strong>
                    {tool.category && <span className="badge">{categoryLabel(t, tool.category)}</span>}
                  </div>
                  <p className="muted">{tt.description}</p>
                  <div className="tool-meta">
                    <span>
                      {t("tools.version")} <strong>{version ?? "—"}</strong>
                      {tool.updateAvailable && <> → {tool.latestVersion}</>}
                    </span>
                    <span>
                      {t("tools.status")} <span className={`status status-${st.kind}`}>{st.label}</span>
                    </span>
                  </div>
                </div>
                <ToolControls tool={tool} showRemove={false} />
                {tool.installed && <Icon icon={faChevronRight} className="muted" />}
              </div>
              {tool.status && tool.status.level !== "ok" && <ToolStatusNotice tool={tool} />}
              {errors[tool.id] && (
                <div className="notice error">
                  <Icon icon={faTriangleExclamation} /> <span className="grow">{errors[tool.id]}</span>
                  <button className="icon-btn" onClick={() => clearError(tool.id)}>
                    <Icon icon={faXmark} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {data && tools.length === 0 && <p className="muted">{t("tools.noResult")}</p>}
      </div>
    </div>
  );
}
