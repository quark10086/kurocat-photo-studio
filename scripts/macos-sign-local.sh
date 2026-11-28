#!/usr/bin/env bash
# Sign a locally built macOS .app with a stable ad-hoc designated requirement.
#
# Why: ad-hoc signing normally pins the designated requirement to the binary cdhash.
# Every rebuild then invalidates the macOS Accessibility / Input Monitoring grants that
# are keyed to that requirement, so the input tap silently stops receiving events.
# `scripts/macos-codesign.sh sign` now uses `identifier "<CFBundleIdentifier>"` instead,
# which survives rebuilds and updates.
#
# Usage: scripts/macos-sign-local.sh [path/to/KuroCat.app]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -ge 1 ]]; then
  APP="$1"
else
  APP=""
  for candidate in \
    "src-tauri/target/release/bundle/macos/KuroCat.app" \
    "src-tauri/target/universal-apple-darwin/release/bundle/macos/KuroCat.app" \
    "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/KuroCat.app" \
    "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/KuroCat.app"; do
    if [[ -d "$candidate" ]]; then
      APP="$candidate"
      break
    fi
  done
fi

if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "No built KuroCat.app found. Run: npm run tauri -- build --bundles app" >&2
  exit 1
fi

exec bash scripts/macos-codesign.sh sign "$APP"
