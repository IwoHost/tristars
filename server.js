import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as S from './public/shared.js';
import { Room } from './public/room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
// vendor libs are served straight from node_modules (the Pages build copies them into public/vendor instead)
const VENDOR = {
  'three.module.js': 'node_modules/three/build/three.module.js',
  'three.core.js': 'node_modules/three/build/three.core.js',
  'peerjs.min.js': 'node_modules/peerjs/dist/peerjs.min.js',
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  return out;
}

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ lan: true }));
  }
  let file;
  if (url.startsWith('/vendor/') && VENDOR[url.slice(8)]) file = path.join(__dirname, VENDOR[url.slice(8)]);
  else {
    file = path.join(PUBLIC, path.normalize(url));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const room = new Room({ ips: lanIps(), port: PORT });
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  const h = room.connect((s) => { if (ws.readyState === 1) ws.send(s); });
  ws.on('message', (raw) => h.message(String(raw)));
  ws.on('close', h.close);
});
setInterval(() => room.tick(), 1000 / S.TICK);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  ★ TriStars server running!\n');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for (const ip of lanIps()) console.log(`  On phones (same Wi-Fi):  http://${ip}:${PORT}`);
  console.log('');
});
