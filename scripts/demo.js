#!/usr/bin/env node
/*
 * Fakes a few Claude Code sessions so you can see Buddybar without real agents.
 * Start the app first (npm start), then: npm run demo
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const HOME = path.join(os.homedir(), '.buddybar');
const token = fs.readFileSync(path.join(HOME, 'token'), 'utf8').trim();
let port = 47821;
try { port = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8')).port || port; } catch {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(input, wait = false) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ input, wait, editor: 'vscode' });
    const req = http.request(
      { host: '127.0.0.1', port, path: '/event', method: 'POST',
        headers: { 'content-type': 'application/json', 'x-buddybar-token': token } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); }
    );
    req.on('error', (e) => { console.error('Is Buddybar running? ', e.message); process.exit(1); });
    req.end(body);
  });
}

const cwd = (name) => path.join(os.homedir(), 'code', name);
const ev = (session_id, name, hook_event_name, extra = {}) =>
  send({ session_id, cwd: cwd(name), hook_event_name, ...extra }, extra.__wait);

async function agentA() {
  const id = 'demo-a', n = 'landing-page';
  await ev(id, n, 'SessionStart', { source: 'startup' });
  await ev(id, n, 'UserPromptSubmit', { prompt: 'Make the hero section responsive' });
  const steps = [
    ['Read', { file_path: 'src/components/Hero.tsx' }],
    ['Grep', { pattern: 'breakpoint', path: 'src/styles' }],
    ['Edit', { file_path: 'src/components/Hero.tsx' }],
    ['Bash', { command: 'npm run lint', description: 'Lint the project' }],
  ];
  for (const [tool, input] of steps) {
    await ev(id, n, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: tool + Math.random() });
    await sleep(1500);
    await ev(id, n, 'PostToolUse', { tool_name: tool, tool_input: input });
  }
  await ev(id, n, 'Stop', {});
}

async function agentB() {
  const id = 'demo-b', n = 'api-server';
  await ev(id, n, 'SessionStart', { source: 'startup' });
  await ev(id, n, 'UserPromptSubmit', { prompt: 'Run the migrations and fix failing tests' });
  await ev(id, n, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'b1' });
  await sleep(1200);
  await ev(id, n, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1' });
  const input = { command: 'npx prisma migrate deploy', description: 'Apply database migrations' };
  await ev(id, n, 'PreToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: 'b2' });
  console.log('api-server is asking for permission… answer it in Buddybar');
  const res = await ev(id, n, 'PermissionRequest', { tool_name: 'Bash', tool_input: input, __wait: true });
  console.log('permission answer →', res);
  await ev(id, n, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'b2' });
  await ev(id, n, 'Stop', {});
}

async function agentC() {
  const id = 'demo-c', n = 'mobile-app';
  await sleep(2500);
  await ev(id, n, 'SessionStart', { source: 'startup' });
  await ev(id, n, 'UserPromptSubmit', { prompt: 'Add dark mode' });
  const tool_input = {
    questions: [{
      question: 'Which approach should I use for dark mode?',
      header: 'Approach',
      multiSelect: false,
      options: [
        { label: 'System setting', description: 'Follow the OS appearance automatically' },
        { label: 'Manual toggle', description: 'A switch in the settings screen' },
      ],
    }],
  };
  console.log('mobile-app is asking a question… answer it in Buddybar');
  const res = await ev(id, n, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_input, tool_use_id: 'c1', __wait: true });
  console.log('question answer →', res);
  await ev(id, n, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'c1' });
  await ev(id, n, 'Stop', {});
}

Promise.all([agentA(), agentB(), agentC()]).then(() => console.log('demo done'));
