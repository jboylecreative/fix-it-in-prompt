-- Fix It In Prompt — macOS Installer
-- Double-click to install. No terminal window. Progress shown as percentage.

-- ── Paths ─────────────────────────────────────────────────────────────────────

set appPath       to POSIX path of (path to me)
set resourcesPath to appPath & "Contents/Resources/"
set homeDir       to POSIX path of (path to home folder)
set helperDest    to homeDir & "Library/Application Support/AEImageGen/helper"
set cepUserDest   to homeDir & "Library/Application Support/Adobe/CEP/extensions/PremImageGen"
set cepSystemDest to "/Library/Application Support/Adobe/CEP/extensions/PremImageGen"

-- ── Progress setup ────────────────────────────────────────────────────────────

set progress total steps to 100
set progress completed steps to 0
set progress description to "Fix It In Prompt"
set progress additional description to "Starting…"
delay 0.3

-- ── Step 1: Check / install Node.js (0 → 30%) ────────────────────────────────

set progress additional description to "Checking for Node.js…"
set nodeCheck to do shell script "command -v node 2>/dev/null || ls /usr/local/bin/node 2>/dev/null || ls /opt/homebrew/bin/node 2>/dev/null || echo ''"
set progress completed steps to 5

if nodeCheck is "" then
    -- Node.js not found — download and install latest v22 LTS
    set progress total steps to 0
    set progress additional description to "Downloading Node.js (this may take a minute)…"

    set nodePkg to do shell script "curl -s https://nodejs.org/dist/latest-v22.x/ | grep -o 'node-v[0-9.]*\\.pkg' | head -1"
    set nodePkgUrl to "https://nodejs.org/dist/latest-v22.x/" & nodePkg
    do shell script "curl -fsSL " & quoted form of nodePkgUrl & " -o /tmp/fix_it_node.pkg 2>&1"

    set progress total steps to 100
    set progress completed steps to 15
    set progress additional description to "Installing Node.js…"
    do shell script "installer -pkg /tmp/fix_it_node.pkg -target /" with administrator privileges
    do shell script "rm -f /tmp/fix_it_node.pkg"
    set npmBin to "/usr/local/bin/npm"
else
    -- Node already present — find npm alongside it
    set npmBin to do shell script "command -v npm 2>/dev/null || ls /opt/homebrew/bin/npm 2>/dev/null || echo '/usr/local/bin/npm'"
end if

set progress completed steps to 30

-- ── Step 2: Install helper service (30 → 65%) ────────────────────────────────

set progress additional description to "Installing helper service…"
do shell script "mkdir -p " & quoted form of helperDest
do shell script "rsync -a --delete " & quoted form of (resourcesPath & "helper/") & " " & quoted form of helperDest
set progress completed steps to 40

-- npm install — slowest step (ffmpeg-static ~50 MB download)
-- Explicitly set PATH so npm can find node internally (AppleScript shell has minimal PATH)
set nodeBinDir to do shell script "dirname " & quoted form of npmBin
set progress total steps to 0
set progress additional description to "Installing dependencies (this may take a minute)…"
do shell script "export PATH=" & quoted form of nodeBinDir & ":/usr/local/bin:/opt/homebrew/bin:$PATH && cd " & quoted form of helperDest & " && " & npmBin & " install --production 2>&1"
set progress total steps to 100
set progress completed steps to 65

-- ── Step 3: CEP extension — user level (65 → 80%) ────────────────────────────

set progress additional description to "Installing Premiere Pro extension (user)…"
do shell script "mkdir -p " & quoted form of cepUserDest
do shell script "rsync -a --delete " & quoted form of (resourcesPath & "cep/") & " " & quoted form of cepUserDest
set progress completed steps to 80

-- ── Step 4: CEP extension — system level (80 → 95%) ─────────────────────────
-- Installs to /Library so the extension works for all users on this Mac.
-- Requires one admin password prompt. If declined, user-level install is sufficient.

set progress additional description to "Installing extension system-wide (admin required)…"
try
    do shell script "mkdir -p " & quoted form of cepSystemDest & " && rsync -a --delete " & quoted form of (resourcesPath & "cep/") & " " & quoted form of cepSystemDest with administrator privileges
on error
    -- Non-fatal: user-level install already done above
end try
set progress completed steps to 95

-- ── Step 5: Finish ────────────────────────────────────────────────────────────

set progress additional description to "Finishing up…"
delay 0.5
set progress completed steps to 100
set progress description to "Installation complete!"
set progress additional description to ""
delay 0.5

-- ── Done dialog ───────────────────────────────────────────────────────────────

display dialog "Fix It In Prompt has been installed successfully." & return & return & "Restart Premiere Pro, then open:" & return & "Window  →  Extensions  →  Fix It In Prompt" buttons {"OK"} default button "OK" with title "Installation Complete" with icon note
