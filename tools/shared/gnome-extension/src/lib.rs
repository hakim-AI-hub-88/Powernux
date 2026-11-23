//! Code partagé des modules Powernux qui s'appuient sur une extension GNOME Shell.
//!
//! Sous Wayland, seul GNOME Shell peut agir sur les fenêtres et le clavier des autres
//! applications. Ces modules embarquent donc une extension, l'installent, l'activent
//! et dialoguent avec elle via D-Bus.
use std::{fs, path::PathBuf, process::Command, thread, time::Duration};

pub const RELOGIN: &str =
    "Déconnectez-vous puis reconnectez-vous une fois : GNOME doit charger l'extension de ce module (limitation de Wayland).";
pub const RELOGIN_EN: &str =
    "Log out and back in once: GNOME needs to load this tool's extension (a Wayland limitation).";

/// Description d'une extension embarquée dans un module.
pub struct Extension {
    pub tool_id: &'static str,
    pub uuid: &'static str,
    pub dbus_path: &'static str,
    pub dbus_iface: &'static str,
    /// (nom de fichier, contenu) — typiquement via `include_str!`.
    pub files: &'static [(&'static str, &'static str)],
}

pub fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}
pub fn data_home() -> PathBuf {
    std::env::var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|_| home().join(".local/share"))
}
pub fn powernux_home() -> PathBuf {
    std::env::var("POWERNUX_HOME").map(PathBuf::from).unwrap_or_else(|_| data_home().join("powernux"))
}
pub fn is_gnome() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP").map(|d| d.to_lowercase().contains("gnome")).unwrap_or(false)
}

pub fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(cmd).args(args).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn parse_str_array(s: &str) -> Vec<String> {
    s.split('\'').skip(1).step_by(2).map(String::from).collect()
}

pub fn notify(icon: &str, title: &str, body: &str) {
    let _ = Command::new("notify-send").args(["-a", "Powernux", "-i", icon, title, body]).status();
}

impl Extension {
    pub fn tool_dir(&self) -> PathBuf {
        powernux_home().join("tools").join(self.tool_id)
    }

    /// Réglages écrits par Powernux. Les clés API marquées « __keyring__ » sont lues dans
    /// le trousseau GNOME (fonction « secrets »).
    pub fn settings(&self) -> serde_json::Value {
        #[allow(unused_mut)]
        let mut value: serde_json::Value = fs::read_to_string(self.tool_dir().join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::Value::Null);
        #[cfg(feature = "secrets")]
        if let Some(map) = value.as_object_mut() {
            for (key, v) in map.iter_mut() {
                if v.as_str() == Some("__keyring__") {
                    let secret = keyring::Entry::new("powernux", &format!("{}/{key}", self.tool_id))
                        .and_then(|e| e.get_password())
                        .unwrap_or_default();
                    *v = serde_json::Value::String(secret);
                }
            }
        }
        value
    }

    /// État affiché par Powernux dans Tools Manager (status.json), en français et en anglais.
    pub fn write_status(&self, level: &str, message: &str, message_en: &str) {
        let json = serde_json::json!({ "level": level, "message": message, "messageEn": message_en });
        let _ = fs::write(self.tool_dir().join("status.json"), json.to_string());
    }

    pub fn dir(&self) -> PathBuf {
        data_home().join("gnome-shell/extensions").join(self.uuid)
    }

    fn set_enabled_in_gsettings(&self, enabled: bool) -> Result<(), String> {
        let mut list = parse_str_array(&run("gsettings", &["get", "org.gnome.shell", "enabled-extensions"])?);
        if enabled == list.iter().any(|u| u == self.uuid) {
            return Ok(());
        }
        if enabled {
            list.push(self.uuid.into());
        } else {
            list.retain(|u| u != self.uuid);
        }
        let value = format!("[{}]", list.iter().map(|u| format!("'{u}'")).collect::<Vec<_>>().join(", "));
        run("gsettings", &["set", "org.gnome.shell", "enabled-extensions", &value]).map(|_| ())
    }

    pub fn dbus_call(&self, method: &str, args: &[&str]) -> Result<String, String> {
        let method = format!("{}.{method}", self.dbus_iface);
        let mut all = vec![
            "call", "--session", "--dest", "org.gnome.Shell", "--object-path", self.dbus_path, "--method", &method,
        ];
        all.extend_from_slice(args);
        run("gdbus", &all)
    }

