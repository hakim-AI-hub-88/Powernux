//! Raccourcis clavier globaux des modules, via les raccourcis personnalisés de GNOME.
//!
//! Sous Wayland, une application ne peut pas capturer un raccourci global elle-même :
//! on demande à GNOME de lancer la commande du module (ex. `powernux-clipboard --show`).
//! Chaque raccourci a un identifiant `powernux-<outil>-<n>`.
use std::{collections::BTreeSet, process::Command};

const SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";
const BASE: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/";
const PREFIX: &str = "powernux-";

fn path_for(id: &str) -> String {
    format!("{BASE}{id}/")
}

/// Schémas GNOME consultés pour détecter un raccourci déjà utilisé.
const CONFLICT_SCHEMAS: &[&str] = &[
    "org.gnome.shell.keybindings",
    "org.gnome.desktop.wm.keybindings",
    "org.gnome.mutter.keybindings",
    "org.gnome.mutter.wayland.keybindings",
    "org.gnome.settings-daemon.plugins.media-keys",
];

pub fn is_gnome() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP").map(|d| d.to_lowercase().contains("gnome")).unwrap_or(false)
}

fn gsettings(args: &[&str]) -> Result<String, String> {
    let out = Command::new("gsettings").args(args).output().map_err(|e| crate::tr!("gsettings introuvable : {e}", "gsettings not found: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Chaîne au format GVariant : 'texte'.
fn gvariant_str(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// Extrait les chaînes d'un tableau GVariant (`@as []`, `['a', 'b']`).
fn parse_str_array(s: &str) -> Vec<String> {
    s.split('\'').skip(1).step_by(2).map(String::from).collect()
}

fn custom_list() -> Result<Vec<String>, String> {
    Ok(parse_str_array(&gsettings(&["get", SCHEMA, "custom-keybindings"])?))
}

fn set_custom_list(list: &[String]) -> Result<(), String> {
    let value = format!("[{}]", list.iter().map(|p| gvariant_str(p)).collect::<Vec<_>>().join(", "));
    gsettings(&["set", SCHEMA, "custom-keybindings", &value]).map(|_| ())
}

fn custom_schema(path: &str) -> String {
    format!("{SCHEMA}.custom-keybinding:{path}")
}

/// Forme normalisée d'un accélérateur : modificateurs triés + touche en minuscule.
fn normalize(accel: &str) -> (BTreeSet<String>, String) {
    let mut mods = BTreeSet::new();
    let mut rest = accel;
    while let Some(start) = rest.find('<') {
        let Some(end) = rest[start..].find('>') else { break };
        let m = rest[start + 1..start + end].to_lowercase();
        let m = match m.as_str() {
            "control" | "primary" => "ctrl".to_string(),
            "mod4" => "super".to_string(),
            _ => m,
        };
        mods.insert(m);
        rest = &rest[start + end + 1..];
    }
    (mods, rest.to_lowercase())
}

/// Cherche un raccourci GNOME existant identique (hors raccourcis de l'outil `own_tool`).
pub fn find_conflict(accel: &str, own_tool: &str) -> Option<String> {
    let wanted = normalize(accel);
    for schema in CONFLICT_SCHEMAS {
        let Ok(out) = gsettings(&["list-recursively", schema]) else { continue };
        for line in out.lines() {
            let mut parts = line.splitn(3, ' ');
            let (Some(s), Some(key), Some(value)) = (parts.next(), parts.next(), parts.next()) else { continue };
            for candidate in parse_str_array(value) {
                if !candidate.is_empty() && normalize(&candidate) == wanted {
                    return Some(format!("{s} {key}"));
                }
            }
        }
    }
    let own = path_for(&format!("{PREFIX}{own_tool}-"));
    let own = own.trim_end_matches('/');
    for path in custom_list().unwrap_or_default() {
        if path.starts_with(own) {
            continue;
        }
        let schema = custom_schema(&path);
        if let Ok(b) = gsettings(&["get", &schema, "binding"]) {
            if parse_str_array(&b).first().is_some_and(|c| normalize(c) == wanted) {
                let name = gsettings(&["get", &schema, "name"]).unwrap_or_default();
                return Some(crate::tr!("raccourci personnalisé {name}", "custom shortcut {name}"));
            }
        }
    }
    None
}

/// Enregistre (ou met à jour) un raccourci GNOME `powernux-<key>`.
pub fn register(key: &str, name: &str, command: &str, accel: &str) -> Result<(), String> {
    if !is_gnome() {
        return Err(crate::tr!("Les raccourcis globaux ne sont pris en charge que sous GNOME pour l'instant.", "Global shortcuts are only supported on GNOME for now."));
    }
    let path = path_for(&format!("{PREFIX}{key}"));
    let schema = custom_schema(&path);
    gsettings(&["set", &schema, "name", &gvariant_str(&format!("Powernux — {name}"))])?;
    gsettings(&["set", &schema, "command", &gvariant_str(command)])?;
    gsettings(&["set", &schema, "binding", &gvariant_str(accel)])?;
    let mut list = custom_list()?;
    if !list.contains(&path) {
        list.push(path);
        set_custom_list(&list)?;
    }
    Ok(())
}

/// Supprime tous les raccourcis GNOME dont l'identifiant commence par `powernux-<key_prefix>`.
pub fn unregister_prefix(key_prefix: &str) -> Result<(), String> {
    if !is_gnome() {
        return Ok(());
    }
    let prefix = format!("{BASE}{PREFIX}{key_prefix}");
    let list = custom_list()?;
    let (removed, kept): (Vec<String>, Vec<String>) = list.into_iter().partition(|p| p.starts_with(&prefix));
    if removed.is_empty() {
        return Ok(());
    }
    set_custom_list(&kept)?;
    for path in removed {
        let schema = custom_schema(&path);
        for key in ["name", "command", "binding"] {
            let _ = gsettings(&["reset", &schema, key]);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_arrays() {
        assert!(parse_str_array("@as []").is_empty());
        assert_eq!(parse_str_array("['<Super>v', '<Super>m']"), vec!["<Super>v", "<Super>m"]);
    }

    #[test]
    fn normalize_ignores_order_and_aliases() {
        assert_eq!(normalize("<Super><Shift>v"), normalize("<Shift><Super>V"));
        assert_eq!(normalize("<Primary><Alt>t"), normalize("<Ctrl><Alt>t"));
        assert_ne!(normalize("<Super>v"), normalize("<Super><Shift>v"));
    }

    #[test]
    fn detects_gnome_conflicts() {
        if !is_gnome() {
            return;
        }
        // Super+V ouvre les notifications sous GNOME.
        println!("<Super>v -> {:?}", find_conflict("<Super>v", "clipboard"));
        println!("<Super><Shift>v -> {:?}", find_conflict("<Super><Shift>v", "clipboard"));
        assert!(find_conflict("<Super>v", "clipboard").is_some());
    }
}
