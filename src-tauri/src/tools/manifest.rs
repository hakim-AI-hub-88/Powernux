//! Formats de données du système de modules : registre (catalogue) et manifest d'un outil.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Catalogue publié (registry.json) : liste des outils disponibles.
#[derive(Clone, Serialize, Deserialize)]
pub struct Registry {
    pub version: u32,
    pub tools: Vec<RegistryTool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryTool {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub author: Option<String>,
    /// Absent = outil annoncé mais pas encore publié.
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub min_powernux_version: Option<String>,
    /// Archives par plateforme, ex. "linux-x86_64".
    #[serde(default)]
    pub packages: BTreeMap<String, Package>,
    /// Traductions (copiées du manifest par le script de publication).
    #[serde(default)]
    pub i18n: Value,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Package {
    /// URL absolue, ou chemin relatif à l'emplacement du registre.
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub size: u64,
    /// Signature Ed25519 de l'archive (base64), vérifiée avec la clé publique intégrée.
    #[serde(default)]
    pub signature: String,
}

/// Identifiant d'outil sûr : lettres minuscules, chiffres et tirets (1 à 40 caractères).
/// Il sert à construire des chemins de dossiers : rien d'autre n'est accepté.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 40
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !id.starts_with('-')
}

/// Exécutable d'un outil : un simple nom de fichier, sans chemin absolu ni « .. ».
pub fn valid_entry(entry: &str) -> bool {
    let path = std::path::Path::new(entry);
    !entry.is_empty()
        && path.components().count() == 1
        && matches!(path.components().next(), Some(std::path::Component::Normal(_)))
}

/// manifest.json contenu dans l'archive de chaque outil.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub author: Option<String>,
    /// Exécutable du module (relatif au dossier d'installation).
    pub entry: String,
    #[serde(default)]
    pub min_powernux_version: Option<String>,
    #[serde(default)]
    pub settings: Vec<SettingDef>,
    #[serde(default)]
    pub shortcuts: Vec<ShortcutDef>,
    #[serde(default)]
    pub actions: Vec<ActionDef>,
    #[serde(default)]
    pub collections: Vec<CollectionDef>,
    #[serde(default)]
    pub hooks: Hooks,
    /// Traductions : { "en": { name, description, settings, actions, collections } }.
    #[serde(default)]
    pub i18n: Value,
}

/// Liste d'éléments gérée par le module (ex. espaces de travail).
/// `{id}` et `{value}` dans les arguments sont remplacés par Powernux.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDef {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub empty: String,
    /// Arguments qui écrivent la liste en JSON ([{id, name, description}]) sur la sortie standard.
    pub list: Vec<String>,
    #[serde(default)]
    pub create: Option<CollectionCreate>,
    #[serde(default)]
    pub item_actions: Vec<ItemAction>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CollectionCreate {
    pub label: String,
    #[serde(default)]
    pub placeholder: String,
    pub args: Vec<String>,
    /// Formulaire de création : valeurs transmises en JSON via `{json}`.
    #[serde(default)]
    pub fields: Vec<FieldDef>,
}

/// Champ de formulaire : "text" | "number" | "toggle" | "select" | "apps" | "shortcut".
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDef {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub placeholder: String,
    #[serde(default)]
    pub default: Value,
    #[serde(default)]
    pub options: Vec<SelectOption>,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    /// Affiché seulement si un autre champ a une valeur donnée.
    #[serde(default)]
    pub show_if: Option<ShowIf>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ShowIf {
    pub key: String,
    pub value: Value,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ItemAction {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub icon: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub confirm: Option<String>,
    #[serde(default)]
    pub primary: bool,
    /// Valeur demandée avant l'action (transmise via `{value}`), ex. un raccourci.
    #[serde(default)]
    pub field: Option<FieldDef>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CollectionItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// Commandes appelées par Powernux à certains moments du cycle de vie.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Hooks {
    /// Lancé (et attendu) avant la suppression des fichiers lors de « Remove ».
    pub uninstall: Vec<String>,
}

/// status.json écrit par un module pour informer l'utilisateur.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    /// "ok" | "warning" | "error"
    pub level: String,
    pub message: String,
    /// Version anglaise du message (optionnelle).
    #[serde(default)]
    pub message_en: Option<String>,
}

/// Réglage déclaré par l'outil : Powernux génère l'interface correspondante.
#[derive(Clone, Serialize, Deserialize)]
pub struct SettingDef {
    pub key: String,
    /// "toggle" | "select" | "shortcut" | "text" | "secret"
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    pub default: Value,
    #[serde(default)]
    pub options: Vec<SelectOption>,
    /// Affiché seulement en « mode développeur avancé ».
    #[serde(default)]
    pub advanced: bool,
    /// Affiché seulement si un autre réglage a une valeur donnée.
    #[serde(default, rename = "showIf")]
    pub show_if: Option<ShowIf>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SelectOption {
    pub value: Value,
    pub label: String,
    /// Option proposée seulement en « mode développeur avancé ».
    #[serde(default)]
    pub advanced: bool,
}

/// Raccourci global : la valeur du réglage `setting` lance l'outil avec `args`.
#[derive(Clone, Serialize, Deserialize)]
pub struct ShortcutDef {
    pub setting: String,
    pub name: String,
    pub args: Vec<String>,
}

/// Action proposée dans la page de l'outil (bouton) : lance l'outil avec `args`.
#[derive(Clone, Serialize, Deserialize)]
pub struct ActionDef {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub icon: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub confirm: Option<String>,
}

/// Compare deux versions (semver si possible). `a > b` ?
pub fn is_newer(a: &str, b: &str) -> bool {
    match (semver::Version::parse(a), semver::Version::parse(b)) {
        (Ok(a), Ok(b)) => a > b,
        _ => a != b,
    }
}

pub fn platform() -> String {
    format!("linux-{}", std::env::consts::ARCH)
}
