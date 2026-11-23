import { useEffect, useState } from "react";
import { faKeyboard, faXmark } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "./Icons";
import { useT } from "../i18n";
import { displayKeys, keyFromCode, PRESETS, toAccel, type ParsedShortcut } from "../lib/shortcut";

interface Props {
  value: string;
  onChange: (accel: string) => void;
  disabled?: boolean;
  /** Suggestions (par défaut : raccourcis du presse-papiers). */
  presets?: string[];
  /** Permet de ne choisir aucun raccourci. */
  optional?: boolean;
}

export function Keys({ accel }: { accel: string }) {
  return (
    <span className="keys">
      {displayKeys(accel).map((k, i) => (
        <span key={i}>
          {i > 0 && <span className="plus">+</span>}
          <kbd>{k}</kbd>
        </span>
      ))}
    </span>
  );
}

/** Enregistreur de raccourci : cliquer puis appuyer sur la combinaison voulue. */
export default function ShortcutRecorder({ value, onChange, disabled, presets = PRESETS, optional }: Props) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    if (!recording) return;
    // La touche Super n'est pas toujours signalée via metaKey : on la suit à la main.
    let superHeld = false;
    const isSuper = (k: string) => k === "Meta" || k === "OS" || k === "Super" || k === "Hyper";

    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isSuper(e.key)) {
        superHeld = true;
        return;
      }
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !superHeld) {
        setRecording(false);
        return;
      }
      if (["Control", "Alt", "Shift", "AltGraph"].includes(e.key)) return;
      const key = keyFromCode(e.code);
      if (!key) {
        setHint(t("shortcut.unsupported"));
        return;
      }
      const parsed: ParsedShortcut = { mods: [], key };
      if (superHeld || e.metaKey) parsed.mods.push("Super");
      if (e.ctrlKey) parsed.mods.push("Ctrl");
      if (e.altKey) parsed.mods.push("Alt");
      if (e.shiftKey) parsed.mods.push("Shift");
      if (!parsed.mods.some((m) => m !== "Shift")) {
        setHint(t("shortcut.needModifier"));
        return;
      }
      setRecording(false);
      onChange(toAccel(parsed));
    };
    const up = (e: KeyboardEvent) => {
      if (isSuper(e.key)) superHeld = false;
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, onChange]);

  return (
    <div className={`shortcut-recorder ${optional ? "compact" : ""}`}>
      <div className="shortcut-row">
        {recording ? (
          <span className="recording">{t("shortcut.press")}</span>
        ) : value ? (
          <Keys accel={value} />
        ) : (
          <span className="muted">{t("shortcut.none")}</span>
        )}
        <button
          type="button"
          className="btn secondary small"
          disabled={disabled}
          onClick={() => {
            setHint("");
            setRecording((r) => !r);
          }}
        >
          <Icon icon={recording ? faXmark : faKeyboard} /> {recording ? t("common.cancel") : t("shortcut.change")}
        </button>
        {optional && value && !recording && (
          <button type="button" className="btn secondary small" disabled={disabled} onClick={() => onChange("")}>
            {t("shortcut.clear")}
          </button>
        )}
      </div>
      {hint && recording && <p className="hint">{hint}</p>}
      {presets.length > 0 && (
      <div className="presets">
        <span className="muted">{t("shortcut.suggestions")}</span>
        {presets.map((p) => (
          <button key={p} type="button" className={`chip small ${p === value ? "active" : ""}`} disabled={disabled} onClick={() => onChange(p)}>
            {displayKeys(p).join(" + ")}
          </button>
        ))}
      </div>
      )}
    </div>
  );
}
