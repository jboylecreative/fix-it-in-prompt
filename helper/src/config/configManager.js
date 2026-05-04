'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.ae-image-gen');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {
    // Corrupt config — start fresh
  }
  return {};
}

function saveConfig(data) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getApiKey(provider) {
  // Environment variable takes precedence (useful for dev/CI)
  const envKey = process.env[`FAL_API_KEY`];
  if (provider === 'fal' && envKey) return envKey;

  const config = loadConfig();
  return config[`${provider}_api_key`] || null;
}

function setApiKey(provider, apiKey) {
  const config = loadConfig();
  config[`${provider}_api_key`] = apiKey;
  saveConfig(config);
}

const configManager = { getApiKey, setApiKey };
module.exports = { configManager };
