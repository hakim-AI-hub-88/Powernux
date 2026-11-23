// Traductions de l'interface. Langue par défaut : anglais (choix enregistré dans les préférences).
import { useSettings, type Language } from "./state/settings";

const en = {
  // Navigation & fenêtre
  "nav.dashboard": "Dashboard",
  "nav.tools": "Tools Manager",
  "nav.settings": "Settings",
  "nav.about": "About",
  "state.on": "ON",
  "state.off": "OFF",
  "window.minimize": "Minimize",
  "window.maximize": "Maximize",
  "window.close": "Close",

  // Dashboard
  "dashboard.welcome": "Welcome to {name}",
  "dashboard.catalog": "Tools in the catalog",
  "dashboard.available": "Available tools",
  "dashboard.installed": "Installed tools ({active} active)",
  "dashboard.version": "Version",

  // Tools Manager
  "tools.subtitle": "Install only the tools you need. Each tool is independent.",
  "tools.refresh": "Refresh",
  "tools.refreshTitle": "Refresh the catalog",
  "tools.catalogError": "Catalog unavailable: {error}",
  "tools.catalogErrorHint": "Only installed tools are shown.",
  "tools.search": "Search for a tool…",
  "tools.all": "All",
  "tools.version": "Version:",
  "tools.status": "Status:",
  "tools.noResult": "No tool matches your search.",
  "status.update": "Update available",
  "status.on": "Installed · ON",
  "status.off": "Installed · OFF",
  "status.soon": "Coming soon",
  "status.notInstalled": "Not installed",
  "stage.download": "Downloading",
  "stage.verify": "Verifying",
  "stage.install": "Installing",
  "stage.activate": "Activating",
  "controls.download": "Download",
  "controls.update": "Update",
  "controls.remove": "Remove",
  "controls.requires": "Requires Powernux {version}",
  "common.confirm": "Confirm?",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.show": "Show",
  "common.hide": "Hide",

  // Page d'un outil
  "tool.notFound": "Tool not found.",
  "tool.activation": "Activation",
  "tool.settings": "Settings",
  "tool.actions": "Actions",
  "tool.enableForActions": "Turn the tool on to use these actions.",
  "tool.enableForFeature": "Turn the tool on to use this feature.",
  "tool.shortcutTaken": "{keys} is already used ({by}). Choose another shortcut.",
  "tool.gnomeOnly": "Global shortcuts are only supported on GNOME.",
  "tool.pasteKey": "Paste your key here",
  "tool.keyStored": "•••••••• Saved in the GNOME Keyring — paste a new key to replace it",
  "tool.keyDelete": "Delete key",
  "tool.searchApp": "Search for an application…",
  "tool.devMode": "Advanced developer mode",
  "tool.devModeOn": "Advanced developer mode: on",
  "tool.devModeHint": "Shows advanced settings: any provider, model, API address and key.",

  // Raccourcis
  "shortcut.press": "Press the key combination… (Esc to cancel)",
  "shortcut.change": "Change",
  "shortcut.suggestions": "Suggestions:",
  "shortcut.unsupported": "Unsupported key.",
  "shortcut.needModifier": "Use at least Win, Ctrl or Alt.",
  "shortcut.none": "None",
  "shortcut.clear": "Remove",

  // Settings
  "settings.subtitle": "Customize Powernux.",
  "settings.language": "Language",
  "settings.languageHint": "Language of the application interface.",
  "settings.appearance": "Appearance",
  "settings.theme": "Theme",
  "settings.themeHint": "Follow the system or force a theme.",
  "settings.theme.system": "System",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.accent": "Accent color",
  "settings.accentHint": "Used for active elements.",
  "settings.compact": "Compact sidebar",
  "settings.compactHint": "Show icons only.",
  "settings.startup": "Startup",
  "settings.autostart": "Start tools when you log in",
  "settings.autostartHint":
    "Only active tools ({active}) start, in the background, without opening Powernux: minimal resource usage. Open Powernux only to manage your tools.",
  "settings.source": "Tool source",
  "settings.catalog": "Catalog (registry.json)",
  "settings.catalogHint": "Address of the catalog tools are downloaded from (GitHub or local file).",
  "settings.default": "Default",
  "settings.platform": "Powernux {version} · platform {platform}",
  "settings.storage": "Data storage",
  "settings.storageHint":
    "Preferences: ~/.config/powernux/preferences.json · Tools and their data: ~/.local/share/powernux",
  "settings.reset": "Reset settings",
  "update.title": "Powernux updates",
  "update.current": "Installed version: {version}",
  "update.check": "Check for updates",
  "update.checking": "Checking…",
  "update.upToDate": "Powernux is up to date.",
  "update.none": "No version published yet.",
  "update.available": "Version {version} is available.",
  "update.install": "Download and install",
  "update.installing": "Downloading…",
  "update.opened": "The installer is open: confirm the installation, then restart Powernux.",
  "update.notes": "What's new",
  "update.banner": "Powernux {version} is available",
  "uninstall.title": "Uninstall",
  "uninstall.label": "Uninstall everything",
  "uninstall.hint":
    "Removes all tools and their data, API keys, keyboard shortcuts, GNOME extensions, the startup entry and your preferences. Use it before removing the application.",
  "uninstall.button": "Uninstall everything",
  "uninstall.confirm": "Confirm: delete everything?",
  "uninstall.done": "Everything was removed. You can now uninstall the application:",

  // About
  "about.version": "Version {version}",
  "about.createdBy": "Created by",
  "about.project": "The project",
  "about.info": "Information",
  "about.developer": "Developer",
  "about.license": "License",
  "about.links": "Links",
  "about.role": "Engineering student",
  "about.licenseValue": "To be defined",
  "about.tagline": "The control center for productivity tools on Linux.",
  "about.p1":
    "Powernux is a tool platform for Linux that brings together, in a single application, the utilities that save time every day: clipboard history, window management, voice typing, AI assistant, focus mode, screenshots, and file and project organization.",
  "about.p2":
    "Each tool is an independent module: install only the ones you need and turn them on or off in one click. Only active tools run in the background, which keeps your system light and fast.",
  "about.p3":
    "Built for the GNOME desktop, Powernux is designed to grow: new tools can be added and updated without reinstalling the application.",

  // Catégories d'outils
  "cat.Productivité": "Productivity",
  "cat.Fenêtres": "Windows",
  "cat.IA": "AI",
  "cat.Capture": "Capture",
  "cat.Développement": "Development",
  "cat.Fichiers": "Files",
  "cat.Système": "System",

  "size.kb": "{n} KB",
  "size.mb": "{n} MB",
} as const;

