//! Téléchargement, vérification et installation des archives d'outils.
use super::manifest::{valid_entry, valid_id, Manifest, Package, Registry};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Clé publique des outils officiels Powernux (la clé privée n'est jamais dans le dépôt).
/// Toute archive non signée par cette clé est refusée.
pub const TOOLS_PUBLIC_KEY: &str = "zYUbz1QG0Fpj9Zw5JBvX7vDEM5MyAd6sH187S26dCUc=";
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};

fn is_remote(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

fn local_path(url: &str) -> PathBuf {
    PathBuf::from(url.strip_prefix("file://").unwrap_or(url))
}

/// Résout l'URL d'une archive par rapport à l'emplacement du registre.
pub fn resolve(registry_url: &str, url: &str) -> Result<String, String> {
    if is_remote(url) || url.starts_with("file://") || url.starts_with('/') {
        return Ok(url.to_string());
    }
    if is_remote(registry_url) {
        let base = reqwest::Url::parse(registry_url).map_err(|e| e.to_string())?;
        return base.join(url).map(|u| u.to_string()).map_err(|e| e.to_string());
    }
    let base = local_path(registry_url);
    let dir = base.parent().unwrap_or(Path::new("."));
    Ok(dir.join(url).to_string_lossy().into_owned())
}

/// Télécharge un fichier (http(s) ou local). `progress(reçu, total)`.
pub async fn fetch(url: &str, mut progress: impl FnMut(u64, u64)) -> Result<Vec<u8>, String> {
    if !is_remote(url) {
        let bytes = fs::read(local_path(url)).map_err(|e| crate::tr!("Lecture de {url} impossible : {e}", "Cannot read {url}: {e}"))?;
        progress(bytes.len() as u64, bytes.len() as u64);
        return Ok(bytes);
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("Powernux/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().await.map_err(|e| crate::tr!("Connexion impossible : {e}", "Connection failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(crate::tr!("Le serveur a répondu {} pour {url}", "The server answered {} for {url}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut data = Vec::with_capacity(total as usize);
    while let Some(chunk) = resp.chunk().await.map_err(|e| crate::tr!("Téléchargement interrompu : {e}", "Download interrupted: {e}"))? {
        data.extend_from_slice(&chunk);
        progress(data.len() as u64, total);
    }
    Ok(data)
}

pub async fn fetch_registry(url: &str) -> Result<Registry, String> {
    let bytes = fetch(url, |_, _| {}).await?;
    let mut registry: Registry =
        serde_json::from_slice(&bytes).map_err(|e| crate::tr!("Catalogue invalide : {e}", "Invalid catalog: {e}"))?;
    // Les identifiants servent de noms de dossiers : les identifiants douteux sont ignorés.
    registry.tools.retain(|t| valid_id(&t.id));
    Ok(registry)
}

/// Vérifie que l'archive a été signée par la clé privée des outils Powernux.
pub fn verify_signature(data: &[u8], package: &Package) -> Result<(), String> {
    let refused = || {
        crate::tr!(
            "Signature de l'outil invalide ou absente : installation refusée par sécurité.",
            "Invalid or missing tool signature: installation refused for your safety."
        )
    };
    let key: [u8; 32] = STANDARD.decode(TOOLS_PUBLIC_KEY).ok().and_then(|k| k.try_into().ok()).ok_or_else(refused)?;
    let key = VerifyingKey::from_bytes(&key).map_err(|_| refused())?;
    let sig: [u8; 64] = STANDARD.decode(package.signature.trim()).ok().and_then(|s| s.try_into().ok()).ok_or_else(refused)?;
    key.verify(data, &Signature::from_bytes(&sig)).map_err(|_| refused())
}

pub fn verify(data: &[u8], package: &Package) -> Result<(), String> {
    let hash: String = Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect();
    if hash.eq_ignore_ascii_case(&package.sha256) {
        Ok(())
    } else {
        Err(crate::tr!("L'archive téléchargée est corrompue ou a été modifiée (empreinte SHA-256 différente).", "The downloaded archive is corrupted or was modified (SHA-256 mismatch)."))
    }
}

/// Extrait l'archive dans `tools/<id>` (via un dossier temporaire) et renvoie son manifest.
pub fn install(data: &[u8], tools_dir: &Path, id: &str) -> Result<Manifest, String> {
    if !valid_id(id) {
        return Err(crate::tr!("Identifiant d'outil invalide.", "Invalid tool identifier."));
    }
    fs::create_dir_all(tools_dir).map_err(|e| e.to_string())?;
    let tmp = tools_dir.join(format!(".{id}.tmp"));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let result = (|| {
        // `unpack` refuse les chemins absolus et les « .. » (pas d'écriture hors du dossier).
        tar::Archive::new(GzDecoder::new(Cursor::new(data)))
            .unpack(&tmp)
            .map_err(|e| crate::tr!("Archive illisible : {e}", "Unreadable archive: {e}"))?;
        let manifest = read_manifest(&tmp)?;
        if manifest.id != id {
            return Err(crate::tr!("L'archive contient l'outil « {} » au lieu de « {id} ».", "The archive contains tool \"{}\" instead of \"{id}\".", manifest.id));
        }
        // Un simple nom de fichier : ni chemin absolu (/bin/sh…), ni « .. ».
        if !valid_entry(&manifest.entry) {
            return Err(crate::tr!("Exécutable « {} » refusé.", "Executable \"{}\" refused.", manifest.entry));
        }
        let entry = tmp.join(&manifest.entry);
        if !entry.is_file() {
            return Err(crate::tr!("Exécutable « {} » absent de l'archive.", "Executable \"{}\" is missing from the archive.", manifest.entry));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&entry, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
        Ok(manifest)
    })();

    match result {
        Ok(manifest) => {
            let dest = tools_dir.join(id);
            let _ = fs::remove_dir_all(&dest);
            fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
            Ok(manifest)
        }
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp);
            Err(e)
        }
    }
}

pub fn read_manifest(dir: &Path) -> Result<Manifest, String> {
    let text = fs::read_to_string(dir.join("manifest.json")).map_err(|_| crate::tr!("manifest.json introuvable", "manifest.json not found"))?;
    serde_json::from_str(&text).map_err(|e| crate::tr!("manifest.json invalide : {e}", "Invalid manifest.json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_entries_are_validated() {
        use crate::tools::manifest::{valid_entry, valid_id};
        assert!(valid_id("window-pin") && valid_id("ai-face"));
        assert!(!valid_id("../../Documents") && !valid_id("") && !valid_id("A") && !valid_id("a/b") && !valid_id("-x"));
        assert!(valid_entry("powernux-notes"));
        assert!(!valid_entry("/bin/sh") && !valid_entry("../x") && !valid_entry("a/b") && !valid_entry(""));
    }

    #[test]
    fn resolve_relative_urls() {
        assert_eq!(
            resolve("https://raw.githubusercontent.com/a/b/main/registry/registry.json", "packages/x.tar.gz").unwrap(),
            "https://raw.githubusercontent.com/a/b/main/registry/packages/x.tar.gz"
        );
        assert_eq!(resolve("/r/registry.json", "packages/x.tar.gz").unwrap(), "/r/packages/x.tar.gz");
        assert_eq!(resolve("/r/registry.json", "https://h/x.tar.gz").unwrap(), "https://h/x.tar.gz");
    }

    /// Chaîne complète avec le vrai registre local (nécessite `npm run package:clipboard`).
    #[test]
    fn install_clipboard_from_local_registry() {
        let registry_url = concat!(env!("CARGO_MANIFEST_DIR"), "/../registry/registry.json");
        let rt = tauri::async_runtime::block_on(fetch_registry(registry_url));
        let registry = rt.expect("registre");
        let tool = registry.tools.iter().find(|t| t.id == "clipboard").unwrap();
        let Some(pkg) = tool.packages.get(&super::super::manifest::platform()) else {
            eprintln!("archive absente : test ignoré");
            return;
        };
        let url = resolve(registry_url, &pkg.url).unwrap();
        let data = tauri::async_runtime::block_on(fetch(&url, |_, _| {})).unwrap();
        verify(&data, pkg).unwrap();
        // Signature : l'archive publiée est acceptée, une archive modifiée ou non signée est refusée.
        verify_signature(&data, pkg).expect("archive signée acceptée");
        let mut tampered = data.clone();
        tampered[200] ^= 1;
        assert!(verify_signature(&tampered, pkg).is_err());
        let unsigned = Package { signature: String::new(), ..pkg.clone() };
        assert!(verify_signature(&data, &unsigned).is_err());

        // Une archive modifiée doit être refusée.
        let mut bad = data.clone();
        bad[100] ^= 0xff;
        assert!(verify(&bad, pkg).is_err());

        let dir = std::env::temp_dir().join(format!("powernux-test-{}", std::process::id()));
        let manifest = install(&data, &dir, "clipboard").unwrap();
        assert_eq!(manifest.id, "clipboard");
        assert!(dir.join("clipboard").join(&manifest.entry).is_file());
        // Mauvais identifiant attendu → refus.
        assert!(install(&data, &dir, "autre").is_err());
        assert!(install(&data, &dir, "../../Documents").is_err());
        println!("installé : {} {} dans {}", manifest.name, manifest.version, dir.display());
        let _ = fs::remove_dir_all(&dir);
    }
}
