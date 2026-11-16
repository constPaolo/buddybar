'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { SessionStore, summarizeTool } = require('../src/sessions');

const base = { session_id: 's1', cwd: '/tmp/my-project' };

test('tracks a session through a turn', () => {
  const store = new SessionStore();
  store.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
  store.handle({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a/b.js' }, tool_use_id: 't1' });
  let s = store.snapshot()[0];
  assert.equal(s.name, 'my-project');
  assert.equal(s.status, 'working');
  assert.equal(s.steps.at(-1).state, 'running');
  store.handle({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 't1' });
  store.handle({ ...base, hook_event_name: 'Stop' });
  s = store.snapshot()[0];
  assert.equal(s.status, 'idle');
  assert.equal(s.steps.find((x) => x.type === 'tool').state, 'done');
});

test('permission allow returns a PermissionRequest decision', async () => {
  const store = new SessionStore();
  const p = store.handle({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }, { wait: true });
  const s = store.snapshot()[0];
  assert.equal(s.status, 'needs-you');
  store.decide(s.pending.requestId, { action: 'allow' });
  const out = await p;
  assert.deepEqual(out.hookSpecificOutput.decision, { behavior: 'allow' });
});

test('defer falls back to the editor (no output)', async () => {
  const store = new SessionStore();
  const p = store.handle({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} }, { wait: true });
  store.decide(store.snapshot()[0].pending.requestId, { action: 'defer' });
  assert.equal(await p, null);
});

test('question answers go into updatedInput', async () => {
  const store = new SessionStore();
  const tool_input = { questions: [{ question: 'Pick one?', options: [{ label: 'A' }, { label: 'B' }] }] };
  const p = store.handle({ ...base, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input }, { wait: true });
  store.decide(store.snapshot()[0].pending.requestId, { action: 'answer', answers: { 'Pick one?': 'B' } });
  const out = (await p).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.deepEqual(out.updatedInput.answers, { 'Pick one?': 'B' });
  assert.deepEqual(out.updatedInput.questions, tool_input.questions);
});

test('summaries are short and useful', () => {
  assert.equal(summarizeTool('Edit', { file_path: '/x/y/z.ts' }), 'z.ts');
  assert.equal(summarizeTool('Bash', { command: 'npm test', description: 'Run tests' }), 'Run tests');
});
