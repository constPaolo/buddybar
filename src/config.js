'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const HOME_DIR = path.join(os.homedir(), '.buddybar');
const TOKEN_FILE = path.join(HOME_DIR, 'token');
const CONFIG_FILE = path.join(HOME_DIR, 'config.json');

const DEFAULTS = {
  port: 47821,
  // Which editor the "jump back" click opens: vscode | vscode-insiders | cursor | windsurf
  editor: 'vscode',
  // Show a system notification when an agent needs you
  notifications: true,
  // Seconds a permission / question waits in Buddybar before falling back to the editor
  waitSeconds: 300,
};

function ensureHomeDir() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
}

function readConfig() {
  ensureHomeDir();
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2) + '\n');
  }
  const cfg = { ...DEFAULTS, ...user };
  if (process.env.BUDDYBAR_PORT) cfg.port = Number(process.env.BUDDYBAR_PORT);
  return cfg;
}

function getToken() {
  ensureHomeDir();
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  } catch {}
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  return t;
}

module.exports = { HOME_DIR, TOKEN_FILE, CONFIG_FILE, DEFAULTS, readConfig, getToken };
