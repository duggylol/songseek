#!/bin/bash
# One-command release: bump version, build both installers, publish to GitHub so
# installed apps auto-update. Usage: ./scripts/release.sh 0.1.3
set -e
cd "$(dirname "$0")/.."
VER="$1"
[ -z "$VER" ] && { echo "usage: ./scripts/release.sh <version>  e.g. 0.1.3"; exit 1; }

echo "→ setting version $VER"
npm version "$VER" --no-git-tag-version --allow-same-version >/dev/null
# keep the website's download links and schema pointing at this release
sed -i '' "s|<span data-version>[^<]*</span>|<span data-version>$VER</span>|" docs/index.html
sed -i '' "s|\"softwareVersion\": \"[^\"]*\"|\"softwareVersion\": \"$VER\"|" docs/index.html

echo "→ building Windows + macOS installers (this takes a few minutes)"
rm -rf release
npm run dist:win
npm run dist:mac

echo "→ committing + tagging"
git add -A
git diff --cached --quiet || git commit -q -m "Release $VER"
git tag -f "v$VER"
git push -q origin main
git push -q -f origin "v$VER"

echo "→ publishing GitHub release"
# Create with the small files first, then upload the big installers separately —
# bundling them into `create` can time out and silently leave a DRAFT release,
# which the auto-updater cannot see.
gh release create "v$VER" \
  --title "SongSeek $VER" \
  --notes "SongSeek $VER" \
  release/latest.yml \
  "release/SongSeek-Setup-$VER.exe.blockmap" || true

for f in "release/SongSeek-Setup-$VER.exe" "release/SongSeek-$VER-arm64.dmg"; do
  echo "   uploading $(basename "$f")…"
  for attempt in 1 2 3; do
    gh release upload "v$VER" "$f" --clobber && break
    echo "   retry $attempt for $(basename "$f")"
  done
done

# Only go live once the installer is actually attached.
if gh release view "v$VER" --json assets --jq '.assets[].name' | grep -q "SongSeek-Setup-$VER.exe$"; then
  gh release edit "v$VER" --draft=false
else
  echo "✗ Installer missing from the release — leaving it as a draft so clients don't see a broken update."
  exit 1
fi

echo "✓ Released $VER. Installed apps (0.1.1+) will auto-update on next close."
echo "  Windows link: https://github.com/duggylol/songseek/releases/download/v$VER/SongSeek-Setup-$VER.exe"
