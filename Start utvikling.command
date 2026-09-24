#!/bin/zsh
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v npm >/dev/null; then
  echo "Installer Node.js 22 eller nyere først."
  read '?Trykk Enter for å lukke.'
  exit 1
fi
npm run dev
