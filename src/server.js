'use strict';

const http = require('http');

/**
 * Tiny local HTTP bridge. Claude Code hooks POST their payload to /event;
 * blocking events (permissions, questions) keep the request open until
 * you decide in Buddybar.
 */
function createServer({ store, token, port, waitSeconds }) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, app: 'buddybar' }));
    }
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404);
      return res.end();
    }
    if (req.headers['x-buddybar-token'] !== token) {
      res.writeHead(401);
      return res.end();
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) req.destroy();
    });
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        return res.end();
      }
      const input = payload.input || {};
      const meta = { wait: !!payload.wait, editor: payload.editor || null };
      const pending = store.handle(input, meta);

      if (!pending) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{}');
      }

      let done = false;
      const requestId = [...store.pending.keys()].pop();
      const finish = (output) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ output: output || null }));
      };
      const timer = setTimeout(() => {
        store.abandon(requestId);
        finish(null);
      }, waitSeconds * 1000);
      res.on('close', () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          store.abandon(requestId);
        }
      });
      finish(await pending);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { createServer };
