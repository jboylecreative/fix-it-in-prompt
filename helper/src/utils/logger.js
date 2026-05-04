'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || os.homedir(), 'AEImageGen', 'logs')
  : path.join(os.homedir(), 'Library', 'Logs', 'AEImageGen');
const LOG_FILE = path.join(LOG_DIR, 'helper.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB rotate threshold

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function rotatIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    }
  } catch {}
}

function write(level, message, extra) {
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level}] ${message}`;
  if (extra) {
    if (extra instanceof Error) {
      line += `\n  ${extra.stack || extra.message}`;
    } else {
      try { line += `\n  ${JSON.stringify(extra)}`; } catch {}
    }
  }
  line += '\n';

  console[level === 'ERROR' ? 'error' : 'log'](line.trimEnd());

  ensureLogDir();
  rotatIfNeeded();
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

const logger = {
  info:  (msg, extra) => write('INFO',  msg, extra),
  warn:  (msg, extra) => write('WARN',  msg, extra),
  error: (msg, extra) => write('ERROR', msg, extra),
  logFilePath: LOG_FILE,
};

module.exports = { logger };
