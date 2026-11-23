import { getCurrentWindow } from "@tauri-apps/api/window";
import { faMinus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { faWindowMaximize } from "@fortawesome/free-regular-svg-icons";
import { Icon } from "./Icons";
import { useT } from "../i18n";

// Barre de titre personnalisée (la barre native est désactivée dans tauri.conf.json).
// data-tauri-drag-region : glisser pour déplacer, double-clic pour agrandir.
const appWindow = getCurrentWindow();

export default function Titlebar() {
  const t = useT();
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-buttons">
        <button onClick={() => appWindow.minimize()} aria-label={t("window.minimize")} title={t("window.minimize")}>
          <Icon icon={faMinus} />
        </button>
        <button onClick={() => appWindow.toggleMaximize()} aria-label={t("window.maximize")} title={t("window.maximize")}>
          <Icon icon={faWindowMaximize} />
        </button>
        <button className="close" onClick={() => appWindow.close()} aria-label={t("window.close")} title={t("window.close")}>
          <Icon icon={faXmark} />
        </button>
      </div>
    </header>
  );
}
