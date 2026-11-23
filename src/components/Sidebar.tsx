import type { ReactNode } from "react";
import { faGaugeHigh, faToolbox, faGear, faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { Icon, Logo } from "./Icons";
import { useSettings } from "../state/settings";
import { APP_INFO } from "../data/app";
import { useT, type MessageKey } from "../i18n";

export type PageId = "dashboard" | "tools" | "settings" | "about";

const NAV: { id: PageId; label: MessageKey; icon: ReactNode }[] = [
  { id: "dashboard", label: "nav.dashboard", icon: <Icon icon={faGaugeHigh} fixedWidth /> },
  { id: "tools", label: "nav.tools", icon: <Icon icon={faToolbox} fixedWidth /> },
  { id: "settings", label: "nav.settings", icon: <Icon icon={faGear} fixedWidth /> },
  { id: "about", label: "nav.about", icon: <Icon icon={faCircleInfo} fixedWidth /> },
];

interface Props {
  current: PageId;
  onNavigate: (page: PageId) => void;
}

export default function Sidebar({ current, onNavigate }: Props) {
  const { settings } = useSettings();
  const t = useT();
  const compact = settings.compactSidebar;

  return (
    <aside className={`sidebar ${compact ? "compact" : ""}`}>
      <div className="brand" data-tauri-drag-region>
        <Logo />
        {!compact && <span>{APP_INFO.name}</span>}
      </div>
      <nav>
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${current === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
            title={t(item.label)}
          >
            {item.icon}
            {!compact && <span>{t(item.label)}</span>}
          </button>
        ))}
      </nav>
      {!compact && <div className="sidebar-footer">v{APP_INFO.version}</div>}
    </aside>
  );
}
