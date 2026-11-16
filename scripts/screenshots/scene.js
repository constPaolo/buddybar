'use strict';
/* Arranges each screenshot scene once the real Buddybar UI (app.js) has rendered. */

(async function () {
  const { scene, NOW } = window.SHOT;
  document.querySelector('.mb-right').textContent =
    new Date(NOW).toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + clock(NOW);

  window.SHOT.push();
  await new Promise((r) => setTimeout(r, 120));

  if (scene === 'activity' || scene === 'header') {
    selectedId = 'landing-page';
    render();
  }
  await new Promise((r) => setTimeout(r, 80));

  const stage = document.getElementById('stage').getBoundingClientRect();
  const overlay = document.getElementById('overlay');
  const rel = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height };
  };

  if (scene === 'hero') {
    const LABELS = {
      working: ['Working', '#7cc4ff'],
      'needs-you': ['Needs you', '#ffb547'],
      idle: ['Done, your turn', '#4ade80'],
      ended: ['Session ended', '#9a9aa8'],
    };
    document.querySelectorAll('#buddies .buddy').forEach((b, i) => {
      const s = window.SHOT.sessions[i];
      const r = rel(b);
      const [text, color] = LABELS[s.status];
      const drop = i % 2 ? 62 : 16;
      const label = document.createElement('div');
      label.className = 'label';
      label.style.left = r.x + r.w / 2 + 'px';
      label.style.top = r.y + r.h + 10 + 'px';
      label.innerHTML = `<div class="stem" style="height:${drop}px"></div>
        <div class="pill"><span class="dot" style="background:${color}"></span>${text}<small>${s.name}</small></div>`;
      overlay.append(label);
    });
  }

  if (scene === 'header') {
    const head = document.querySelector('#panel .head');
    const targets = [head.querySelector('.time-btn'), head.querySelector('.icon-btn')];
    targets.forEach((el, i) => {
      el.classList.add('spot');
      const r = rel(el);
      const m = document.createElement('div');
      m.className = 'marker';
      m.textContent = i + 1;
      m.style.left = r.x - 10 + 'px';
      m.style.top = r.y - 12 + 'px';
      overlay.append(m);
    });
    const hr = rel(head);
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = `
      <div class="item"><span class="marker">1</span><span>Click the time<small>Jump straight back to the project in VS Code</small></span></div>
      <div class="item"><span class="marker">2</span><span>Cross it off<small>Remove a session from the bar once it's done</small></span></div>`;
    overlay.append(legend);
    legend.style.top = hr.y + hr.h / 2 - legend.getBoundingClientRect().height / 2 + 40 + 'px';
  }

  document.body.dataset.ready = '1';
})();
