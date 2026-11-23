#!/usr/bin/env bash
# Publie une version : crée le tag Git puis l'envoie sur GitHub (GitHub Actions fait le reste).
#
#   npm run release -- app          → tag v<version de l'app>      (.deb, .rpm, .AppImage)
#   npm run release -- notes        → tag notes-v<version>          (un outil)
#   npm run release -- tools        → un tag par outil (premières publications)
#
# Les versions viennent de src-tauri/tauri.conf.json et tools/<outil>/manifest.json :
# augmentez-les avant de publier.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:?Usage : npm run release -- app | <outil> | tools}"

if [ -n "$(git status --porcelain)" ]; then
  echo "Des modifications ne sont pas commitées : faites d'abord « git commit »." >&2
  exit 1
fi

tag_for() {
  if [ "$1" = "app" ]; then
    echo "v$(node -p "require('./src-tauri/tauri.conf.json').version")"
  else
    [ -f "tools/$1/manifest.json" ] || { echo "Outil inconnu : $1" >&2; exit 1; }
    echo "$1-v$(node -p "require('./tools/$1/manifest.json').version")"
  fi
}

if [ "$TARGET" = "tools" ]; then
  TARGETS=$(for m in tools/*/manifest.json; do basename "$(dirname "$m")"; done)
else
  TARGETS="$TARGET"
fi

TAGS=()
for t in $TARGETS; do
  TAG=$(tag_for "$t")
  if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
    echo "• $TAG existe déjà : augmentez la version pour publier une mise à jour."
    continue
  fi
  # Tag local non publié (ex. envoi interrompu) : recréé sur le commit actuel.
  git tag -d "$TAG" >/dev/null 2>&1 || true
  git tag -a "$TAG" -m "$TAG"
  TAGS+=("$TAG")
  echo "• tag créé : $TAG"
done

[ ${#TAGS[@]} -eq 0 ] && { echo "Rien à publier."; exit 0; }
git push origin HEAD
# Un tag à la fois : GitHub ne déclenche aucun workflow si plus de 3 tags arrivent ensemble.
for TAG in "${TAGS[@]}"; do
  git push origin "refs/tags/$TAG"
  sleep 3
done
echo "Envoyé. Suivez la publication : https://github.com/hakim-AI-hub-88/Powernux/actions"
