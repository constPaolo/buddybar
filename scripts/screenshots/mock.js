'use strict';
/* Fake Buddybar bridge + sample agents, used only to render the README screenshots. */

(function () {
  const scene = new URLSearchParams(location.search).get('scene') || 'hero';
  const NOW = Date.now();
  const sec = 1000;
  let n = 0;
  const step = (agoSec, s) => ({ id: ++n, at: NOW - agoSec * sec, ...s });
  const tool = (agoSec, name, text, state = 'done') => step(agoSec, { type: 'tool', tool: name, text, state });

  const base = (id, status, extra = {}) => ({
    id,
    cwd: `/Users/me/code/${id}`,
    name: id,
    status,
    startedAt: NOW - 3600 * sec,
    lastActivity: NOW - 4 * sec,
    steps: [],
    pending: null,
    lastMessage: '',
    ...extra,
  });

  const landing = base('landing-page', 'working', {
    steps: [
      step(260, { type: 'session', text: 'Session startup' }),
      step(250, { type: 'prompt', text: 'Make the hero section responsive and fix the layout shift' }),
      tool(240, 'Read', 'Hero.tsx'),
      tool(232, 'Grep', '"breakpoint" in styles'),
      tool(220, 'Read', 'tailwind.config.ts'),
      tool(180, 'Edit', 'Hero.tsx'),
      tool(150, 'Edit', 'globals.css'),
      tool(90, 'Bash', 'Run the type checker'),
      tool(40, 'Edit', 'Hero.tsx'),
      tool(4, 'Bash', 'Run Lighthouse on the home page', 'running'),
    ],
  });

  const api = base('api-server', 'needs-you', {
    steps: [
      step(300, { type: 'prompt', text: 'Run the migrations and fix the failing tests' }),
      tool(290, 'Bash', 'Run the test suite', 'failed'),
      tool(240, 'Read', 'schema.prisma'),
      tool(200, 'Edit', 'user.service.ts'),
      tool(6, 'Bash', 'Apply database migrations', 'running'),
    ],
  });

  const design = base('design-system', 'working', {
    steps: [
      step(120, { type: 'prompt', text: 'Add a dark theme to the design tokens' }),
      tool(110, 'Glob', 'tokens/**/*.json'),
      tool(100, 'Read', 'colors.json'),
      tool(3, 'AskUserQuestion', 'How should dark mode be switched on?', 'running'),
    ],
  });

  const cli = base('cli-tool', 'idle', {
    lastActivity: NOW - 140 * sec,
    steps: [
      step(600, { type: 'prompt', text: 'Add a --json flag to the export command' }),
      tool(560, 'Edit', 'export.ts'),
      tool(500, 'Bash', 'Run tests'),
      step(140, { type: 'stop', text: 'Done! `export --json` now prints machine-readable output. Tests pass.' }),
    ],
  });

  const auth = base('auth', 'ended', { lastActivity: NOW - 1800 * sec });

  const permission = {
    requestId: 'r1',
    kind: 'permission',
    tool: 'Bash',
    text: 'Apply database migrations',
    detail: { command: 'npx prisma migrate deploy' },
  };

  const question = {
    requestId: 'r2',
    kind: 'question',
    questions: [{
      question: 'How should dark mode be switched on?',
      multiSelect: false,
      options: [
        { label: 'Follow the system', description: 'Use the OS light / dark setting automatically' },
        { label: 'Manual toggle', description: 'A switch in the settings page' },
      ],
    }],
  };

  const scenes = {
    hero: [landing, api, design, cli, auth],
    activity: [landing, api, design, cli, auth],
    header: [landing, api, design, cli, auth],
    permission: [landing, { ...api, pending: permission }, design, cli, auth],
    question: [landing, { ...api, status: 'working' }, { ...design, status: 'needs-you', pending: question }, cli, auth],
  };

  let stateCb = null;
  window.SHOT = { scene, NOW, sessions: scenes[scene] || scenes.hero, push: () => stateCb && stateCb(window.SHOT.sessions) };
  window.buddybar = {
    onState: (cb) => { stateCb = cb; },
    onFocusSession: () => {},
    resize() {}, decide() {}, dismiss() {}, openEditor() {}, menu() {}, focus() {}, installHooks() {},
    hooksInstalled: async () => true,
  };
  document.documentElement.classList.add('scene-' + scene);
})();
