#!/usr/bin/env bash
# Fix It In Prompt — macOS Installer
# Run with: bash install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER_DEST="$HOME/Library/Application Support/AEImageGen/helper"
CEP_USER_DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/PremImageGen"
CEP_SYSTEM_DEST="/Library/Application Support/Adobe/CEP/extensions/PremImageGen"

echo ""
echo "Fix It In Prompt — Installer"
echo "─────────────────────────────"
echo ""

# ── Step 1: Find Node.js ──────────────────────────────────────────────────────

echo "Checking for Node.js..."

NODE_BIN=""
for candidate in "$(command -v node 2>/dev/null || true)" /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
        NODE_BIN="$candidate"
        break
    fi
done

if [ -z "$NODE_BIN" ]; then
    echo ""
    echo "✗  Node.js not found."
    echo ""
    echo "   Please install Node.js first, then run this script again:"
    echo "   https://nodejs.org  (download the LTS version)"
    echo ""
    exit 1
fi

NPM_BIN="$(dirname "$NODE_BIN")/npm"
NODE_DIR="$(dirname "$NODE_BIN")"
echo "✓  Found Node.js: $NODE_BIN"

# ── Step 2: Install helper ────────────────────────────────────────────────────

echo ""
echo "Installing helper service..."
mkdir -p "$HELPER_DEST"
rsync -a --delete "$SCRIPT_DIR/helper/" "$HELPER_DEST/"
echo "✓  Helper copied"

echo "Installing dependencies (this may take a minute)..."
export PATH="$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:$PATH"
cd "$HELPER_DEST" && "$NPM_BIN" install --production 2>&1
echo "✓  Dependencies installed"

# ── Step 3: CEP extension — user level ───────────────────────────────────────

echo ""
echo "Installing Premiere Pro extension..."
mkdir -p "$CEP_USER_DEST"
rsync -a --delete "$SCRIPT_DIR/cep/" "$CEP_USER_DEST/"
echo "✓  Extension installed (user)"

# ── Step 4: CEP extension — system level ─────────────────────────────────────

echo "Installing extension system-wide (you may be prompted for your password)..."
if sudo mkdir -p "$CEP_SYSTEM_DEST" && sudo rsync -a --delete "$SCRIPT_DIR/cep/" "$CEP_SYSTEM_DEST/" 2>/dev/null; then
    echo "✓  Extension installed (system-wide)"
else
    echo "   System-wide install skipped — user-level install is sufficient"
fi

# ── Step 5: Enable unsigned extensions ───────────────────────────────────────

echo ""
echo "Enabling extension in Premiere Pro..."
defaults write com.adobe.CSXS.11 PlayerDebugMode 1 2>/dev/null || true
defaults write com.adobe.CSXS.12 PlayerDebugMode 1 2>/dev/null || true
defaults write com.adobe.CSXS.13 PlayerDebugMode 1 2>/dev/null || true
echo "✓  Extension enabled"

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "─────────────────────────────"
echo "✓  Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Restart Premiere Pro"
echo "  2. Open: Window → Extensions → Fix It In Prompt"
echo "  3. In the Settings tab, paste your fal.ai API key"
echo ""
