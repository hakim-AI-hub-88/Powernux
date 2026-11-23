#!/usr/bin/env bash
# Relance la première publication : supprime les tags envoyés en une seule fois (GitHub n'a
# déclenché aucun workflow) et le tag v0.11.1 (mauvaise version), puis republie un tag à la fois.
# À utiliser une seule fois : aucune Release n'existe encore pour ces tags.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(gh release list --limit 1 2>/dev/null)" ]; then
  echo "Des Releases existent déjà : arrêt par sécurité." >&2
  exit 1
fi

TAGS=$(git tag)
echo "Suppression des tags sur GitHub et en local : $(echo $TAGS)"
for TAG in $TAGS; do
  git push origin --delete "refs/tags/$TAG" >/dev/null 2>&1 || true
  git tag -d "$TAG" >/dev/null
done

npm run release -- tools
npm run release -- app
