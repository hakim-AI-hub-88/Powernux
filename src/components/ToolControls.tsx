import { faCircleCheck, faCircleInfo, faDownload, faRotate, faTrashCan, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "./Icons";
import Toggle from "./Toggle";
import ConfirmButton from "./ConfirmButton";
import { api, type Progress, type Tool } from "../lib/api";
import { formatSize, useT, type MessageKey, type Translate } from "../i18n";
import { useToolText } from "../lib/toolText";
import { useTools } from "../state/tools";

export function statusOf(tool: Tool, t: Translate): { label: string; kind: string } {
  if (tool.installed) {
    if (tool.updateAvailable) return { label: t("status.update"), kind: "update" };
    return tool.enabled ? { label: t("status.on"), kind: "active" } : { label: t("status.off"), kind: "installed" };
  }
  if (!tool.downloadable) return { label: t("status.soon"), kind: "planned" };
  return { label: t("status.notInstalled"), kind: "available" };
}

/** Message envoyé par le module (status.json). */
export function ToolStatusNotice({ tool }: { tool: Tool }) {
  const text = useToolText();
  const status = text(tool).status;
  if (!status) return null;
  const { level, message } = status;
  const icon = level === "ok" ? faCircleCheck : level === "error" ? faTriangleExclamation : faCircleInfo;
  return (
    <div className={`notice status-notice ${level}`}>
      <Icon icon={icon} /> <span>{message}</span>
    </div>
  );
}

export function ProgressBar({ p }: { p: Progress }) {
  const t = useT();
  const pct = p.stage === "download" && p.total > 0 ? Math.round((p.downloaded / p.total) * 100) : null;
  return (
    <div className="progress">
      <div className="progress-label">
        <span>{t(`stage.${p.stage}` as MessageKey)}…</span>
        {pct !== null && <span>{pct} %</span>}
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill ${pct === null ? "indeterminate" : ""}`}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}

/** Boutons d'un outil : Download / Update / Remove / ON-OFF, ou la progression en cours. */
export default function ToolControls({
  tool,
  showToggle = true,
  showRemove = true,
}: {
  tool: Tool;
  showToggle?: boolean;
  showRemove?: boolean;
}) {
  const { progress, run } = useTools();
  const t = useT();
  const p = progress[tool.id];
  if (p) return <ProgressBar p={p} />;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (!tool.installed) {
    if (!tool.downloadable) return null;
    if (tool.requiresPowernux)
      return (
        <span className="muted small-text">
          <Icon icon={faTriangleExclamation} /> {t("controls.requires", { version: tool.requiresPowernux })}
        </span>
      );
    return (
      <button
        className="btn"
        onClick={(e) => {
          stop(e);
          run(tool.id, () => api.install(tool.id));
        }}
      >
        <Icon icon={faDownload} /> {t("controls.download")}
        {tool.downloadSize > 0 && <span className="btn-meta">{formatSize(t, tool.downloadSize)}</span>}
      </button>
    );
  }

  return (
    <div className="tool-controls" onClick={stop}>
      {tool.updateAvailable && (
        <button className="btn" onClick={() => run(tool.id, () => api.install(tool.id))}>
          <Icon icon={faRotate} /> {t("controls.update")}
        </button>
      )}
      {showRemove && (
        <ConfirmButton
          className="btn secondary danger"
          confirmLabel={t("common.confirm")}
          onConfirm={() => run(tool.id, () => api.remove(tool.id))}
        >
          <Icon icon={faTrashCan} /> {t("controls.remove")}
        </ConfirmButton>
      )}
      {showToggle && (
        <div className="onoff">
          <span className={tool.enabled ? "on" : ""}>{tool.enabled ? t("state.on") : t("state.off")}</span>
          <Toggle checked={tool.enabled} onChange={(v) => run(tool.id, () => api.setEnabled(tool.id, v))} />
        </div>
      )}
    </div>
  );
}
