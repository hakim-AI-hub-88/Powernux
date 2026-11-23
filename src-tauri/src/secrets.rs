//! Clés API dans le trousseau GNOME (Secret Service, chiffré).
//! Fichiers de réglages : seulement le marqueur `__keyring__`, jamais la clé.
//! Entrées : service « powernux », compte « <outil>/<réglage> » (lu aussi par les modules).

pub const MARKER: &str = "__keyring__";
const SERVICE: &str = "powernux";

fn entry(tool: &str, key: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, &format!("{tool}/{key}")).ok()
}

/// Enregistre la clé dans le trousseau. `false` si le trousseau est indisponible.
pub fn store(tool: &str, key: &str, value: &str) -> bool {
    entry(tool, key).is_some_and(|e| e.set_password(value).is_ok())
}

pub fn delete(tool: &str, key: &str) {
    if let Some(e) = entry(tool, key) {
        let _ = e.delete_credential();
    }
}
