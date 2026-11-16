'use strict';
/*
 * Renders the README screenshots from the real UI with fake agents.
 *   npm run screenshots   ->  docs/images/*.png
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', '..', 'docs', 'images');
const SCENES = ['hero', 'activity', 'permission', 'question', 'header'];
const SCALE = 1; // capturePage already returns retina (2x) pixels on HiDPI screens

app.disableHardwareAcceleration();

function makeWindow() {
  return new BrowserWindow({
    width: 900 * SCALE,
    height: 1000 * SCALE,
    show: false,
    transparent: true,
    frame: false,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, zoomFactor: SCALE, contextIsolation: false },
  });
}

async function shoot(win, scene) {
  await win.loadFile(path.join(__dirname, 'shot.html'), { query: { scene } });
  for (let i = 0; i < 50; i++) {
    if (await win.webContents.executeJavaScript('document.body.dataset.ready === "1"')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 400));
  const rect = await win.webContents.executeJavaScript(
    'JSON.stringify(document.getElementById("stage").getBoundingClientRect())'
  );
  const r = JSON.parse(rect);
  const img = await win.webContents.capturePage({
    x: Math.floor(r.left * SCALE),
    y: Math.floor(r.top * SCALE),
    width: Math.ceil(r.width * SCALE),
    height: Math.ceil(r.height * SCALE),
  });
  fs.writeFileSync(path.join(OUT, `${scene}.png`), img.toPNG());
  console.log('✓', scene, img.getSize());
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = makeWindow();
  for (const s of SCENES) await shoot(win, s);
  app.quit();
});
