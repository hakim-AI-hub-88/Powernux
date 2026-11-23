// Appels au backend Rust (système de modules) et types partagés.
import { invoke } from "@tauri-apps/api/core";

export type SettingValue = string | number | boolean;

export interface SettingDef {
  key: string;
  type: "toggle" | "select" | "shortcut" | "text" | "secret";
  label: string;
  description: string;
  default: SettingValue;
  options: { value: SettingValue; label: string; advanced?: boolean }[];
  /** Réglage réservé au mode développeur avancé. */
  advanced?: boolean;
  showIf?: { key: string; value: unknown } | null;
}

export interface ActionDef {
  id: string;
  label: string;
  icon: string;
  args: string[];
  confirm?: string | null;
}

export interface FieldDef {
  key: string;
  type: "text" | "number" | "toggle" | "select" | "apps" | "shortcut";
  label: string;
  description: string;
  placeholder: string;
  default: unknown;
  options: { value: SettingValue; label: string }[];
  min: number | null;
  max: number | null;
  showIf: { key: string; value: unknown } | null;
}

export interface DesktopApp {
  id: string;
  name: string;
}

export interface CollectionDef {
  id: string;
  label: string;
  description: string;
  empty: string;
  create: { label: string; placeholder: string; fields: FieldDef[] } | null;
  itemActions: { id: string; label: string; icon: string; confirm?: string | null; primary: boolean; field?: FieldDef | null }[];
}

export interface CollectionItem {
  id: string;
  name: string;
  description: string;
}

export interface Manifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  settings: SettingDef[];
  actions: ActionDef[];
  collections: CollectionDef[];
  i18n?: unknown;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  author: string | null;
  latestVersion: string | null;
  installedVersion: string | null;
  installed: boolean;
  enabled: boolean;
  downloadable: boolean;
  downloadSize: number;
  updateAvailable: boolean;
  requiresPowernux: string | null;
  manifest: Manifest | null;
  settings: Record<string, SettingValue>;
  /** Message du module lui-même (ex. action requise). */
  status: { level: "ok" | "warning" | "error"; message: string; messageEn?: string | null } | null;
  i18n?: unknown;
}

export interface ToolsList {
  tools: Tool[];
  registryUrl: string;
  registryError: string | null;
  autostart: boolean;
  coreVersion: string;
  platform: string;
  gnome: boolean;
}

export type Stage = "download" | "verify" | "install" | "activate" | "done" | "error";

export interface Progress {
  id: string;
  stage: Stage;
  downloaded: number;
  total: number;
  message: string | null;
}

export const PROGRESS_EVENT = "tools://progress";
export const CHANGED_EVENT = "tools://changed";

export interface AppUpdate {
  current: string;
  latest: string | null;
  available: boolean;
  url: string | null;
  digest: string | null;
  page: string | null;
}

export const api = {
  list: (refresh = false) => invoke<ToolsList>("tools_list", { refresh }),
  install: (id: string) => invoke<void>("tool_install", { id }),
  remove: (id: string) => invoke<void>("tool_remove", { id }),
  setEnabled: (id: string, enabled: boolean) => invoke<void>("tool_set_enabled", { id, enabled }),
  setSetting: (id: string, key: string, value: SettingValue) => invoke<void>("tool_set_setting", { id, key, value }),
  action: (id: string, action: string) => invoke<void>("tool_action", { id, action }),
  shortcutConflict: (id: string, shortcut: string) => invoke<string | null>("shortcut_conflict", { id, shortcut }),
  setRegistryUrl: (url: string | null) => invoke<void>("set_registry_url", { url }),
  collectionList: (id: string, collection: string) =>
    invoke<CollectionItem[]>("tool_collection_list", { id, collection }),
  collectionAction: (
    id: string,
    collection: string,
    action: string,
    item?: string,
    value?: string,
    json?: Record<string, unknown>,
  ) =>
    invoke<void>("tool_collection_action", {
      id,
      collection,
      action,
      item: item ?? null,
      value: value ?? null,
      json: json ?? null,
    }),
  systemApps: () => invoke<DesktopApp[]>("system_apps"),
  setAutostart: (enabled: boolean) => invoke<void>("set_autostart", { enabled }),
  uninstallAll: () => invoke<void>("uninstall_all"),
  checkUpdate: () => invoke<AppUpdate>("check_app_update"),
  installUpdate: (url: string, digest: string | null) => invoke<void>("install_app_update", { url, digest }),
};