export type MessageKey = keyof typeof en;

const fr: Record<MessageKey, string> = {
  "nav.dashboard": "Tableau de bord",
  "nav.tools": "Gestionnaire d'outils",
  "nav.settings": "Paramètres",
  "nav.about": "À propos",
  "state.on": "Activé",
  "state.off": "Désactivé",
  "window.minimize": "Réduire",
  "window.maximize": "Agrandir",
  "window.close": "Fermer",

  "dashboard.welcome": "Bienvenue dans {name}",
  "dashboard.catalog": "Outils au catalogue",
  "dashboard.available": "Outils disponibles",
  "dashboard.installed": "Outils installés ({active} actifs)",
  "dashboard.version": "Version",

  "tools.subtitle": "Installez uniquement les outils dont vous avez besoin. Chaque outil est indépendant.",
  "tools.refresh": "Actualiser",
  "tools.refreshTitle": "Actualiser le catalogue",
  "tools.catalogError": "Catalogue indisponible : {error}",
  "tools.catalogErrorHint": "Seuls les outils déjà installés sont affichés.",
  "tools.search": "Rechercher un outil…",
  "tools.all": "Tous",
  "tools.version": "Version :",
  "tools.status": "Statut :",
  "tools.noResult": "Aucun outil ne correspond à votre recherche.",
  "status.update": "Mise à jour disponible",
  "status.on": "Installé · Activé",
  "status.off": "Installé · Désactivé",
  "status.soon": "Bientôt",
  "status.notInstalled": "Non installé",
  "stage.download": "Téléchargement",
  "stage.verify": "Vérification",
  "stage.install": "Installation",
  "stage.activate": "Activation",
  "controls.download": "Télécharger",
  "controls.update": "Mettre à jour",
  "controls.remove": "Supprimer",
  "controls.requires": "Nécessite Powernux {version}",
  "common.confirm": "Confirmer ?",
  "common.cancel": "Annuler",
  "common.save": "Enregistrer",
  "common.show": "Afficher",
  "common.hide": "Masquer",

  "tool.notFound": "Outil introuvable.",
  "tool.activation": "Activation",
  "tool.settings": "Paramètres",
  "tool.actions": "Actions",
  "tool.enableForActions": "Activez l'outil pour utiliser ces actions.",
  "tool.enableForFeature": "Activez l'outil pour utiliser cette fonction.",
  "tool.shortcutTaken": "{keys} est déjà utilisé ({by}). Choisissez un autre raccourci.",
  "tool.gnomeOnly": "Les raccourcis globaux ne sont pris en charge que sous GNOME.",
  "tool.pasteKey": "Collez votre clé ici",
  "tool.keyStored": "•••••••• Enregistrée dans le trousseau GNOME — collez une nouvelle clé pour la remplacer",
  "tool.keyDelete": "Supprimer la clé",
  "tool.searchApp": "Rechercher une application…",
  "tool.devMode": "Mode développeur avancé",
  "tool.devModeOn": "Mode développeur avancé : activé",
  "tool.devModeHint": "Affiche les réglages avancés : n'importe quel fournisseur, modèle, adresse d'API et clé.",

  "shortcut.press": "Appuyez sur la combinaison… (Échap pour annuler)",
  "shortcut.change": "Modifier",
  "shortcut.suggestions": "Suggestions :",
  "shortcut.unsupported": "Touche non prise en charge.",
  "shortcut.needModifier": "Utilisez au moins Win, Ctrl ou Alt.",
  "shortcut.none": "Aucun",
  "shortcut.clear": "Retirer",

  "settings.subtitle": "Personnalisez Powernux.",
  "settings.language": "Langue",
  "settings.languageHint": "Langue de l'interface de l'application.",
  "settings.appearance": "Apparence",
  "settings.theme": "Thème",
  "settings.themeHint": "Suivre le système ou forcer un thème.",
  "settings.theme.system": "Système",
  "settings.theme.light": "Clair",
  "settings.theme.dark": "Sombre",
  "settings.accent": "Couleur d'accent",
  "settings.accentHint": "Utilisée pour les éléments actifs.",
  "settings.compact": "Barre latérale compacte",
  "settings.compactHint": "Afficher uniquement les icônes.",
  "settings.startup": "Démarrage",
  "settings.autostart": "Démarrer les outils à l'ouverture de session",
  "settings.autostartHint":
    "Seuls les outils actifs ({active}) démarrent, en arrière-plan, sans ouvrir Powernux : utilisation minimale des ressources. Ouvrez Powernux uniquement pour gérer vos outils.",
  "settings.source": "Source des outils",
  "settings.catalog": "Catalogue (registry.json)",
  "settings.catalogHint": "Adresse du catalogue d'où les outils sont téléchargés (GitHub ou fichier local).",
  "settings.default": "Par défaut",
  "settings.platform": "Powernux {version} · plateforme {platform}",
  "settings.storage": "Stockage des données",
  "settings.storageHint":
    "Préférences : ~/.config/powernux/preferences.json · Outils et leurs données : ~/.local/share/powernux",
  "settings.reset": "Réinitialiser les paramètres",
  "update.title": "Mises à jour de Powernux",
  "update.current": "Version installée : {version}",
  "update.check": "Rechercher une mise à jour",
  "update.checking": "Recherche…",
  "update.upToDate": "Powernux est à jour.",
  "update.none": "Aucune version publiée pour l'instant.",
  "update.available": "La version {version} est disponible.",
  "update.install": "Télécharger et installer",
  "update.installing": "Téléchargement…",
  "update.opened": "L'installateur est ouvert : confirmez l'installation, puis relancez Powernux.",
  "update.notes": "Nouveautés",
  "update.banner": "Powernux {version} est disponible",
  "uninstall.title": "Désinstallation",
  "uninstall.label": "Tout désinstaller",
  "uninstall.hint":
    "Supprime tous les outils et leurs données, les clés API, les raccourcis clavier, les extensions GNOME, le démarrage automatique et vos préférences. À faire avant de supprimer l'application.",
  "uninstall.button": "Tout désinstaller",
  "uninstall.confirm": "Confirmer : tout supprimer ?",
  "uninstall.done": "Tout a été supprimé. Vous pouvez maintenant désinstaller l'application :",

  "about.version": "Version {version}",
  "about.createdBy": "Créé par",
  "about.project": "Le projet",
  "about.info": "Informations",
  "about.developer": "Développeur",
  "about.license": "Licence",
  "about.links": "Liens",
  "about.role": "Étudiant ingénieur",
  "about.licenseValue": "À définir",
  "about.tagline": "Le centre de contrôle des outils de productivité pour Linux.",
  "about.p1":
    "Powernux est une plateforme d'outils pour Linux qui réunit, dans une seule application, les utilitaires qui font gagner du temps au quotidien : historique du presse-papiers, gestion des fenêtres, dictée vocale, assistant IA, mode concentration, captures d'écran, organisation des fichiers et des projets.",
  "about.p2":
    "Chaque outil est un module indépendant : vous installez uniquement ceux dont vous avez besoin et vous les activez ou désactivez en un clic. Seuls les outils actifs tournent en arrière-plan, ce qui garde votre système léger et rapide.",
  "about.p3":
    "Conçu pour le bureau GNOME, Powernux est pensé pour évoluer : de nouveaux outils peuvent être ajoutés et mis à jour sans réinstaller l'application.",

  "cat.Productivité": "Productivité",
  "cat.Fenêtres": "Fenêtres",
  "cat.IA": "IA",
  "cat.Capture": "Capture",
  "cat.Développement": "Développement",
  "cat.Fichiers": "Fichiers",
  "cat.Système": "Système",

  "size.kb": "{n} Ko",
  "size.mb": "{n} Mo",
};

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, fr };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translate(lang: Language, key: MessageKey, vars?: Record<string, string | number>): string {
  let text = DICTIONARIES[lang][key] ?? en[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) text = text.split(`{${k}}`).join(String(v));
  return text;
}

export function useLang(): Language {
  return useSettings().settings.language;
}

export function useT(): Translate {
  const lang = useLang();
  return (key, vars) => translate(lang, key, vars);
}

/** Libellé d'une catégorie d'outil (les manifests utilisent les noms français). */
export function categoryLabel(t: Translate, category: string): string {
  const key = `cat.${category}` as MessageKey;
  return key in en ? t(key) : category;
}

export function formatSize(t: Translate, bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return t("size.kb", { n: Math.round(bytes / 1024) });
  return t("size.mb", { n: (bytes / 1024 / 1024).toFixed(1) });
}
