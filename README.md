# Fix It In Prompt — Premiere Pro Extension

An AI-powered panel for Adobe Premiere Pro that lets you edit images, generate images, and create AI video directly from your timeline — all without leaving Premiere.

---

## What's Included

When you run the installer, it sets up two things on your computer:

**1. The Premiere Pro panel**
A dockable panel that appears under **Window → Extensions → Fix It In Prompt**. This is the interface you interact with — it has tabs for generating images, editing images, generating video from an image, and video-to-video editing.

**2. A background helper service**
A small local server that runs silently in the background whenever Premiere Pro is open. The panel can't make API calls or write files to disk on its own (Adobe's extension sandbox prevents it), so it hands those tasks off to the helper. The helper runs on your machine only — it is never accessible from outside your computer.

---

## Requirements

- macOS or Windows
- Adobe Premiere Pro 2026
- A [fal.ai](https://fal.ai) account and API key

---

## Before You Install — Get a fal.ai API Key

fal.ai is the AI service that powers this extension. You'll need an account with credits and an API key before you can use it.

1. Go to [fal.ai](https://fal.ai) and create an account
2. Add credits to your account (usage is billed per generation)
3. Go to [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys)
4. Click **Add Key**, give it a name, and copy the key — you'll paste it into the extension after installing

---

## Installation

The installation folder contains everything you need:

```
Fix It In Prompt/
  README.md         ← this file
  install.sh        ← installer for Mac
  install-win.bat   ← installer for Windows
  cep/              ← Premiere Pro extension files
  helper/           ← background service files
```

All items must stay together — the installer scripts find the other folders automatically.

---

## Mac Installation

### Step 1 — Open Terminal

Terminal is a built-in Mac app. To open it:

- Press **Command + Space**, type **Terminal**, press Enter
- Or go to **Finder → Applications → Utilities → Terminal**

---

### Step 2 — Navigate to the installation folder

In Terminal, type `cd ` (the letters c, d, and a space), then drag the **Fix It In Prompt** folder from Finder into the Terminal window. The folder path will fill in automatically. Press **Enter**.

It will look something like this:

```
cd /Users/yourname/Downloads/Fix\ It\ In\ Prompt
```

---

### Step 3 — Run the installer

Type the following exactly and press Enter:

```
bash install.sh
```

The installer will run through several steps automatically:

- Verifies Node.js is installed
- Copies the helper service to your Mac
- Downloads and installs helper dependencies (~50 MB — takes about a minute)
- Copies the extension to your Adobe extensions folder
- Attempts a system-wide install as well (you'll be prompted for your Mac password)
- Enables the extension in Premiere Pro

When you see a password prompt, type your Mac login password and press Enter. The characters won't appear as you type — that's normal.

---

### Step 4 — Install Node.js if needed

If the installer prints **Node.js not found**, you need to install it first:

1. Go to [nodejs.org](https://nodejs.org)
2. Download the **LTS** version (the left button on the homepage)
3. Open the downloaded file and follow the installer steps
4. Go back to Terminal and run `bash install.sh` again

---

### Step 5 — Restart Premiere Pro

Fully quit Premiere Pro (**Command + Q**) and reopen it. The extension will appear under:

**Window → Extensions → Fix It In Prompt**

---

## Windows Installation

### Step 1 — Install Node.js if you don't have it

Open a browser and go to [nodejs.org](https://nodejs.org). Download the **LTS** version (the left button on the homepage), open the downloaded file, and follow the installer steps.

If you're not sure whether Node.js is already installed: press **Windows + R**, type `cmd`, press Enter, then type `node --version` and press Enter. If you see a version number, you have it.

---

### Step 2 — Run the installer

In the **Fix It In Prompt** folder, right-click **install-win.bat** and select **Run as administrator**.

> **Important:** The installer must run as administrator to install the extension in the correct location for Premiere Pro. If you just double-click it, it will automatically prompt for administrator access — click Yes when asked.

The installer will:

- Verify Node.js is installed
- Copy the helper service to `%APPDATA%\AEImageGen\helper`
- Download and install helper dependencies (~50 MB — takes about a minute)
- Copy the extension to the Premiere Pro extensions folder
- Enable the extension in Premiere Pro via the registry

A window will stay open showing progress. It will say **Installation complete!** when finished. Press any key to close it.

---

### Step 3 — Restart Premiere Pro

Fully quit Premiere Pro and reopen it. The extension will appear under:

**Window → Extensions → Fix It In Prompt**

---

## Entering Your API Key

1. In Premiere Pro, go to **Window → Extensions → Fix It In Prompt**
2. Click the **Settings** tab
3. Paste your fal.ai API key into the field and click **Save**

Your key is stored locally on your computer and is only ever sent to fal.ai when making a generation request. It is never stored anywhere else.

---

## Using the Extension

### Generate Image
Generate a new AI image from a text prompt. Choose a model, aspect ratio, and optional seed for reproducibility.

### Edit Image
Select an image in your timeline, write a prompt describing the change you want, and the AI will edit it. The result is imported back into your project automatically.

### Video (Image to Video)
Select an image clip, write a motion prompt, and generate an AI video from it. Choose your model, resolution, duration, and aspect ratio. This plugin currently requires an image as input — a text-only mode may be supported in a future version.

### V2V (Video to Video)
Select a video clip in your timeline and use AI to re-render or stylize it based on a prompt. Currently supports:

- **Kling O3 — Edit**: edit video content with a prompt, optionally using reference images and elements
- **Kling O3 — Reference**: restyle video using a reference video and optional images
- **Happy Horse**: video editing with resolution control

For details on using images and elements with Kling:
- [Kling O3 Edit](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit)
- [Kling O3 Reference](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/reference)

---

## How It Works

```
Premiere Pro Panel  ←→  Local Helper (port 47832)  ←→  fal.ai API
```

When you click **Generate**, the panel sends your request to the local helper running on your machine. The helper uploads your source file to fal.ai, submits the generation job, polls for completion, downloads the result, and saves it to your project folder. The panel updates in real time as this happens.

The helper launches automatically in the background when Premiere Pro opens and shuts down when you quit.

Output files are saved to:
- **Saved project**: `<project folder>/AI_Generated/outputs/`
- **Unsaved project** (Mac): `~/Documents/AE_AI_Generated/<project name>/outputs/`
- **Unsaved project** (Windows): `%USERPROFILE%\Documents\AE_AI_Generated\<project name>\outputs\`

---

## Troubleshooting

**The extension doesn't appear under Window → Extensions**
Fully quit and reopen Premiere Pro. If it still doesn't appear, run the installer again and restart Premiere Pro.

**Requests hang or nothing happens after clicking Generate**
The background helper may have stopped. 

- **Mac**: Open Terminal and run `pkill -f "AEImageGen"`, then restart Premiere Pro
- **Windows**: Open Task Manager, find any `node.exe` process, end it, then restart Premiere Pro

The helper will relaunch automatically when Premiere Pro opens.

**After reinstalling, generations still use the old version**
The helper runs as a background process and won't pick up new files until it restarts. Kill it using the steps above, then restart Premiere Pro.

**"API key not configured" error**
Go to the **Settings** tab and make sure your fal.ai API key is saved.

**Node.js not found**
Install Node.js from [nodejs.org](https://nodejs.org) (LTS version), then run the installer again.

**npm install fails during setup**
Make sure you have an internet connection — the installer needs to download approximately 50 MB of dependencies. Corporate networks or firewalls may block this.
