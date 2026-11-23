//! Module Powernux « Screenshot » — programme indépendant (sans fenêtre).
//!
//! GNOME possède déjà un excellent outil de capture (zone / fenêtre / écran, copie dans le
//! presse-papiers, enregistrement dans Images/Screenshots), ouvert par la touche Impr.
//! Ce module y ajoute le raccourci choisi (Win + Shift + S par défaut), sans retirer Impr.
//!
//! Protocole :
//!   (aucun) / --reload    ajoute (ou met à jour) le raccourci
//!   --quit                retire le raccourci (Impr reste disponible)
//!   --open-folder         ouvre le dossier des captures
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    process::{Command, ExitCode, Stdio},
};

const SCHEMA: &str = "org.gnome.shell.keybindings";
const KEY: &str = "show-screenshot-ui";

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}
fn tool_dir() -> PathBuf {
    std::env::var("POWERNUX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|_| home().join(".local/share")).join("powernux")
        })
        .join("tools/screenshot")
}
/// Raccourci ajouté par Powernux (pour pouvoir le retirer proprement).
fn added_path() -> PathBuf {
    tool_dir().join("added-shortcut.txt")
}

fn gsettings(args: &[&str]) -> Result<String, String> {
    let out = Command::new("gsettings").args(args).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn bindings() -> Result<Vec<String>, String> {
    Ok(gsettings(&["get", SCHEMA, KEY])?.split('\'').skip(1).step_by(2).map(String::from).collect())
}

fn set_bindings(list: &[String]) -> Result<(), String> {
    let value = format!("[{}]", list.iter().map(|b| format!("'{b}'")).collect::<Vec<_>>().join(", "));
    gsettings(&["set", SCHEMA, KEY, &value]).map(|_| ())
}

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

fn remove_added() -> Result<(), String> {
    let Ok(previous) = fs::read_to_string(added_path()) else { return Ok(()) };
    let mut list = bindings()?;
    list.retain(|b| b != previous.trim());
    set_bindings(&list)?;
    let _ = fs::remove_file(added_path());
    Ok(())
}

fn apply() -> Result<String, String> {
    let settings: Value = fs::read_to_string(tool_dir().join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let accel = settings["shortcut"].as_str().unwrap_or("<Super><Shift>s").to_string();
    remove_added()?;
    let mut list = bindings()?;
    if !list.contains(&accel) {
        list.push(accel.clone());
        set_bindings(&list)?;
        let _ = fs::write(added_path(), &accel);
    }
    Ok(accel)
}

fn screenshots_dir() -> PathBuf {
    let pictures = Command::new("xdg-user-dir")
        .arg("PICTURES")
        .output()
        .ok()
        .map(|o| PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()))
        .filter(|p| p.is_dir())
        .unwrap_or_else(|| home().join("Pictures"));
    ["Screenshots", "Captures d’écran", "Captures d'écran"]
        .iter()
        .map(|d| pictures.join(d))
        .find(|p| p.is_dir())
        .unwrap_or(pictures)
}

fn write_status(level: &str, message: &str, message_en: &str) {
    let status = json!({ "level": level, "message": message, "messageEn": message_en });
    let _ = fs::write(tool_dir().join("status.json"), status.to_string());
}

fn main() -> ExitCode {
    let result = match std::env::args().nth(1).as_deref() {
        None | Some("--reload") => match apply() {
            Ok(accel) => {
                write_status(
                    "ok",
                    &format!("Prêt : {} ouvre la capture d'écran (Impr fonctionne toujours).", readable(&accel)),
                    &format!("Ready: {} opens the screenshot tool (Print Screen still works).", readable(&accel)),
                );
                Ok(())
            }
            Err(e) => {
                write_status("error", &format!("Raccourci impossible à ajouter : {e}"), &format!("Could not add the shortcut: {e}"));
                Err(e)
            }
        },
        Some("--quit") => remove_added(),
        Some("--open-folder") => Command::new("gio")
            .arg("open")
            .arg(screenshots_dir())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string()),
        Some(other) => Err(format!("Argument inconnu : {other}")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprint!("{e}");
            ExitCode::FAILURE
        }
    }
}
