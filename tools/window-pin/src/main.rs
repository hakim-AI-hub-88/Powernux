//! Module Powernux « Smart Window Manager » — programme indépendant (sans fenêtre).
//!
//! Sous Wayland, seul GNOME Shell peut agir sur les fenêtres des autres applications :
//! ce module installe une extension GNOME Shell (embarquée dans le binaire) et lui
//! transmet les commandes via D-Bus.
//!
//! Protocole avec Powernux Core :
//!   (aucun)                  installe/active l'extension, écrit status.json
//!   --toggle                 Always On Top sur la fenêtre active (raccourci)
//!   --unpin-all              désépingle toutes les fenêtres
//!   --arrange                organise les fenêtres du bureau courant (raccourci / action)
//!   --layouts-json           liste des espaces de travail (JSON pour Powernux)
//!   --save-layout <json>     enregistre la disposition actuelle ({name, shortcut} ou simple nom)
//!   --restore-layout <id>    restaure un espace de travail (relance les applications fermées)
//!   --set-layout-shortcut <id> <raccourci>   raccourci d'un espace ("" = aucun)
//!   --delete-layout <id>     supprime un espace de travail
//!
//! Chaque espace peut avoir son raccourci clavier GNOME (powernux-window-pin-layout-<id>),
//! qui lance `powernux-window-pin --restore-layout <id>` sans ouvrir Powernux.
//!   --reload                 rien à faire : l'extension surveille settings.json
//!   --quit / --uninstall     désactive / supprime l'extension
use powernux_gnome_extension::{is_gnome, keybindings, notify, powernux_home, Extension, RELOGIN, RELOGIN_EN};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::ExitCode};

const EXT: Extension = Extension {
    tool_id: "window-pin",
    uuid: "powernux-window-pin@powernux",
    dbus_path: "/org/powernux/WindowPin",
    dbus_iface: "org.powernux.WindowPin",
    files: &[
        ("metadata.json", include_str!("../extension/metadata.json")),
        ("extension.js", include_str!("../extension/extension.js")),
        ("stylesheet.css", include_str!("../extension/stylesheet.css")),
    ],
};

fn layouts_path() -> PathBuf {
    powernux_home().join("data").join("window-pin").join("layouts.json")
}

/// Raccourcis des espaces de travail : { "<id>": "<Super><Alt>1" }.
fn shortcuts_path() -> PathBuf {
    powernux_home().join("data").join("window-pin").join("layout-shortcuts.json")
}

