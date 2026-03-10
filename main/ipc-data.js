const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// In production (packaged), store data in user's app data directory
// In development, store next to the app source
const IS_PACKAGED = app.isPackaged;
const DATA_DIR = IS_PACKAGED
  ? path.join(app.getPath('userData'), 'data')
  : path.join(__dirname, '..', 'data');
const SCRIPTS_DIR = path.join(DATA_DIR, 'scripts');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function uuid() {
  return crypto.randomUUID();
}

module.exports = { DATA_DIR, SCRIPTS_DIR, ensureDataDir, readJson, writeJson, uuid };
