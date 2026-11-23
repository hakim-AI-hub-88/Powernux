#!/usr/bin/env bash
# Compile un module Powernux, crée son archive et met à jour registry/registry.json.
#   Usage : npm run package:clipboard   (ou bash tools/package-tool.sh <id>)
set -euo pipefail

ID="${1:?Usage: package-tool.sh <tool-id>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOL="$ROOT/tools/$ID"
MANIFEST="$TOOL/manifest.json"

VERSION=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$MANIFEST")
ENTRY=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['entry'])" "$MANIFEST")
ARCH=$(uname -m)
ARCHIVE="$ID-$VERSION-linux-$ARCH.tar.gz"

echo "==> Compilation de $ID $VERSION"
if [ -d "$TOOL/src-tauri" ]; then
  # Module avec interface (Tauri)
  (cd "$TOOL" && npx tauri build --no-bundle)
  BIN="$TOOL/src-tauri/target/release/$ENTRY"
else
  # Module sans interface (programme Rust)
  (cd "$TOOL" && cargo build --release)
  BIN="$TOOL/target/release/$ENTRY"
fi

echo "==> Création de l'archive $ARCHIVE"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp "$MANIFEST" "$STAGE/manifest.json"
cp "$BIN" "$STAGE/$ENTRY"
mkdir -p "$ROOT/registry/packages"
tar -czf "$ROOT/registry/packages/$ARCHIVE" -C "$STAGE" .

echo "==> Signature de l'archive"
SIGNER="$ROOT/tools/signer/target/release/powernux-sign"
[ -x "$SIGNER" ] || (cd "$ROOT/tools/signer" && cargo build --release -q)
SIGNATURE=$("$SIGNER" sign "$ROOT/registry/packages/$ARCHIVE")

echo "==> Mise à jour du registre"
python3 - "$ROOT/registry/registry.json" "$MANIFEST" "$ROOT/registry/packages/$ARCHIVE" "$ARCH" "$SIGNATURE" <<'PY'
import hashlib, json, os, sys
registry_path, manifest_path, archive, arch, signature = sys.argv[1:]
registry = json.load(open(registry_path))
m = json.load(open(manifest_path))
entry = next((t for t in registry["tools"] if t["id"] == m["id"]), None)
if entry is None:
    entry = {"id": m["id"]}
    registry["tools"].append(entry)
for key in ("name", "description", "category", "icon", "author", "minPowernuxVersion", "i18n"):
    if key in m:
        entry[key] = m[key]
entry["version"] = m["version"]
entry["packages"] = {
    f"linux-{arch}": {
        "url": "packages/" + os.path.basename(archive),
        "sha256": hashlib.sha256(open(archive, "rb").read()).hexdigest(),
        "size": os.path.getsize(archive),
        "signature": signature,
    }
}
json.dump(registry, open(registry_path, "w"), indent=2, ensure_ascii=False)
open(registry_path, "a").write("\n")
print(f"   {m['id']} {m['version']} -> {entry['packages']}")
PY
echo "==> Terminé"
