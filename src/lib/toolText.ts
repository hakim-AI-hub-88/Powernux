// Textes des outils dans la langue de l'interface.
// Les manifests sont écrits en français ; la traduction anglaise est dans leur bloc « i18n.en ».
import type { ActionDef, CollectionDef, FieldDef, SettingDef, Tool } from "./api";
import type { Language } from "../state/settings";
import { useLang } from "../i18n";

type Dict = Record<string, unknown>;
const obj = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function toolText(tool: Tool, lang: Language) {
  const tr = lang === "fr" ? {} : obj(obj(tool.i18n)[lang] ?? obj(tool.manifest?.i18n)[lang]);
  const settings = obj(tr.settings);
  const actions = obj(tr.actions);
  const collections = obj(tr.collections);

  return {
    name: str(tr.name) ?? tool.name,
    description: str(tr.description) ?? tool.description,
    setting: (d: SettingDef) => {
      const s = obj(settings[d.key]);
      return { label: str(s.label) ?? d.label, description: str(s.description) ?? d.description };
    },
    option: (d: SettingDef | FieldDef, value: unknown, fallback: string) =>
      str(obj(obj(settings[d.key]).options)[String(value)]) ?? fallback,
    action: (a: ActionDef) => str(actions[a.id]) ?? a.label,
    collection: (c: CollectionDef) => {
      const ct = obj(collections[c.id]);
      const create = obj(ct.create);
      const fields = obj(create.fields);
      const items = obj(ct.itemActions);
      return {
        label: str(ct.label) ?? c.label,
        description: str(ct.description) ?? c.description,
        empty: str(ct.empty) ?? c.empty,
        createLabel: str(create.label) ?? c.create?.label ?? "",
        createPlaceholder: str(create.placeholder) ?? c.create?.placeholder ?? "",
        field: (f: FieldDef) => {
          const ft = obj(fields[f.key]);
          return {
            label: str(ft.label) ?? f.label,
            description: str(ft.description) ?? f.description,
            placeholder: str(ft.placeholder) ?? f.placeholder,
            option: (value: unknown, fallback: string) => str(obj(ft.options)[String(value)]) ?? fallback,
          };
        },
        itemAction: (a: { id: string; label: string }) => str(items[a.id]) ?? a.label,
        itemField: (a: { id: string; field?: FieldDef | null }) => {
          const ft = obj(obj(ct.itemFields)[a.id]);
          return {
            label: str(ft.label) ?? a.field?.label ?? "",
            description: str(ft.description) ?? a.field?.description ?? "",
            placeholder: str(ft.placeholder) ?? a.field?.placeholder ?? "",
            option: (_value: unknown, fallback: string) => fallback,
          };
        },
      };
    },
    status: tool.status
      ? { ...tool.status, message: (lang === "en" && tool.status.messageEn) || tool.status.message }
      : null,
  };
}

export function useToolText() {
  const lang = useLang();
  return (tool: Tool) => toolText(tool, lang);
}
