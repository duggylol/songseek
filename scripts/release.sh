#!/bin/bash
# One-command release: bump version, build both installers, publish to GitHub so
# installed apps auto-update. Usage: ./scripts/release.sh 0.1.3
set -e
cd "$(dirname "$0")/.."
VER="$1"
[ -z "$VER" ] && { echo "usage: ./scripts/release.sh <version>  e.g. 0.1.3"; exit 1; }

echo "→ setting version $VER"
npm version "$VER" --no-git-tag-version >/dev/null

echo "→ building Windows + macOS installers (this takes a few minutes)"
rm -rf release
npm run dist:win
npm run dist:mac

echo "→ committing + tagging"
git add -A
git commit -q -m "Release $VER"
git tag "v$VER"
git push -q origin main "v$VER"

echo "→ publishing GitHub release (installers + update manifests)"
gh release create "v$VER" \
  --title "SongSeek $VER" \
  --notes "SongSeek $VER" \
  release/latest.yml \
  "release/SongSeek-Setup-$VER.exe" \
  "release/SongSeek-Setup-$VER.exe.blockmap" \
  "release/SongSeek-$VER-arm64.dmg"
gh release edit "v$VER" --draft=false

echo "✓ Released $VER. Installed apps (0.1.1+) will auto-update on next close."
echo "  Windows link: https://github.com/duggylol/songseek/releases/download/v$VER/SongSeek-Setup-$VER.exe"
