import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Préférences de l'interface, enregistrées par le backend dans un document JSON :
// ~/.config/powernux/preferences.json (conservé entre les redémarrages et les mises à jour).
export type Theme = "system" | "light" | "dark";
export type Language = "en" | "fr";

export interface Settings {
  language: Language;
  theme: Theme;
  accent: string;
  compactSidebar: boolean;
}

// Le premier accent est le Cyan IA de la charte Powernux (couleur par défaut).
export const ACCENTS = ["#00C2FF", "#8B7CFF", "#2EE6A6", "#FFB547", "#FF6B9A"];

const DEFAULTS: Settings = {
  language: "en", // langue par défaut à l'installation
  theme: "system",
  accent: ACCENTS[0],
  compactSidebar: false,
};

const LEGACY_KEY = "powernux.settings"; // anciennes versions : localStorage

function normalize(raw: Partial<Settings>): Settings {
  const s = { ...DEFAULTS, ...raw };
  if (!ACCENTS.includes(s.accent)) s.accent = DEFAULTS.accent;
  if (s.language !== "fr") s.language = "en";
  return s;
}

interface SettingsContextValue {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    (async () => {
      let prefs = await invoke<Partial<Settings>>("prefs_get");
      // Migration unique depuis l'ancien stockage du navigateur intégré.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy && !("theme" in prefs)) {
        try {
          const { theme, accent, compactSidebar } = JSON.parse(legacy);
          prefs = await invoke<Partial<Settings>>("prefs_set", { patch: { theme, accent, compactSidebar } });
        } catch {
          /* ancien format illisible : ignoré */
        }
        localStorage.removeItem(LEGACY_KEY);
      }
      setSettings(normalize(prefs));
    })();
    const unlisten = listen<Partial<Settings>>("prefs://changed", (e) => setSettings(normalize(e.payload)));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.lang = settings.language;
    root.style.setProperty("--accent", settings.accent);
  }, [settings]);

  // Évite d'afficher l'interface dans la mauvaise langue le temps du chargement.
  if (!settings) return null;

  const update: SettingsContextValue["update"] = (key, value) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    invoke("prefs_set", { patch: { [key]: value } });
  };
  const reset = () => {
    const { language: _keep, ...rest } = DEFAULTS;
    setSettings((s) => (s ? { ...DEFAULTS, language: s.language } : s));
    invoke("prefs_set", { patch: rest });
  };

  return (
    <SettingsContext.Provider value={{ settings, update, reset }}>{children}</SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