fn load_shortcuts() -> serde_json::Map<String, Value> {
    fs::read_to_string(shortcuts_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_shortcuts(map: &serde_json::Map<String, Value>) -> Result<(), String> {
    let path = shortcuts_path();
    let _ = fs::create_dir_all(path.parent().unwrap());
    fs::write(path, serde_json::to_string_pretty(map).unwrap_or_default()).map_err(|e| e.to_string())
}

fn english() -> bool {
    EXT.settings()["_uiLanguage"].as_str() != Some("fr")
}

/// Raccourci lisible : "<Super><Alt>1" → "Win + Alt + 1".
fn readable(accel: &str) -> String {
    let mut parts = Vec::new();
    let mut rest = accel;
    while let (Some(a), Some(b)) = (rest.find('<'), rest.find('>')) {
        parts.push(if &rest[a + 1..b] == "Super" { "Win".to_string() } else { rest[a + 1..b].to_string() });
        rest = &rest[b + 1..];
    }
    parts.push(rest.to_uppercase());
    parts.join(" + ")
}

/// (Ré)enregistre dans GNOME les raccourcis de tous les espaces de travail.
fn sync_layout_shortcuts() {
    if !is_gnome() {
        return;
    }
    let _ = keybindings::unregister_prefix("window-pin-layout-");
    let Ok(exe) = std::env::current_exe() else { return };
    let layouts = load_layouts();
    for (id, accel) in load_shortcuts() {
        let (Some(accel), Some(layout)) = (accel.as_str(), layouts.iter().find(|l| l["id"].as_str() == Some(&id))) else {
            continue;
        };
        let name = layout["name"].as_str().unwrap_or("Workspace");
        let command = format!("\"{}\" --restore-layout \"{id}\"", exe.display());
        let _ = keybindings::register(&format!("window-pin-layout-{id}"), &format!("Workspace « {name} »"), &command, accel);
    }
}

/// Vérifie qu'un raccourci n'est pas déjà utilisé (système, autres outils, autres espaces).
fn check_shortcut(id: &str, accel: &str) -> Result<(), String> {
    let en = english();
    let settings = EXT.settings();
    let own = ["shortcut", "arrangeShortcut"].iter().any(|k| settings[*k].as_str() == Some(accel));
    let other_layout = load_shortcuts().iter().any(|(other, a)| other != id && a.as_str() == Some(accel));
    let system = keybindings::find_conflict(accel, "window-pin-layout-");
    if own || other_layout || system.is_some() {
        let by = system.unwrap_or_else(|| "Smart Window Manager".into());
        return Err(if en {
            format!("{} is already used ({by}). Choose another shortcut.", readable(accel))
        } else {
            format!("{} est déjà utilisé ({by}). Choisissez un autre raccourci.", readable(accel))
        });
    }
    Ok(())
}

fn set_layout_shortcut(id: &str, accel: &str) -> Result<(), String> {
    if !load_layouts().iter().any(|l| l["id"].as_str() == Some(id)) {
        return Err(if english() { "Workspace not found.".into() } else { "Espace de travail introuvable.".into() });
    }
    let accel = accel.trim();
    let mut map = load_shortcuts();
    if accel.is_empty() {
        map.remove(id);
    } else {
        check_shortcut(id, accel)?;
        map.insert(id.to_string(), Value::String(accel.to_string()));
    }
    save_shortcuts(&map)?;
    sync_layout_shortcuts();
    Ok(())
}

fn load_layouts() -> Vec<Value> {
    fs::read_to_string(layouts_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// Chaîne au format GVariant pour `gdbus call`.
fn gvariant_str(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// Appel à l'extension ; si elle n'est pas chargée, message clair.
fn call(method: &str, args: &[&str]) -> Result<String, String> {
    EXT.dbus_call(method, args).map_err(|_| RELOGIN.to_string())
}

fn layouts_json() -> String {
    let shortcuts = load_shortcuts();
    let en = english();
    let items: Vec<Value> = load_layouts()
        .iter()
        .map(|l| {
            let windows = l["windows"].as_array().cloned().unwrap_or_default();
            let mut apps: Vec<String> = Vec::new();
            for w in &windows {
                if let Some(name) = w["appName"].as_str() {
                    if !apps.iter().any(|a| a == name) {
                        apps.push(name.to_string());
                    }
                }
            }
            let windows_text =
                if en { format!("{} window(s)", windows.len()) } else { format!("{} fenêtre(s)", windows.len()) };
            let key = l["id"].as_str().and_then(|id| shortcuts.get(id)).and_then(Value::as_str).map(readable);
            let description = match key {
                Some(k) => format!("⌨ {k} · {windows_text} · {}", apps.join(", ")),
                None => format!("{windows_text} · {}", apps.join(", ")),
            };
            json!({ "id": l["id"], "name": l["name"], "description": description })
        })
        .collect();
    Value::Array(items).to_string()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or("");

    let result: Result<(), String> = match arg(1) {
        "" => {
            sync_layout_shortcuts();
            match EXT.install_and_enable() {
                Ok(true) => EXT.write_status("ok", "Prêt : Win + Shift + T épingle une fenêtre, Win + Shift + O organise les fenêtres.", "Ready: Win + Shift + T pins a window, Win + Shift + O arranges windows."),
                Ok(false) => EXT.write_status("warning", RELOGIN, RELOGIN_EN),
                Err(e) => EXT.write_status("error", &e, &e),
            }
            Ok(())
        }
        "--toggle" => call("Toggle", &[]).map(|_| ()),
        "--unpin-all" => call("UnpinAll", &[]).map(|_| ()),
        "--arrange" => call("Arrange", &[]).map(|_| ()),
        "--layouts-json" => {
            println!("{}", layouts_json());
            Ok(())
        }
        "--save-layout" => {
            // Formulaire de Powernux : {"name": "...", "shortcut": "..."} (ou simple nom).
            let input: Value = serde_json::from_str(arg(2)).unwrap_or_else(|_| json!({ "name": arg(2) }));
            let name = input["name"].as_str().unwrap_or("").trim().to_string();
            let accel = input["shortcut"].as_str().unwrap_or("").trim().to_string();
            let en = english();
            if name.is_empty() {
                Err(if en { "Give the workspace a name.".into() } else { "Donnez un nom à l'espace de travail.".into() })
            } else {
                let existing = load_layouts()
                    .iter()
                    .find(|l| l["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(&name)))
                    .and_then(|l| l["id"].as_str().map(String::from))
                    .unwrap_or_default();
                if !accel.is_empty() {
                    if let Err(e) = check_shortcut(&existing, &accel) {
                        return { eprint!("{e}"); ExitCode::FAILURE };
                    }
                }
                call("SaveLayout", &[&gvariant_str(&name)]).and_then(|out| {
                    if out.contains("(0,)") {
                        return Err(if en {
                            "No window to save on the current workspace.".into()
                        } else {
                            "Aucune fenêtre à enregistrer sur le bureau courant.".into()
                        });
                    }
                    if accel.is_empty() {
                        return Ok(());
                    }
                    let id = load_layouts()
                        .iter()
                        .find(|l| l["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(&name)))
                        .and_then(|l| l["id"].as_str().map(String::from))
                        .unwrap_or_default();
                    set_layout_shortcut(&id, &accel)
                })
            }
        }
        "--set-layout-shortcut" => set_layout_shortcut(arg(2), arg(3)),
        "--restore-layout" => call("RestoreLayout", &[&gvariant_str(arg(2))]).and_then(|out| {
            if out.contains("false") { Err("Espace de travail introuvable.".into()) } else { Ok(()) }
        }),
        "--delete-layout" => {
            let mut layouts = load_layouts();
            layouts.retain(|l| l["id"].as_str() != Some(arg(2)));
            let mut map = load_shortcuts();
            map.remove(arg(2));
            let _ = save_shortcuts(&map);
            sync_layout_shortcuts();
            fs::write(layouts_path(), serde_json::to_string_pretty(&layouts).unwrap_or_default()).map_err(|e| e.to_string())
        }
        // Powernux réenregistre ses raccourcis puis appelle --reload : on remet ceux des espaces.
        "--reload" => {
            sync_layout_shortcuts();
            Ok(())
        }
        "--quit" => {
            EXT.disable();
            Ok(())
        }
        "--uninstall" => {
            EXT.uninstall();
            Ok(())
        }
        other => Err(format!("Argument inconnu : {other}")),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            // Lancé depuis un raccourci clavier : notification ; depuis Powernux : message d'erreur.
            if matches!(arg(1), "--toggle" | "--arrange" | "--restore-layout") {
                notify("view-grid-symbolic", "Smart Window Manager", &e);
            }
            eprint!("{e}");
            ExitCode::FAILURE
        }
    }
}
