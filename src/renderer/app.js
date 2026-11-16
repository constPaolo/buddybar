'use strict';

const COLORS = ['#ff8a65', '#7cc4ff', '#b39ddb', '#4dd0a1', '#ffd54f', '#f48fb1', '#80deea', '#c5e1a5'];
const TOOL_ICONS = {
  Bash: '›_', Read: '◰', Write: '✎', Edit: '✎', MultiEdit: '✎', Grep: '⌕', Glob: '⌕',
  WebFetch: '◍', WebSearch: '◍', Task: '◈', Agent: '◈', TodoWrite: '☑', AskUserQuestion: '?',
};
const STATUS_LABEL = { working: 'Working', 'needs-you': 'Needs you', idle: 'Waiting for you', ended: 'Ended' };

let sessions = [];
let selectedId = null;
let hooksInstalled = true;
const autoOpened = new Set();
const drafts = new Map(); // requestId -> { picks: {question: Set}, other: {question: string} }
let renderedCardKey = null;

const $ = (sel) => document.querySelector(sel);

/** Tiny DOM helper: never uses innerHTML for untrusted text. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function hash(str) {
  let x = 0;
  for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(x);
}

function clock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ago(ts) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

/* ---------- the little buddy ---------- */

function buddySvg(session) {
  const n = hash(session.id);
  const color = COLORS[n % COLORS.length];
  const antenna = n % 3; // a bit of personality
  const bod = s('g', { class: 'bod' },
    antenna === 0 ? s('line', { x1: 24, y1: 8, x2: 24, y2: 2, stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' }) : s('g'),
    antenna === 0 ? s('circle', { cx: 24, cy: 2, r: 2.2, fill: color }) : s('g'),
    antenna === 1 ? s('path', { d: 'M15 11 L12 4 L19 8 Z M33 11 L36 4 L29 8 Z', fill: color }) : s('g'),
    s('path', {
      d: 'M8 28 C8 15 15 8 24 8 C33 8 40 15 40 28 L40 39 Q36 35 32 39 Q28 43 24 39 Q20 35 16 39 Q12 43 8 39 Z',
      fill: color,
    }),
    // open eyes
    s('g', { class: 'eye-open' },
      s('circle', { cx: 18, cy: 23, r: 4, fill: '#fff' }),
      s('circle', { cx: 30, cy: 23, r: 4, fill: '#fff' }),
      s('circle', { class: 'pupil', cx: 18.6, cy: 23.6, r: 2, fill: '#1b1b22' }),
      s('circle', { class: 'pupil', cx: 30.6, cy: 23.6, r: 2, fill: '#1b1b22' }),
    ),
    // closed eyes
    s('g', { class: 'eye-closed', stroke: '#1b1b22', 'stroke-width': 1.8, 'stroke-linecap': 'round', fill: 'none' },
      s('path', { d: 'M14.5 24 Q18 26.5 21.5 24' }),
      s('path', { d: 'M26.5 24 Q30 26.5 33.5 24' }),
    ),
    session.status === 'needs-you'
      ? s('ellipse', { cx: 24, cy: 32, rx: 2.4, ry: 2.8, fill: '#1b1b22' })
      : s('path', { d: 'M20.5 31 Q24 34 27.5 31', stroke: '#1b1b22', 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round' }),
  );
  return s('svg', { viewBox: '0 0 48 48' },
    s('ellipse', { cx: 24, cy: 45, rx: 12, ry: 2.2, fill: 'rgba(0,0,0,0.35)' }),
    bod,
    s('text', { class: 'zzz', x: 38, y: 10 }, 'z'),
  );
}

function renderBar() {
  const box = $('#buddies');
  box.replaceChildren();
  if (!sessions.length) {
    box.append(
      h('span', { class: 'empty' },
        hooksInstalled ? 'No agents yet' : 'Hooks not installed',
        !hooksInstalled && h('button', { class: 'link', onclick: () => window.buddybar.installHooks() }, 'Install'),
      ),
    );
    return;
  }
  for (const se of sessions) {
    const btn = h('button', {
      class: `buddy ${se.status}${se.id === selectedId ? ' selected' : ''}`,
      title: `${se.name} · ${STATUS_LABEL[se.status] || se.status}`,
      onclick: () => {
        selectedId = selectedId === se.id ? null : se.id;
        render();
      },
    });
    btn.append(buddySvg(se));
    if (se.status === 'needs-you') btn.append(h('span', { class: 'badge' }, '!'));
    box.append(btn);
  }
}

/* ---------- detail panel ---------- */

function stepIcon(st) {
  if (st.type === 'tool') return TOOL_ICONS[st.tool] || '•';
  return { prompt: '❯', stop: '✓', note: 'ℹ', session: '○', you: '★' }[st.type] || '•';
}

function renderSteps(se) {
  const list = h('div', { class: 'steps' });
  for (const st of se.steps) {
    list.append(
      h('div', { class: `step ${st.type} ${st.state || ''}`, title: st.text },
        h('span', { class: 'ico' }, stepIcon(st)),
        h('span', { class: 'txt' }, st.type === 'tool' && h('span', { class: 'tool' }, st.tool), st.text),
        h('span', { class: 'at' }, clock(st.at)),
      ),
    );
  }
  return list;
}

function permissionCard(se) {
  const p = se.pending;
  const detail = p.detail || {};
  const body =
    detail.command || detail.content || detail.new_string || detail.url || detail.file_path ||
    JSON.stringify(detail, null, 2);
  const decide = (action) => window.buddybar.decide(p.requestId, { action });
  return h('div', { class: 'card' },
    h('h4', {}, 'Permission needed'),
    h('div', { class: 'what' }, `${p.tool}${p.text && p.text !== body ? ' · ' + p.text : ''}`),
    h('pre', {}, String(body).slice(0, 4000)),
    h('div', { class: 'row' },
      h('button', { class: 'btn allow', onclick: () => decide('allow') }, 'Allow'),
      h('button', { class: 'btn deny', onclick: () => decide('deny') }, 'Deny'),
    ),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => decide('defer') }, 'Decide in editor'),
    ),
  );
}

function questionCard(se) {
  const p = se.pending;
  if (!drafts.has(p.requestId)) drafts.set(p.requestId, { picks: {}, other: {} });
  const d = drafts.get(p.requestId);
  const questions = p.questions || [];
  const card = h('div', { class: 'card' }, h('h4', {}, questions.length > 1 ? 'Claude has questions' : 'Claude asks'));

  const submit = () => {
    const answers = {};
    for (const q of questions) {
      const picked = [...(d.picks[q.question] || [])];
      const other = (d.other[q.question] || '').trim();
      if (other) picked.push(other);
      if (!picked.length) return; // every question needs an answer
      answers[q.question] = picked.join(', ');
    }
    window.buddybar.decide(p.requestId, { action: 'answer', answers });
    drafts.delete(p.requestId);
  };

  for (const q of questions) {
    const picks = (d.picks[q.question] = d.picks[q.question] || new Set());
    const opts = h('div', { class: 'opts' });
    for (const o of q.options || []) {
      const b = h('button', {
        class: `btn opt${picks.has(o.label) ? ' picked' : ''}`,
        onclick: () => {
          if (q.multiSelect) {
            picks.has(o.label) ? picks.delete(o.label) : picks.add(o.label);
            b.classList.toggle('picked', picks.has(o.label));
          } else {
            picks.clear();
            picks.add(o.label);
            d.other[q.question] = '';
            if (questions.length === 1) return submit();
            opts.querySelectorAll('.opt').forEach((x) => x.classList.toggle('picked', x === b));
          }
        },
      }, o.label, o.description && h('span', { class: 'desc' }, o.description));
      opts.append(b);
    }
    const other = h('input', {
      class: 'other',
      placeholder: 'Other… (type and press Enter)',
      value: d.other[q.question] || '',
      onfocus: () => window.buddybar.focus(),
      oninput: (e) => {
        d.other[q.question] = e.target.value;
        if (!q.multiSelect && e.target.value) {
          picks.clear();
          opts.querySelectorAll('.opt').forEach((x) => x.classList.remove('picked'));
        }
      },
      onkeydown: (e) => { if (e.key === 'Enter') submit(); },
    });
    opts.append(other);
    card.append(h('div', { class: 'q' }, q.question), opts);
  }

  const needsSubmit = questions.length > 1 || questions.some((q) => q.multiSelect);
  card.append(
    h('div', { class: 'row' },
      needsSubmit && h('button', { class: 'btn allow', onclick: submit }, 'Send answers'),
      h('button', { class: 'btn ghost', onclick: () => window.buddybar.decide(p.requestId, { action: 'defer' }) }, 'Answer in editor'),
    ),
  );
  return card;
}

function renderPanel() {
  const panel = $('#panel');
  const se = sessions.find((x) => x.id === selectedId);
  if (!se) {
    panel.hidden = true;
    panel.replaceChildren();
    renderedCardKey = null;
    return;
  }
  panel.hidden = false;

  const cardKey = se.pending ? se.pending.requestId : null;
  const oldCard = panel.querySelector('.card');
  const keepCard = cardKey && cardKey === renderedCardKey && oldCard;
  const oldSteps = panel.querySelector('.steps');
  const wasAtBottom = !oldSteps || oldSteps.scrollTop + oldSteps.clientHeight >= oldSteps.scrollHeight - 8;
  const prevScroll = oldSteps ? oldSteps.scrollTop : 0;

  const head = h('div', { class: 'head' },
    h('div', { class: 'title' },
      h('div', { class: 'name' }, se.name),
      h('div', { class: 'sub' },
        h('span', { class: `status-dot ${se.status}` }),
        `${STATUS_LABEL[se.status] || se.status} · ${ago(se.lastActivity)}`),
    ),
    h('button', {
      class: 'time-btn',
      title: se.cwd ? `Jump back to ${se.cwd}` : 'No folder known',
      onclick: () => window.buddybar.openEditor(se.id),
    }, clock(se.lastActivity)),
    h('button', {
      class: 'icon-btn',
      title: 'Cross off this session',
      onclick: () => { window.buddybar.dismiss(se.id); selectedId = null; },
    }, '✕'),
  );

  let card = null;
  if (keepCard) card = oldCard;
  else if (se.pending && se.pending.kind === 'permission') card = permissionCard(se);
  else if (se.pending && se.pending.kind === 'question') card = questionCard(se);
  renderedCardKey = cardKey;

  const steps = renderSteps(se);
  const foot = h('div', { class: 'foot' },
    h('span', {}, `${se.steps.filter((x) => x.type === 'tool').length} steps`),
    h('button', { class: 'link', onclick: () => window.buddybar.openEditor(se.id) }, 'Open in editor ↗'),
  );

  if (keepCard) {
    // swap everything around the card so a half-typed answer keeps focus
    panel.querySelector('.head').replaceWith(head);
    oldSteps.replaceWith(steps);
    panel.querySelector('.foot').replaceWith(foot);
  } else {
    panel.replaceChildren(...[head, card, steps, foot].filter(Boolean));
  }
  steps.scrollTop = wasAtBottom ? steps.scrollHeight : prevScroll;
}

function render() {
  if (selectedId && !sessions.some((x) => x.id === selectedId)) selectedId = null;
  // Pop open an agent that needs you (once per request).
  const needy = sessions.find((x) => x.pending && !autoOpened.has(x.pending.requestId));
  if (needy) {
    autoOpened.add(needy.pending.requestId);
    selectedId = needy.id;
  }
  renderBar();
  renderPanel();
}

/* ---------- wiring ---------- */

const ro = new ResizeObserver(() => {
  const r = $('#root').getBoundingClientRect();
  window.buddybar.resize(r.width + 2, r.height + 2);
});
ro.observe($('#root'));

$('#menu-btn').addEventListener('click', () => window.buddybar.menu());
document.addEventListener('contextmenu', (e) => { e.preventDefault(); window.buddybar.menu(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) { selectedId = null; render(); }
});

window.buddybar.onState(async (next) => {
  sessions = next;
  hooksInstalled = await window.buddybar.hooksInstalled();
  render();
});
window.buddybar.onFocusSession((id) => { selectedId = id; render(); });

// keep "x ago" fresh
setInterval(() => { if (selectedId) renderPanel(); }, 15000);
render();
