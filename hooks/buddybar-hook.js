#!/usr/bin/env node
/*
 * Buddybar — Claude Code hook bridge.
 *
 * Claude Code runs this for every hook event and pipes the event JSON on stdin.
 * We forward it to the Buddybar app on 127.0.0.1. For permission requests
 * and AskUserQuestion we wait for your decision and print it back to Claude Code.
 *
 * If the app isn't running, this exits silently and Claude Code behaves as usual.
 * No dependencies: plain Node 18+.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const HOME = path.join(os.homedir(), '.buddybar');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function detectEditor() {
  const env = process.env;
  const hint = [env.VSCODE_GIT_ASKPASS_MAIN, env.VSCODE_IPC_HOOK_CLI, env.__CFBundleIdentifier, env.TERM_PROGRAM]
    .filter(Boolean).join(' ').toLowerCase();
  if (env.CURSOR_TRACE_ID || hint.includes('cursor')) return 'cursor';
  if (hint.includes('windsurf')) return 'windsurf';
  if (hint.includes('insiders')) return 'vscode-insiders';
  if (env.TERM_PROGRAM === 'vscode' || hint.includes('vscode') || hint.includes('visual studio code')) return 'vscode';
  return null;
}

function main(raw) {
  let input;
  try { input = JSON.parse(raw); } catch { return process.exit(0); }

  let token = '';
  try { token = fs.readFileSync(path.join(HOME, 'token'), 'utf8').trim(); } catch { return process.exit(0); }
  const cfg = readJson(path.join(HOME, 'config.json'));
  const port = Number(process.env.BUDDYBAR_PORT || cfg.port || 47821);
  const waitSeconds = Number(cfg.waitSeconds || 300);

  const ev = input.hook_event_name;
  const wait = ev === 'PermissionRequest' || (ev === 'PreToolUse' && input.tool_name === 'AskUserQuestion');

  const body = JSON.stringify({ input, wait, editor: detectEditor() });
  const req = http.request(
    {
      host: '127.0.0.1',
      port,
      path: '/event',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-buddybar-token': token,
      },
      timeout: wait ? (waitSeconds + 5) * 1000 : 1500,
    },
    (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const out = JSON.parse(data).output;
          if (out) process.stdout.write(JSON.stringify(out));
        } catch {}
        process.exit(0);
      });
    }
  );
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.on('error', () => process.exit(0));
  req.end(body);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => main(raw));