    /// L'extension est-elle chargée par GNOME Shell (son objet D-Bus répond) ?
    pub fn is_active(&self) -> bool {
        run(
            "gdbus",
            &[
                "introspect", "--session", "--dest", "org.gnome.Shell", "--object-path", self.dbus_path,
            ],
        )
        .is_ok_and(|out| out.contains(self.dbus_iface))
    }

    /// Installe (ou met à jour) puis active l'extension. Renvoie Ok(true) si elle est déjà chargée.
    pub fn install_and_enable(&self) -> Result<bool, String> {
        if !is_gnome() {
            return Err("Ce module nécessite GNOME Shell.".into());
        }
        let dir = self.dir();
        fs::create_dir_all(&dir).map_err(|e| format!("Installation de l'extension impossible : {e}"))?;
        for (name, content) in self.files {
            fs::write(dir.join(name), content).map_err(|e| format!("Installation de l'extension impossible : {e}"))?;
        }
        if run("gsettings", &["get", "org.gnome.shell", "disable-user-extensions"]).as_deref() == Ok("true") {
            return Err("Les extensions GNOME sont désactivées (application « Extensions »).".into());
        }
        self.set_enabled_in_gsettings(true)
            .map_err(|e| format!("Activation de l'extension impossible : {e}"))?;
        let _ = run("gnome-extensions", &["enable", self.uuid]);
        for _ in 0..10 {
            if self.is_active() {
                return Ok(true);
            }
            thread::sleep(Duration::from_millis(300));
        }
        Ok(false)
    }

    pub fn disable(&self) {
        let _ = self.set_enabled_in_gsettings(false);
        let _ = run("gnome-extensions", &["disable", self.uuid]);
    }

    pub fn uninstall(&self) {
        self.disable();
        let _ = fs::remove_dir_all(self.dir());
    }
}

/// Applications installées (fichiers .desktop) : identifiant → nom affiché.
pub mod apps {
    use std::{collections::BTreeMap, fs, path::PathBuf};

    fn dirs() -> Vec<PathBuf> {
        let mut dirs = vec![super::data_home().join("applications")];
        let system = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
        dirs.extend(system.split(':').filter(|d| !d.is_empty()).map(|d| PathBuf::from(d).join("applications")));
        dirs.push(PathBuf::from("/var/lib/snapd/desktop/applications"));
        dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
        dirs.push(super::data_home().join("flatpak/exports/share/applications"));
        dirs
    }

    /// Nom de l'application (Name[fr] si disponible), None si absente.
    pub fn name(id: &str) -> Option<String> {
        dirs().into_iter().find_map(|d| {
            let text = fs::read_to_string(d.join(id)).ok()?;
            let mut name = None;
            let mut name_fr = None;
            let mut in_entry = false;
            for line in text.lines() {
                if line.starts_with('[') {
                    in_entry = line == "[Desktop Entry]";
                } else if in_entry {
                    if let Some(v) = line.strip_prefix("Name=") {
                        name.get_or_insert(v.to_string());
                    } else if let Some(v) = line.strip_prefix("Name[fr]=") {
                        name_fr.get_or_insert(v.to_string());
                    }
                }
            }
            name_fr.or(name)
        })
    }

    pub fn exists(id: &str) -> bool {
        name(id).is_some()
    }

    /// Noms de plusieurs applications (les absentes sont ignorées).
    pub fn names(ids: &[String]) -> Vec<String> {
        let mut seen = BTreeMap::new();
        ids.iter().filter_map(|id| name(id).map(|n| seen.entry(n.clone()).or_insert(n).clone())).collect()
    }
}

/// Raccourcis clavier globaux (raccourcis personnalisés de GNOME), identifiants `powernux-<clé>`.
/// Même mécanisme que Powernux Core (src-tauri/src/shortcut.rs).
pub mod keybindings {
    use super::is_gnome;
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


    fn gsettings(args: &[&str]) -> Result<String, String> {
        let out = Command::new("gsettings").args(args).output().map_err(|e| format!("gsettings: {e}"))?;
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
                    return Some(format!("custom shortcut {name}"));
                }
            }
        }
        None
    }

    /// Enregistre (ou met à jour) un raccourci GNOME `powernux-<key>`.
    pub fn register(key: &str, name: &str, command: &str, accel: &str) -> Result<(), String> {
        if !is_gnome() {
            return Err("GNOME only".to_string());
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
}
