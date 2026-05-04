#!/usr/bin/env bash
# Builds PremImageGen-Installer.pkg for IT deployment.
# Run once: bash premiere/installer/build-pkg.sh
# Requires: Xcode command-line tools (xcode-select --install)

set -e

INSTALLER_DIR="$(cd "$(dirname "$0")" && pwd)"
PREMIERE_DIR="$(dirname "$INSTALLER_DIR")"
ROOT_DIR="$(dirname "$PREMIERE_DIR")"
HELPER_SRC="$PREMIERE_DIR/helper"

STAGING="$INSTALLER_DIR/_staging"
COMPONENT_PKG="$INSTALLER_DIR/_PremImageGen-component.pkg"
OUTPUT="$INSTALLER_DIR/PremImageGen-Installer.pkg"

echo "PremImageGen — Building installer package"
echo "-----------------------------------------"

# ── Ensure node_modules exist ─────────────────────────────────────────────────
if [ ! -d "$HELPER_SRC/node_modules" ]; then
  echo "Running npm install for helper..."
  cd "$HELPER_SRC"
  npm install --omit=dev --no-audit --no-fund
fi

# ── Stage CEP extension ───────────────────────────────────────────────────────
CEP_PAYLOAD="$STAGING/Library/Application Support/Adobe/CEP/extensions/PremImageGen"
mkdir -p "$CEP_PAYLOAD"
rsync -a --exclude .DS_Store "$PREMIERE_DIR/cep/" "$CEP_PAYLOAD/"
echo "CEP extension staged ... OK"

# ── Stage helper source (with node_modules) ───────────────────────────────────
HELPER_PAYLOAD="$STAGING/Library/Application Support/AEImageGen/helper-src"
mkdir -p "$HELPER_PAYLOAD"
rsync -a \
  --exclude node_modules/.cache \
  --exclude tests \
  --exclude .DS_Store \
  "$HELPER_SRC/" "$HELPER_PAYLOAD/"
rsync -a "$HELPER_SRC/node_modules/" "$HELPER_PAYLOAD/node_modules/"
echo "Helper staged ... OK"

# ── Build component package ───────────────────────────────────────────────────
pkgbuild \
  --root "$STAGING" \
  --identifier "com.imagegen.prem.pkg" \
  --version "1.0.0" \
  --scripts "$INSTALLER_DIR/scripts" \
  --install-location "/" \
  "$COMPONENT_PKG"

# ── Build product package (with UI) ──────────────────────────────────────────
productbuild \
  --distribution "$INSTALLER_DIR/distribution.xml" \
  --resources "$INSTALLER_DIR/resources" \
  --package-path "$INSTALLER_DIR" \
  "$OUTPUT"

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -rf "$STAGING" "$COMPONENT_PKG"

echo ""
echo "================================================"
echo "  Built: $OUTPUT"
echo "================================================"
echo ""
echo "Send PremImageGen-Installer.pkg to IT."
echo "They double-click it — standard macOS installer."
