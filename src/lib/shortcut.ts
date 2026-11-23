// Conversion entre les raccourcis GNOME ("<Super><Shift>v") et l'affichage ("Super + Shift + V").

const MOD_ORDER = ["Super", "Ctrl", "Alt", "Shift"] as const;
type Mod = (typeof MOD_ORDER)[number];

export interface ParsedShortcut {
  mods: Mod[];
  key: string;
}

export function parseAccel(accel: string): ParsedShortcut {
  const mods: Mod[] = [];
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(accel))) {
    const name = m[1].toLowerCase();
    if (name === "super" || name === "mod4") mods.push("Super");
    else if (name === "ctrl" || name === "control" || name === "primary") mods.push("Ctrl");
    else if (name === "alt") mods.push("Alt");
    else if (name === "shift") mods.push("Shift");
  }
  return { mods: MOD_ORDER.filter((x) => mods.includes(x)), key: accel.replace(re, "") };
}

export function toAccel({ mods, key }: ParsedShortcut): string {
  return MOD_ORDER.filter((x) => mods.includes(x)).map((x) => `<${x}>`).join("") + key;
}

export function displayKeys(accel: string): string[] {
  const { mods, key } = parseAccel(accel);
  const k = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
  // Affichage : la touche Super est la touche Windows du clavier.
  return [...mods.map((m) => (m === "Super" ? "Win" : m)), k];
}

/** Touche (nom GNOME) à partir d'un KeyboardEvent.code, ou null si non prise en charge. */
export function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  const map: Record<string, string> = {
    Space: "space",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "Page_Up",
    PageDown: "Page_Down",
    Backquote: "grave",
    Period: "period",
    Comma: "comma",
  };
  return map[code] ?? null;
}

export const PRESETS = ["<Super><Shift>v", "<Super><Alt>v", "<Ctrl><Alt>v", "<Ctrl><Alt><Shift>v"];
