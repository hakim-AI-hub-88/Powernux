//! Préférences de l'application (langue, thème, couleur…) : document JSON stocké dans
//! `~/.config/powernux/preferences.json` (XDG_CONFIG_HOME). Elles survivent aux
//! redémarrages et aux mises à jour de l'application.
use serde_json::{Map, Value};
use std::{fs, path::PathBuf, sync::RwLock};
use tauri::{AppHandle, Emitter};

pub const CHANGED_EVENT: &str = "prefs://changed";
/// Langue par défaut à la première installation.
pub const DEFAULT_LANGUAGE: &str = "en";

static LANGUAGE: RwLock<Option<String>> = RwLock::new(None);

pub fn path() -> PathBuf {
    let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_default();
    std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join(".config"))
        .join("powernux")
        .join("preferences.json")
}

pub fn load() -> Map<String, Value> {
    fs::read_to_string(path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(prefs: &Map<String, Value>) -> Result<(), String> {
    let p = path();
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&p, serde_json::to_string_pretty(prefs).unwrap_or_default()).map_err(|e| e.to_string())
}

/// Langue de l'interface : "en" ou "fr".
pub fn language() -> String {
    if let Some(lang) = LANGUAGE.read().unwrap().clone() {
        return lang;
    }
    let lang = load().get("language").and_then(Value::as_str).unwrap_or(DEFAULT_LANGUAGE).to_string();
    *LANGUAGE.write().unwrap() = Some(lang.clone());
    lang
}

pub fn is_en() -> bool {
    language() != "fr"
}

/// Message dans la langue de l'interface : `tr!("français {x}", "english {x}")`.
#[macro_export]
macro_rules! tr {
    ($fr:literal, $en:literal $(,)?) => {
        if $crate::prefs::is_en() { format!($en) } else { format!($fr) }
    };
    ($fr:literal, $en:literal, $($arg:tt)+) => {
        if $crate::prefs::is_en() { format!($en, $($arg)+) } else { format!($fr, $($arg)+) }
    };
}

#[tauri::command]
pub fn prefs_get() -> Value {
    let mut prefs = load();
    prefs.entry("language").or_insert(Value::String(DEFAULT_LANGUAGE.into()));
    Value::Object(prefs)
}

/// Fusionne `patch` dans les préférences et les enregistre.
#[tauri::command]
pub fn prefs_set(app: AppHandle, patch: Map<String, Value>) -> Result<Value, String> {
    let mut prefs = load();
    for (k, v) in patch {
        prefs.insert(k, v);
    }
    if let Some(lang) = prefs.get("language").and_then(Value::as_str) {
        if lang != "en" && lang != "fr" {
            return Err("Unsupported language".into());
        }
        *LANGUAGE.write().unwrap() = Some(lang.to_string());
    }
    save(&prefs)?;
    let value = Value::Object(prefs);
    let _ = app.emit(CHANGED_EVENT, &value);
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_default_then_saved() {
        let dir = std::env::temp_dir().join(format!("powernux-prefs-{}", std::process::id()));
        unsafe { std::env::set_var("XDG_CONFIG_HOME", &dir) };
        *LANGUAGE.write().unwrap() = None;
        assert_eq!(language(), "en"); // première installation : anglais
        assert_eq!(crate::tr!("Bonjour", "Hello"), "Hello");

        let mut prefs = load();
        prefs.insert("language".into(), Value::String("fr".into()));
        save(&prefs).unwrap();
        *LANGUAGE.write().unwrap() = None; // simule un redémarrage
        assert_eq!(language(), "fr");
        assert_eq!(crate::tr!("Bonjour {}", "Hello {}", 2), "Bonjour 2");
        println!("{}", fs::read_to_string(path()).unwrap());
        let _ = fs::remove_dir_all(dir);
    }
}
