#!/usr/bin/env bash
# Builds "Install Fix It In Prompt.app" — run this once to produce the distributable.
# Requires: macOS with osacompile (standard), rsync (standard).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREMIERE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_NAME="Install Fix It In Prompt"
DIST_DIR="$SCRIPT_DIR/dist"
OUTPUT="$DIST_DIR/$APP_NAME.app"

echo "Building macOS installer…"
mkdir -p "$DIST_DIR"

# Remove any previous build
rm -rf "$OUTPUT"

# Compile the AppleScript into an .app bundle
echo "  Compiling installer app…"
osacompile -o "$OUTPUT" "$SCRIPT_DIR/installer.applescript"

# Bundle the CEP extension (excluding macOS noise)
echo "  Bundling CEP extension…"
rsync -a --delete \
    --exclude='.DS_Store' \
    --exclude='__MACOSX' \
    "$PREMIERE_DIR/cep/" \
    "$OUTPUT/Contents/Resources/cep/"

# Bundle the helper service (no node_modules — installer runs npm install)
echo "  Bundling helper service…"
rsync -a --delete \
    --exclude='.DS_Store' \
    --exclude='__MACOSX' \
    --exclude='node_modules' \
    "$PREMIERE_DIR/helper/" \
    "$OUTPUT/Contents/Resources/helper/"

# Make the compiled executable runnable
chmod +x "$OUTPUT/Contents/MacOS/applet" 2>/dev/null || true

echo ""
echo "✓  Installer ready:"
echo "   $OUTPUT"
echo ""
echo "   To distribute: compress to .zip or wrap in a .dmg."
echo "   Users double-click the .app — no terminal window appears."
