//! Module Powernux « Notes » — bloc-notes structuré (carnets, notes, cases à cocher…).
//!
//! Ne tourne pas en arrière-plan : le programme démarre quand on ouvre la fenêtre et
//! s'arrête quand on la ferme (aucune ressource utilisée le reste du temps).
//!
//! Protocole :
//!   (aucun) / --reload    rien à démarrer : écrit status.json et quitte
//!   --show                ouvre la fenêtre (ou la ramène au premier plan)
//!   --quit                ferme la fenêtre si elle est ouverte
//!
//! Données : POWERNUX_HOME/data/notes/notes.json
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const MAX_STORE_BYTES: usize = 50 * 1024 * 1024;

fn powernux_home() -> PathBuf {
    if let Ok(p) = std::env::var("POWERNUX_HOME") {
        return PathBuf::from(p);
    }
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
    std::env::var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".local/share")).join("powernux")
}
fn tool_dir() -> PathBuf {
    powernux_home().join("tools/notes")
}
fn store_path() -> PathBuf {
    powernux_home().join("data/notes/notes.json")
}

fn settings() -> Value {
    fs::read_to_string(tool_dir().join("settings.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)
}

/// Notes et carnets (document JSON).
#[tauri::command]
fn load_store() -> Value {
    fs::read_to_string(store_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({ "notebooks": [], "notes": [] }))
}

/// Enregistre le document (écriture atomique : fichier temporaire puis renommage).
#[tauri::command]
fn save_store(store: Value) -> Result<(), String> {
    if !store["notes"].is_array() || !store["notebooks"].is_array() {
        return Err("Invalid notes document".into());
    }
    let text = serde_json::to_string(&store).map_err(|e| e.to_string())?;
    if text.len() > MAX_STORE_BYTES {
        return Err("Notes are too large".into());
    }
    let path = store_path();
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Langue de Powernux (transmise par le cœur dans settings.json).
#[tauri::command]
fn ui_language() -> String {
    settings()["_uiLanguage"].as_str().unwrap_or("en").to_string()
}

/// Ouvre un lien dans le navigateur (jamais dans la fenêtre des notes). http(s) uniquement.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) || url.chars().any(char::is_whitespace) {
        return Err("Unsupported link".into());
    }
    std::process::Command::new("xdg-open")
        .arg(&url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn write_status() {
    let status = json!({
        "level": "ok",
        "message": "Prêt : Win + Shift + N ouvre vos notes.",
        "messageEn": "Ready: Win + Shift + N opens your notes."
    });
    let _ = fs::write(tool_dir().join("status.json"), status.to_string());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    // Activation / démarrage de session : rien à garder en mémoire.
    if !args.iter().any(|a| a == "--show" || a == "--quit") {
        write_status();
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|a| a == "--quit") {
                app.exit(0);
            } else {
                show(app);
            }
        }))
        .setup(|app| {
            if std::env::args().any(|a| a == "--quit") {
                std::process::exit(0);
            }
            show(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_store, save_store, ui_language, open_url])
        .run(tauri::generate_context!())
        .expect("error while running powernux-notes");
}
