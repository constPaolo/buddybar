#!/usr/bin/env node
/*
 * Adds / removes the Buddybar hooks in your Claude Code user settings
 * (~/.claude/settings.json). A backup is written next to it before any change.
 *
 *   node scripts/hooks-setup.js install
 *   node scripts/hooks-setup.js uninstall
 *   node scripts/hooks-setup.js status
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = path.join(os.homedir(), '.buddybar');
const HOOK_DEST = path.join(HOME, 'buddybar-hook.js');
const HOOK_SRC = path.join(__dirname, '..', 'hooks', 'buddybar-hook.js');
const MARKER = 'buddybar-hook.js';

function settingsFile() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

// event -> { matcher, timeout (seconds) }
const EVENTS = {
  SessionStart: { timeout: 10 },
  SessionEnd: { timeout: 10 },
  UserPromptSubmit: { timeout: 10 },
  PreToolUse: { matcher: '*', timeout: 600 },
  PostToolUse: { matcher: '*', timeout: 10 },
  PostToolUseFailure: { matcher: '*', timeout: 10 },
  PermissionRequest: { matcher: '*', timeout: 600 },
  Notification: { timeout: 10 },
  Stop: { timeout: 10 },
  SubagentStop: { timeout: 10 },
};

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${file} is not valid JSON, fix it first (${e.message})`);
  }
}

function writeSettings(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.buddybar.bak');
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function stripOurs(settings) {
  const hooks = settings.hooks || {};
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = (hooks[ev] || [])
      .map((group) => ({
        ...group,
        hooks: (group.hooks || []).filter((hk) => !(hk.command || '').includes(MARKER)),
      }))
      .filter((group) => group.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  return settings;
}

function isInstalled() {
  try {
    const s = readSettings(settingsFile());
    return JSON.stringify(s.hooks || {}).includes(MARKER) && fs.existsSync(HOOK_DEST);
  } catch {
    return false;
  }
}

function install() {
  fs.mkdirSync(HOME, { recursive: true });
  // read+write instead of copy so it also works from inside a packaged (asar) app
  fs.writeFileSync(HOOK_DEST, fs.readFileSync(HOOK_SRC, 'utf8'), { mode: 0o755 });

  const file = settingsFile();
  const settings = stripOurs(readSettings(file));
  settings.hooks = settings.hooks || {};
  const command = `node "${HOOK_DEST}"`;

  for (const [ev, { matcher, timeout }] of Object.entries(EVENTS)) {
    const group = { hooks: [{ type: 'command', command, timeout }] };
    if (matcher) group.matcher = matcher;
    settings.hooks[ev] = [...(settings.hooks[ev] || []), group];
  }
  writeSettings(file, settings);
  return file;
}

function uninstall() {
  const file = settingsFile();
  if (!fs.existsSync(file)) return file;
  writeSettings(file, stripOurs(readSettings(file)));
  return file;
}

module.exports = { install, uninstall, isInstalled, settingsFile };

if (require.main === module) {
  const cmd = process.argv[2] || 'status';
  try {
    if (cmd === 'install') console.log(`✓ Buddybar hooks added to ${install()}`);
    else if (cmd === 'uninstall') console.log(`✓ Buddybar hooks removed from ${uninstall()}`);
    else console.log(isInstalled() ? 'Hooks installed' : 'Hooks not installed');
  } catch (e) {
    console.error('✗', e.message);
    process.exit(1);
  }
}
