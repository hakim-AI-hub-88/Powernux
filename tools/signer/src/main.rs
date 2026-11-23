//! Signature des archives d'outils Powernux (Ed25519).
//!
//!   powernux-sign keygen            crée la paire de clés (une seule fois)
//!   powernux-sign pubkey            affiche la clé publique (à mettre dans Powernux)
//!   powernux-sign sign <archive>    affiche la signature de l'archive (base64)
//!
//! Clé privée : variable POWERNUX_SIGNING_KEY (base64, ex. secret GitHub Actions),
//! sinon ~/.config/powernux-signing/tools.key (droits 0600). Elle ne doit JAMAIS
//! être ajoutée au dépôt Git.
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use std::{fs, io::Read, path::PathBuf, process::ExitCode};

fn key_path() -> PathBuf {
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
    std::env::var("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".config")).join("powernux-signing/tools.key")
}

fn load_key() -> Result<SigningKey, String> {
    let encoded = match std::env::var("POWERNUX_SIGNING_KEY") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => fs::read_to_string(key_path())
            .map_err(|_| format!("Clé privée introuvable ({}). Lancez « powernux-sign keygen ».", key_path().display()))?,
    };
    let bytes = STANDARD.decode(encoded.trim()).map_err(|_| "Clé privée illisible.".to_string())?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| "Clé privée invalide (32 octets attendus).".to_string())?;
    Ok(SigningKey::from_bytes(&bytes))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("keygen") => (|| {
            let path = key_path();
            if path.exists() {
                return Err(format!("Une clé existe déjà : {} (non remplacée).", path.display()));
            }
            let mut seed = [0u8; 32];
            fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut seed)).map_err(|e| e.to_string())?;
            let key = SigningKey::from_bytes(&seed);
            fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            fs::write(&path, STANDARD.encode(key.to_bytes())).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
            }
            println!("Clé privée : {}", path.display());
            println!("Clé publique : {}", STANDARD.encode(key.verifying_key().to_bytes()));
            Ok(())
        })(),
        Some("pubkey") => load_key().map(|k| println!("{}", STANDARD.encode(k.verifying_key().to_bytes()))),
        Some("sign") => match args.get(2) {
            Some(file) => fs::read(file)
                .map_err(|e| format!("{file} : {e}"))
                .and_then(|data| load_key().map(|k| println!("{}", STANDARD.encode(k.sign(&data).to_bytes())))),
            None => Err("Usage : powernux-sign sign <archive>".into()),
        },
        _ => Err("Usage : powernux-sign keygen | pubkey | sign <archive>".into()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
