#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"
VERSION="$(tr -d '[:space:]' < raspberry-pi/VERSION)"
TAG="v${VERSION#v}"

if [[ -z "$VERSION" || ! "$VERSION" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid version in raspberry-pi/VERSION: $VERSION"
  exit 1
fi
command -v gh >/dev/null 2>&1 || { echo "Install GitHub CLI first: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Log in to GitHub first: gh auth login"; exit 1; }
if git rev-parse "$TAG" >/dev/null 2>&1 || git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists. Update raspberry-pi/VERSION first."
  exit 1
fi

echo "Releasing $TAG from raspberry-pi/VERSION"
# Stage only the project payload and cleanup paths, leaving unrelated files alone.
git add README.md raspberry-pi branding "Release New Version.command"
git add -u -- "SD Card Images" raspberry-pi
git diff --cached --quiet && { echo "No release changes staged."; exit 1; }
git commit -m "Release $TAG"
git push origin main
git tag -a "$TAG" -m "Release $TAG"
git push origin "$TAG"
gh release create "$TAG" --title "$TAG" --generate-notes
echo "Released $TAG successfully."
read -r -p "Press Enter to close..." _
