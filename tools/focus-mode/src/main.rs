//! Module Powernux « Focus Mode » — programme indépendant (sans fenêtre).
//!
//! L'extension GNOME Shell embarquée gère la session (minuteur, Pomodoro, notch,
//! notifications, applications bloquées). Ce programme gère les modes et lui
//! transmet les commandes via D-Bus.
//!
//! Protocole :
//!   (aucun)                 installe/active l'extension, crée les modes par défaut
//!   --modes-json            liste des modes (JSON pour Powernux)
//!   --create-mode <json>    crée un mode    --delete-mode <id>   supprime un mode
//!   --start-mode <id>       démarre une session
//!   --toggle-pause          pause / reprise (raccourci)   --skip   phase suivante
//!   --stop                  arrête la session
//!   --reload                rien à faire : l'extension surveille settings.json
//!   --quit / --uninstall    arrête la session et désactive / supprime l'extension
use powernux_gnome_extension::{apps, notify, powernux_home, Extension, RELOGIN, RELOGIN_EN};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::ExitCode, time::SystemTime};

const EXT: Extension = Extension {
    tool_id: "focus-mode",
    uuid: "powernux-focus-mode@powernux",
    dbus_path: "/org/powernux/FocusMode",
    dbus_iface: "org.powernux.FocusMode",
    files: &[
        ("metadata.json", include_str!("../extension/metadata.json")),
        ("extension.js", include_str!("../extension/extension.js")),
        ("stylesheet.css", include_str!("../extension/stylesheet.css")),
        ("notch.js", include_str!("../../shared/notch/notch.js")),
    ],
};

fn modes_path() -> PathBuf {
    powernux_home().join("data").join("focus-mode").join("modes.json")
}

fn load_modes() -> Vec<Value> {
    fs::read_to_string(modes_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_modes(modes: &[Value]) -> Result<(), String> {
    let path = modes_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, serde_json::to_string_pretty(modes).unwrap_or_default()).map_err(|e| e.to_string())
}

fn new_id() -> String {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis().to_string()).unwrap_or_default()
}

/// Modes proposés au premier démarrage (uniquement avec les applications installées).
fn seed_defaults() {
    if modes_path().exists() {
        return;
    }
    let keep = |ids: &[&str]| -> Vec<String> { ids.iter().filter(|id| apps::exists(id)).map(|s| s.to_string()).collect() };
    let modes = vec![
        json!({
            "id": "pomodoro", "name": "Pomodoro", "pomodoro": true,
            "work": 25, "shortBreak": 5, "longBreak": 15, "cycles": 4,
            "dnd": true, "apps": [], "blockApps": [], "minimizeOthers": false
        }),
        json!({
            "id": "etude-ia", "name": "Étude IA", "pomodoro": false, "duration": 90,
            "apps": keep(&["com.microsoft.VSCode.desktop", "code.desktop", "org.gnome.Ptyxis.desktop",
                "org.gnome.Terminal.desktop", "firefox_firefox.desktop", "firefox.desktop"]),
            "blockApps": keep(&["telegram-desktop_telegram-desktop.desktop", "org.telegram.desktop.desktop",
                "discord.desktop", "discord_discord.desktop", "slack_slack.desktop"]),
            "dnd": true, "minimizeOthers": true
        }),
    ];
    let _ = save_modes(&modes);
}

fn describe(mode: &Value) -> String {
    let mut parts = Vec::new();
    if mode["pomodoro"].as_bool().unwrap_or(false) {
        parts.push(format!(
            "Pomodoro {}/{} min · {} sessions",
            mode["work"].as_u64().unwrap_or(25),
            mode["shortBreak"].as_u64().unwrap_or(5),
            mode["cycles"].as_u64().unwrap_or(4)
        ));
    } else {
        parts.push(format!("{} min", mode["duration"].as_u64().unwrap_or(90)));
    }
    let list = |key: &str| -> Vec<String> {
        mode[key].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
    };
    let open = apps::names(&list("apps"));
    if !open.is_empty() {
        parts.push(format!("ouvre {}", open.join(", ")));
    }
    if mode["dnd"].as_bool().unwrap_or(false) {
        parts.push("notifications coupées".into());
    }
    let blocked = apps::names(&list("blockApps"));
    if !blocked.is_empty() {
        parts.push(format!("bloque {}", blocked.join(", ")));
    }
    parts.join(" · ")
}

fn modes_json() -> String {
    let items: Vec<Value> = load_modes()
        .iter()
        .map(|m| json!({ "id": m["id"], "name": m["name"], "description": describe(m) }))
        .collect();
    Value::Array(items).to_string()
}

fn create_mode(raw: &str) -> Result<(), String> {
    let mut mode: Value = serde_json::from_str(raw).map_err(|_| "Données du mode invalides.".to_string())?;
    let name = mode["name"].as_str().unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Err("Donnez un nom au mode.".into());
    }
    let mut modes = load_modes();
    if modes.iter().any(|m| m["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(&name))) {
        return Err(format!("Un mode « {name} » existe déjà."));
    }
    mode["id"] = json!(new_id());
    mode["name"] = json!(name);
    modes.push(mode);
    save_modes(&modes)
}

fn gvariant_str(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn call(method: &str, args: &[&str]) -> Result<String, String> {
    EXT.dbus_call(method, args).map_err(|_| RELOGIN.to_string())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or("");

    let result: Result<(), String> = match arg(1) {
        "" => {
            seed_defaults();
            match EXT.install_and_enable() {
                Ok(true) => EXT.write_status("ok", "Prêt : démarrez un mode ci-dessous. Win + Shift + F met en pause.", "Ready: start a mode below. Win + Shift + F pauses."),
                Ok(false) => EXT.write_status("warning", RELOGIN, RELOGIN_EN),
                Err(e) => EXT.write_status("error", &e, &e),
            }
            Ok(())
        }
        "--modes-json" => {
            seed_defaults();
            println!("{}", modes_json());
            Ok(())
        }
        "--create-mode" => create_mode(arg(2)),
        "--delete-mode" => {
            let mut modes = load_modes();
            modes.retain(|m| m["id"].as_str() != Some(arg(2)));
            save_modes(&modes)
        }
        "--start-mode" => match load_modes().into_iter().find(|m| m["id"].as_str() == Some(arg(2))) {
            Some(mode) => call("StartSession", &[&gvariant_str(&mode.to_string())]).map(|_| ()),
            None => Err("Mode introuvable.".into()),
        },
        "--toggle-pause" => call("TogglePause", &[]).map(|_| ()),
        "--skip" => call("Skip", &[]).map(|_| ()),
        "--stop" => call("Stop", &[]).map(|_| ()),
        "--reload" => Ok(()),
        "--quit" => {
            let _ = EXT.dbus_call("Stop", &[]);
            EXT.disable();
            Ok(())
        }
        "--uninstall" => {
            let _ = EXT.dbus_call("Stop", &[]);
            EXT.uninstall();
            Ok(())
        }
        other => Err(format!("Argument inconnu : {other}")),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            if arg(1) == "--toggle-pause" {
                notify("alarm-symbolic", "Focus Mode", &e);
            }
            eprint!("{e}");
            ExitCode::FAILURE
        }
    }
}
