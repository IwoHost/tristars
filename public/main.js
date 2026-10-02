import * as THREE from 'three';
import * as S from './shared.js';

const $ = (id) => document.getElementById(id);
const BK = Object.keys(S.BRAWLERS);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

let myId = null, lobby = null, joined = false, hello = {};
let selBrawler = S.BRAWLERS[store.get('ts_brawler')] ? store.get('ts_brawler') : 'blaze';
let G = null; // current match state

// ============ networking ============
// net.kind: 'lan' (Node server over WebSocket), 'host' (this browser runs the room), 'peer' (joined a room code)
let net = null;
const send = (o) => { if (net) net.send(JSON.stringify(o)); };
function sendJoin() { send({ t: 'join', name: $('name').value, brawler: selBrawler }); }
const PEER_PREFIX = 'tristars-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Optional own signaling server: ?peer=myhost:9000 (defaults to the free PeerJS cloud)
const PEER_OPTS = (() => {
  const v = new URLSearchParams(location.search).get('peer');
  if (!v) return {};
  const [host, port] = v.split(':');
  return { host, port: Number(port) || 443, path: '/', secure: location.protocol === 'https:' };
})();

function connectLan() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  net = { kind: 'lan', send: (s) => { if (ws.readyState === 1) ws.send(s); } };
  ws.onopen = () => { $('conn').classList.add('hidden'); if (joined) sendJoin(); };
  const mine = net;
  ws.onclose = () => {
    if (net !== mine) return; // switched to a room code game
    $('conn').classList.remove('hidden');
    if (G) teardownGame();
    setTimeout(connectLan, 1500);
  };
  ws.onmessage = (e) => { if (net === mine) onMsg(JSON.parse(e.data)); };
}

let peerLib = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!peerLib) {
    peerLib = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'vendor/peerjs.min.js';
      sc.onload = () => (window.Peer ? res(window.Peer) : rej(new Error('PeerJS failed to load')));
      sc.onerror = () => { peerLib = null; rej(new Error('Could not load PeerJS (are you online?)')); };
      document.head.appendChild(sc);
    });
  }
  return peerLib;
}
const asText = (d) => (typeof d === 'string' ? d : new TextDecoder().decode(d));

async function hostRoom() {
  const Peer = await loadPeer();
  const { Room } = await import('./room.js');
  let peer, code;
  for (let tries = 0; ; tries++) {
    code = Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
    try {
      peer = await new Promise((res, rej) => {
        const p = new Peer(PEER_PREFIX + code, PEER_OPTS);
        p.on('open', () => res(p));
        p.on('error', (e) => { p.destroy(); rej(e); });
      });
      break;
    } catch (e) {
      if (e.type !== 'unavailable-id' || tries > 4) throw new Error('Could not reach the matchmaking server (' + (e.type || e.message) + ')');
    }
  }
  const room = new Room({ code });
  setInterval(() => room.tick(), 1000 / S.TICK);
  peer.on('error', (e) => console.warn('peer error', e.type));
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      const h = room.connect((s) => { if (conn.open) conn.send(s); });
      conn.on('data', (d) => h.message(asText(d)));
      conn.on('close', h.close);
      conn.on('error', h.close);
    });
  });
  // our own player talks to the room directly
  const h = room.connect((s) => queueMicrotask(() => onMsg(JSON.parse(s))));
  net = { kind: 'host', code, send: (s) => h.message(s) };
  keepAwake();
}

async function joinRoom(code) {
  const Peer = await loadPeer();
  const peer = await new Promise((res, rej) => {
    const p = new Peer(PEER_OPTS);
    p.on('open', () => res(p));
    p.on('error', (e) => rej(new Error('Could not reach the matchmaking server (' + e.type + ')')));
  });
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`No room ${code} found`)), 12000);
    peer.on('error', (e) => { if (e.type === 'peer-unavailable') { clearTimeout(timer); rej(new Error(`No room ${code} found — check the code`)); } });
    const conn = peer.connect(PEER_PREFIX + code, { serialization: 'raw', reliable: true });
    conn.on('open', () => {
      clearTimeout(timer);
      net = { kind: 'peer', code, send: (s) => { if (conn.open) conn.send(s); } };
      res();
    });
    conn.on('data', (d) => onMsg(JSON.parse(asText(d))));
    conn.on('close', () => {
      if (!net) return;
      net = null; joined = false;
      if (G) teardownGame();
      peer.destroy();
      showScreen('join');
      $('joinMsg').textContent = '⚠️ Lost connection to the host.';
    });
  });
}

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && net?.kind === 'host') keepAwake(); });

function onMsg(m) {
  switch (m.t) {
    case 'hello': myId = m.id; hello = m; break;
    case 'lobby':
      lobby = m;
      if (G && (!m.inGame || G.endShown)) {
        if (!m.inGame) { teardownGame(); showScreen('lobby'); }
      } else if (!G && joined) showScreen('lobby');
      renderLobby();
      break;
    case 'gstart': startGame(m); break;
    case 'roster': if (G) syncRoster(m.roster); break;
    case 's': if (G) onSnap(m); break;
    case 'end': if (G) showEnd(m); break;
  }
}

// ============ screens / lobby UI ============
function showScreen(name) {
  for (const id of ['join', 'lobby', 'end']) $(id).classList.toggle('hidden', id !== name);
  $('hud').classList.toggle('hidden', name !== 'game' && name !== 'end');
}

function brawlerGrid(el, current, onPick) {
  el.innerHTML = '';
  for (const k of BK) {
    const b = S.BRAWLERS[k];
    const d = document.createElement('div');
    d.className = 'card' + (k === current ? ' sel' : '');
    d.innerHTML = `<div class="ic">${b.icon}</div><div class="nm">${b.name}</div><div class="rl">${b.role} · ❤️${b.hp}</div><div class="ds">${b.desc}</div>`;
    d.onclick = () => onPick(k);
    el.appendChild(d);
  }
}

function renderJoin() {
  brawlerGrid($('joinGrid'), selBrawler, (k) => { selBrawler = k; store.set('ts_brawler', k); renderJoin(); });
}

function renderLobby() {
  if (!lobby) return;
  const me = lobby.players.find((p) => p.id === myId);
  const isHost = lobby.hostId === myId;
  if (me) selBrawler = me.brawler;
  const mode = lobby.settings.mode;
  const modes = $('modes');
  modes.innerHTML = '';
  for (const [k, md] of Object.entries(S.MODES)) {
    const d = document.createElement('div');
    d.className = 'mode' + (k === mode ? ' sel' : '') + (isHost ? '' : ' locked');
    d.innerHTML = `<div class="ic">${md.icon}</div>${md.name}`;
    d.title = md.desc;
    if (isHost) d.onclick = () => send({ t: 'settings', mode: k });
    modes.appendChild(d);
  }
  $('bots').checked = lobby.settings.bots;
  $('bots').disabled = !isHost;
  const teams = $('teams');
  teams.innerHTML = '';
  const line = (p) => `<div class="pl">${p.id === lobby.hostId ? '👑' : ''}${S.BRAWLERS[p.brawler].icon} ${esc(p.name)}${p.id === myId ? ' (you)' : ''}</div>`;
  if (mode === 'showdown') {
    teams.innerHTML = `<div class="team ffa"><h3>Players</h3>${lobby.players.map(line).join('')}</div>`;
  } else {
    for (const tm of [0, 1]) {
      const d = document.createElement('div');
      d.className = 'team t' + tm;
      d.innerHTML = `<h3>${tm === 0 ? '🔵 Blue' : '🔴 Red'} team${me && me.team !== tm ? ' — tap to join' : ''}</h3>` +
        lobby.players.filter((p) => p.team === tm).map(line).join('');
      d.onclick = () => send({ t: 'team', team: tm });
      teams.appendChild(d);
    }
  }
  brawlerGrid($('lobbyGrid'), selBrawler, (k) => { selBrawler = k; store.set('ts_brawler', k); send({ t: 'pick', brawler: k }); });
  $('startBtn').classList.toggle('hidden', !isHost);
  $('startBtn').disabled = lobby.inGame;
  $('waitMsg').textContent = lobby.inGame
    ? 'A match is running — you will play in the next one!'
    : isHost ? `${S.MODES[mode].desc}` : 'Waiting for the host to start… 👑';
  if (hello.code) {
    const q = new URLSearchParams(location.search); q.set('room', hello.code);
    const link = `${location.origin}${location.pathname}?${q}`;
    $('joinUrl').innerHTML = `Room code: <b class="code">${hello.code}</b><br><span class="link">${esc(link)}</span>` +
      (net?.kind === 'host' ? '<br>📱 You are hosting — keep this screen on!' : '');
  } else {
    const ips = hello.ips?.length ? hello.ips.map((ip) => `${ip}:${hello.port}`) : [location.host];
    $('joinUrl').innerHTML = `Friends join on the same Wi-Fi at:<br><b>${ips.map((u) => 'http://' + u).join('<br>')}</b>`;
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('name').value = store.get('ts_name') || '';
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('code').value = urlRoom.toUpperCase().slice(0, 4);
function prepJoin() {
  if (!$('name').value.trim()) $('name').value = 'Brawler' + ((Math.random() * 100) | 0);
  store.set('ts_name', $('name').value);
  initAudio();
  goFullscreen();
}
function enterLobby() {
  joined = true;
  $('joinMsg').textContent = '';
  sendJoin();
  showScreen('lobby');
}
let busy = false;
async function withBusy(label, fn) {
  if (busy) return;
  busy = true;
  for (const b of ['hostBtn', 'codeBtn', 'lanBtn']) $(b).disabled = true;
  $('joinMsg').textContent = label;
  try { await fn(); enterLobby(); }
  catch (e) { $('joinMsg').textContent = '⚠️ ' + e.message; net = null; }
  busy = false;
  for (const b of ['hostBtn', 'codeBtn', 'lanBtn']) $(b).disabled = false;
}
$('lanBtn').onclick = () => { prepJoin(); joined = true; if (net?.kind === 'lan') enterLobby(); };
$('hostBtn').onclick = () => { prepJoin(); withBusy('Creating room…', hostRoom); };
$('codeBtn').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) { $('joinMsg').textContent = 'Type the 4-letter room code from the host.'; return; }
  prepJoin();
  withBusy(`Joining room ${code}…`, () => joinRoom(code));
};
$('code').oninput = () => { $('code').value = $('code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
$('leaveBtn').onclick = () => { const q = new URLSearchParams(location.search); q.delete('room'); location.href = location.pathname + (q.size ? '?' + q : ''); };
// If we were served by the Node LAN server, offer it too.
fetch('api/info').then((r) => r.json()).then((info) => {
  if (!info.lan) return;
  $('lanBtn').classList.remove('hidden');
  connectLan();
}).catch(() => {});
$('startBtn').onclick = () => { initAudio(); send({ t: 'start' }); };
$('bots').onchange = () => send({ t: 'settings', bots: $('bots').checked });
$('fsBtn').onpointerdown = (e) => { e.stopPropagation(); goFullscreen(); };
function goFullscreen() {
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    p?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } catch {}
}
renderJoin();
showScreen('join');

// ============ audio ============
let ac = null, noiseBuf = null;
function initAudio() {
  if (ac) { ac.resume?.(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ac = null; }
}
function tone(f0, f1, dur, type, vol) {
  if (!ac || vol <= 0.003) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
}
function noise(dur, vol, freq) {
  if (!ac || vol <= 0.003) return;
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(ac.destination); s.start(t); s.stop(t + dur);
}
function volAt(x, z) {
  if (!G) return 0;
  return clamp(1 - Math.hypot(x - G.me.x, z - G.me.z) / 15, 0, 1);
}
const sfx = {
  shot: (v = 1) => tone(620, 200, 0.07, 'square', 0.045 * v),
  hit: (v = 1) => noise(0.08, 0.18 * v, 1800),
  boom: (v = 1) => { noise(0.4, 0.35 * v, 500); tone(120, 40, 0.3, 'sine', 0.25 * v); },
  pick: () => tone(900, 1700, 0.12, 'sine', 0.12),
  die: (v = 1) => tone(500, 60, 0.45, 'sawtooth', 0.09 * v),
  super: (v = 1) => tone(260, 1000, 0.3, 'triangle', 0.16 * v),
  hurt: () => tone(220, 90, 0.12, 'square', 0.08),
  empty: () => tone(160, 150, 0.06, 'square', 0.05),
  ready: () => { tone(700, 700, 0.08, 'triangle', 0.1); setTimeout(() => tone(1050, 1050, 0.15, 'triangle', 0.1), 90); },
  brk: (v = 1) => noise(0.2, 0.2 * v, 900),
};

// ============ three.js setup ============
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d5c7a);
const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 200);
camera.position.set(10, 20, 20);
camera.lookAt(10, 0, 10);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6a7a90, 1.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(4, 10, 6);
scene.add(sun);
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sph: new THREE.SphereGeometry(1, 12, 9),
  sphLo: new THREE.SphereGeometry(1, 8, 6),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  cone: new THREE.ConeGeometry(1, 1, 8),
  bush: new THREE.IcosahedronGeometry(0.62, 1),
  ring: new THREE.RingGeometry(0.46, 0.58, 28).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
  gem: new THREE.OctahedronGeometry(0.24),
};
const matCache = new Map();
function basicMat(color, opacity = 1) {
  const k = color + ':' + opacity;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
  return matCache.get(k);
}
function lambert(color) {
  const k = 'L' + color;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(k);
}

// ============ brawler models ============
const SKIN = 0xffd2a6;
function makeModel(key) {
  const g = new THREE.Group();
  const mats = [];
  const add = (gm, color, sx, sy, sz, x, y, z, parent = g) => {
    const m = new THREE.MeshLambertMaterial({ color, transparent: true });
    mats.push(m);
    const mesh = new THREE.Mesh(gm, m);
    mesh.scale.set(sx, sy, sz); mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const eyes = (y = 1.08, z = 0.25, sp = 0.1) => { add(geo.sph, 0x111111, 0.05, 0.065, 0.05, sp, y, z); add(geo.sph, 0x111111, 0.05, 0.065, 0.05, -sp, y, z); };
  const col = S.BRAWLERS[key].color;
  switch (key) {
    case 'blaze':
      add(geo.cyl, 0x2f5d9e, 0.26, 0.42, 0.26, 0, 0.22, 0);
      add(geo.cyl, col, 0.33, 0.42, 0.3, 0, 0.62, 0);
      add(geo.sph, SKIN, 0.28, 0.28, 0.28, 0, 1.05, 0);
      add(geo.cyl, 0x7a4a22, 0.52, 0.04, 0.52, 0, 1.24, 0);
      add(geo.cyl, 0x7a4a22, 0.23, 0.24, 0.23, 0, 1.36, 0);
      add(geo.box, 0x333333, 0.09, 0.11, 0.45, 0.32, 0.66, 0.22);
      add(geo.box, 0x333333, 0.09, 0.11, 0.45, -0.32, 0.66, 0.22);
      eyes();
      break;
    case 'bruno':
      add(geo.cyl, 0x2b2b2b, 0.27, 0.42, 0.27, 0, 0.22, 0);
      add(geo.cyl, col, 0.36, 0.44, 0.32, 0, 0.64, 0);
      add(geo.sph, SKIN, 0.28, 0.28, 0.28, 0, 1.07, 0);
      add(geo.cone, 0x5a1f86, 0.3, 0.35, 0.3, 0, 1.38, -0.03);
      add(geo.box, 0xd84a7a, 0.6, 0.07, 0.07, 0, 1.17, 0.2);
      add(geo.box, 0x555555, 0.13, 0.13, 0.75, 0.28, 0.66, 0.32);
      add(geo.box, 0x8a5a2b, 0.14, 0.16, 0.25, 0.28, 0.62, -0.05);
      eyes(1.07);
      break;
    case 'pip':
      add(geo.cyl, 0x5b4636, 0.24, 0.36, 0.24, 0, 0.19, 0);
      add(geo.cyl, 0x8b5a2b, 0.3, 0.36, 0.28, 0, 0.53, 0);
      add(geo.sph, SKIN, 0.3, 0.3, 0.3, 0, 0.95, 0);
      add(geo.sph, col, 0.32, 0.2, 0.32, 0, 1.08, 0);
      add(geo.cyl, 0xffffcc, 0.08, 0.05, 0.08, 0, 1.15, 0.29).rotation.x = Math.PI / 2;
      add(geo.box, 0xeeeeee, 0.4, 0.12, 0.08, 0, 0.83, 0.25);
      add(geo.sph, 0x222222, 0.17, 0.17, 0.17, 0.32, 0.6, 0.18);
      eyes(0.98, 0.27);
      break;
    case 'tank':
      add(geo.cyl, 0xe8d24a, 0.36, 0.38, 0.33, 0, 0.2, 0);
      add(geo.cyl, SKIN, 0.48, 0.5, 0.4, 0, 0.64, 0);
      add(geo.box, 0xe8d24a, 0.9, 0.12, 0.5, 0, 0.45, 0);
      add(geo.sph, col, 0.3, 0.3, 0.3, 0, 1.12, 0.02);
      add(geo.box, 0xe23b3b, 0.07, 0.2, 0.62, 0, 1.25, 0);
      add(geo.sph, 0xe23b3b, 0.18, 0.18, 0.18, 0.5, 0.7, 0.2);
      add(geo.sph, 0xe23b3b, 0.18, 0.18, 0.18, -0.5, 0.7, 0.2);
      add(geo.sph, 0xffffff, 0.07, 0.05, 0.04, 0.11, 1.15, 0.28);
      add(geo.sph, 0xffffff, 0.07, 0.05, 0.04, -0.11, 1.15, 0.28);
      break;
    case 'cactus':
      add(geo.cyl, col, 0.32, 0.9, 0.32, 0, 0.45, 0);
      add(geo.sph, col, 0.32, 0.3, 0.32, 0, 0.92, 0);
      add(geo.cyl, col, 0.11, 0.35, 0.11, 0.42, 0.65, 0);
      add(geo.cyl, col, 0.11, 0.35, 0.11, -0.42, 0.75, 0);
      add(geo.box, col, 0.3, 0.1, 0.1, 0.28, 0.5, 0);
      add(geo.box, col, 0.3, 0.1, 0.1, -0.28, 0.6, 0);
      add(geo.sph, 0xff6fb5, 0.12, 0.08, 0.12, 0.08, 1.22, 0);
      add(geo.sph, 0xffe14d, 0.05, 0.05, 0.05, 0.08, 1.27, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(geo.cone, 0xfff7c2, 0.03, 0.12, 0.03, Math.sin(a) * 0.33, 0.35 + (i % 3) * 0.2, Math.cos(a) * 0.33).rotation.set(Math.cos(a) * 1.5, 0, -Math.sin(a) * 1.5);
      }
      eyes(0.95, 0.3);
      add(geo.box, 0x222222, 0.14, 0.03, 0.02, 0, 0.84, 0.31);
      break;
    case 'melody':
      add(geo.cyl, 0x2b2b2b, 0.25, 0.4, 0.25, 0, 0.21, 0);
      add(geo.cyl, col, 0.33, 0.44, 0.3, 0, 0.62, 0);
      add(geo.sph, 0xf3f0e8, 0.28, 0.28, 0.28, 0, 1.05, 0);
      add(geo.cyl, 0xd03a5a, 0.62, 0.04, 0.62, 0, 1.23, 0);
      add(geo.cone, 0xd03a5a, 0.24, 0.3, 0.24, 0, 1.38, 0);
      add(geo.sph, 0xa4643a, 0.26, 0.3, 0.08, 0.1, 0.62, 0.3);
      add(geo.box, 0x5a3a1a, 0.06, 0.06, 0.5, 0.25, 0.8, 0.3).rotation.x = -0.6;
      add(geo.sph, 0xff4f9a, 0.07, 0.07, 0.05, 0.1, 1.08, 0.24);
      add(geo.sph, 0xff4f9a, 0.07, 0.07, 0.05, -0.1, 1.08, 0.24);
      break;
  }
  g.userData.mats = mats;
  return g;
}

// ============ match setup ============
function relColor(team) {
  if (!G) return 0xff3b3b;
  return team === G.myTeam ? 0x3a8dff : 0xff3b3b;
}

function startGame(m) {
  if (G) teardownGame();
  const rows = m.rows;
  const map = { w: rows[0].length, h: rows.length, t: rows.join('').split(''), spawns: m.spawns, mine: m.mine };
  const meR = m.roster.find((r) => r.id === m.you);
  G = {
    mode: m.mode, map, myTeam: meR ? meR.team : -1, flip: m.mode !== 'showdown' && meR && meR.team === 1,
    pv: new Map(), snaps: [], items: new Map(), projs: new Map(), lobs: new Map(), fields: new Map(),
    parts: [], booms: [], me: { init: false, x: 0, z: 0, a: 0, tp: -1, alive: true, hp: 1, maxHp: 1, ammo: 3, superC: 0, gems: 0, respawn: 0, forced: false, slowed: false, inBush: false },
    sc: null, world: new THREE.Group(), tiles: null, tilesDirty: true, camT: null, lastPos: 0, spectate: null, superWasReady: false,
    endShown: false, gas: null, lastScoreHtml: '',
  };
  scene.add(G.world);
  buildWorld();
  syncRoster(m.roster);
  showScreen('game');
}

function teardownGame() {
  if (!G) return;
  scene.remove(G.world);
  G.world.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  for (const pv of G.pv.values()) { pv.label.remove(); pv.model.userData.mats.forEach((m) => m.dispose()); }
  $('labels').innerHTML = '';
  $('center').innerHTML = '';
  $('score').innerHTML = '';
  G = null;
  ptr.move = ptr.atk = ptr.sup = null;
  $('joyBase').classList.add('hidden');
}

function buildWorld() {
  const { w, h } = G.map;
  const sd = G.mode === 'showdown';
  // ground checkerboard
  const cv = document.createElement('canvas');
  cv.width = w * 8; cv.height = h * 8;
  const cx = cv.getContext('2d');
  const c1 = sd ? '#7cc36a' : '#e8c27a', c2 = sd ? '#72b862' : '#ddb46c';
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { cx.fillStyle = (r + c) % 2 ? c1 : c2; cx.fillRect(c * 8, r * 8, 8, 8); }
  if (!sd) {
    for (const [tm, list] of G.map.spawns.entries()) {
      cx.fillStyle = relColor(tm) === 0x3a8dff ? 'rgba(60,140,255,.35)' : 'rgba(255,60,60,.3)';
      for (const [x, z] of list) cx.fillRect((x - 1.5) * 8, (z - 1) * 8, 24, 16);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(w / 2, 0, h / 2);
  G.world.add(ground);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(w + 60, h + 60), lambert(sd ? 0x3d7a3a : 0x9a7444));
  under.rotation.x = -Math.PI / 2; under.position.set(w / 2, -0.6, h / 2);
  G.world.add(under);
  // border fence
  const fenceMat = lambert(sd ? 0x2f5e2e : 0x8a5a33);
  const mk = (sx, sz, x, z) => { const m = new THREE.Mesh(geo.box, fenceMat); m.scale.set(sx, 0.8, sz); m.position.set(x, 0.1, z); G.world.add(m); };
  mk(w + 2, 1, w / 2, -0.5); mk(w + 2, 1, w / 2, h + 0.5); mk(1, h, -0.5, h / 2); mk(1, h, w + 0.5, h / 2);
  if (G.map.mine) {
    const mine = new THREE.Mesh(geo.disc, basicMat(0x4a2a5a, 0.8));
    mine.scale.setScalar(1.1); mine.position.set(G.map.mine[0], 0.02, G.map.mine[1]);
    G.world.add(mine);
    const crys = new THREE.Mesh(geo.gem, lambert(0xb64dff));
    crys.scale.setScalar(1.6); crys.position.set(G.map.mine[0], 0.4, G.map.mine[1]);
    G.world.add(crys); G.mineCrystal = crys;
  }
  if (sd) {
    G.gas = [];
    const gm = new THREE.MeshBasicMaterial({ color: 0x3cff6a, transparent: true, opacity: 0.32, depthWrite: false });
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(geo.box, gm); m.visible = false; G.world.add(m); G.gas.push(m); }
  }
  // aim indicators
  G.aim = makeAim();
  G.world.add(G.aim.group);
}

function buildTiles() {
  if (G.tiles) { G.world.remove(G.tiles); G.tiles.traverse((o) => { if (o.isInstancedMesh) o.dispose(); }); }
  const { w, h, t } = G.map;
  const sd = G.mode === 'showdown';
  const lists = { '#': [], B: [], W: [], X: [] };
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const ch = t[r * w + c]; if (lists[ch]) lists[ch].push([c, r]); }
  const grp = new THREE.Group();
  const tmp = new THREE.Object3D(), col = new THREE.Color();
  const inst = (list, gm, mat, place, baseColor, vary) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(gm, mat, list.length);
    list.forEach(([c, r], i) => {
      place(tmp, c, r); tmp.updateMatrix(); im.setMatrixAt(i, tmp.matrix);
      const n = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453; const f = 1 + ((n - Math.floor(n)) - 0.5) * vary;
      col.setHex(baseColor).multiplyScalar(f); im.setColorAt(i, col);
    });
    grp.add(im);
    return im;
  };
  inst(lists['#'], geo.box, new THREE.MeshLambertMaterial({ color: 0xffffff }), (o, c, r) => { o.position.set(c + 0.5, 0.55, r + 0.5); o.scale.set(1, 1.1, 1); o.rotation.set(0, 0, 0); }, sd ? 0x8d8f99 : 0xc9874a, 0.18);
  G.bushMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  inst(lists.B, geo.bush, G.bushMat, (o, c, r) => { o.position.set(c + 0.5, 0.42, r + 0.5); o.scale.set(1, 0.8, 1); o.rotation.set(0, c * 1.7 + r, 0); }, 0x3fa34d, 0.25);
  inst(lists.W, geo.box, new THREE.MeshLambertMaterial({ color: 0xffffff }), (o, c, r) => { o.position.set(c + 0.5, 0.02, r + 0.5); o.scale.set(1, 0.06, 1); o.rotation.set(0, 0, 0); }, 0x3aa0e0, 0.08);
  inst(lists.X, geo.box, new THREE.MeshLambertMaterial({ color: 0xffffff }), (o, c, r) => { o.position.set(c + 0.5, 0.45, r + 0.5); o.scale.set(0.88, 0.9, 0.88); o.rotation.set(0, 0, 0); }, 0xa8743d, 0.1);
  for (const [c, r] of lists.X) {
    const cube = new THREE.Mesh(geo.box, basicMat(0x5dff7a));
    cube.scale.setScalar(0.3); cube.position.set(c + 0.5, 0.95, r + 0.5); cube.rotation.set(0.6, 0.6, 0);
    grp.add(cube);
  }
  G.tiles = grp;
  G.world.add(grp);
  G.tilesDirty = false;
}

function syncRoster(roster) {
  const ids = new Set(roster.map((r) => r.id));
  for (const [id, pv] of G.pv) if (!ids.has(id)) { G.world.remove(pv.root); pv.label.remove(); G.pv.delete(id); }
  for (const r of roster) {
    if (G.pv.has(r.id)) continue;
    const root = new THREE.Group();
    const shadow = new THREE.Mesh(geo.disc, basicMat(0x000000, 0.28));
    shadow.scale.setScalar(0.45); shadow.position.y = 0.015;
    const isMe = r.id === myId;
    const ringColor = isMe ? 0x4cff6a : relColor(r.team);
    const ring = new THREE.Mesh(geo.ring, basicMat(ringColor, 0.85));
    ring.position.y = 0.03;
    const model = makeModel(r.brawler);
    root.add(shadow, ring, model);
    root.visible = false;
    G.world.add(root);
    const label = document.createElement('div');
    label.className = 'plabel';
    const nameColor = isMe ? '#9dff9d' : r.team === G.myTeam ? '#9cc9ff' : '#ff9c9c';
    label.innerHTML = `<div class="gem"></div><div class="n" style="color:${nameColor}">${esc(r.name)}</div><div class="hpt"></div><div class="hpbar"><i></i></div>` +
      (isMe ? '<div class="ammo"><b><i></i></b><b><i></i></b><b><i></i></b></div>' : '');
    label.style.display = 'none';
    $('labels').appendChild(label);
    const hpFill = label.querySelector('.hpbar i');
    hpFill.style.background = isMe ? '#56e05a' : r.team === G.myTeam ? '#3a8dff' : '#ff4a4a';
    G.pv.set(r.id, {
      ...r, root, model, label, hpFill, hpt: label.querySelector('.hpt'), gemEl: label.querySelector('.gem'),
      ammoEls: [...label.querySelectorAll('.ammo i')], x: 0, z: 0, a: 0, px: 0, pz: 0, phase: 0, recoil: 0, flash: 0, last: null, lastTxt: '',
    });
    if (isMe) G.myBrawler = r.brawler;
  }
}

// ============ snapshots ============
function onSnap(m) {
  const now = performance.now();
  const pm = new Map();
  for (const e of m.p) pm.set(e[0], e);
  G.snaps.push({ time: now, pm });
  if (G.snaps.length > 15) G.snaps.shift();
  G.sc = m.sc;
  const me = G.me, e = pm.get(myId);
  if (e) {
    if (!me.init || e[10] !== me.tp) { me.x = e[1]; me.z = e[2]; me.tp = e[10]; me.init = true; if (!G.camT) G.camT = { x: e[1], z: e[2] }; }
    me.forced = !!(e[6] & 4);
    if (me.forced) { me.sx = e[1]; me.sz = e[2]; }
    const wasAlive = me.alive;
    me.alive = !!(e[6] & 1); me.inBush = !!(e[6] & 2); me.slowed = !!(e[6] & 8);
    me.hp = e[4]; me.maxHp = e[5]; me.gems = e[7]; me.ammo = e[8]; me.superC = e[9]; me.respawn = e[11];
    if (me.alive && !wasAlive) { me.x = e[1]; me.z = e[2]; G.spectate = null; }
  }
  if (m.tc.length) { for (const [c, r, ch] of m.tc) G.map.t[r * G.map.w + c] = ch; G.tilesDirty = true; }
  for (const f of m.fx) handleFx(f);
  // items
  const seen = new Set();
  for (const [id, type, x, z] of m.it) {
    seen.add(id);
    let it = G.items.get(id);
    if (!it) {
      const mesh = type === 'gem' ? new THREE.Mesh(geo.gem, lambert(0xc061ff)) : new THREE.Mesh(geo.box, basicMat(0x5dff7a));
      if (type !== 'gem') mesh.scale.setScalar(0.32);
      G.world.add(mesh);
      it = { mesh, x, z, born: now };
      G.items.set(id, it);
    }
    it.x = x; it.z = z;
  }
  for (const [id, it] of G.items) if (!seen.has(id)) { G.world.remove(it.mesh); G.items.delete(id); }
  syncProjs(m, now);
  // fields
  const fs = new Set();
  for (const [id, x, z, r, team] of m.fd) {
    fs.add(id);
    if (!G.fields.has(id)) {
      const mesh = new THREE.Mesh(geo.disc, new THREE.MeshBasicMaterial({ color: team === G.myTeam ? 0x7fd0ff : 0x9cff5a, transparent: true, opacity: 0.35, depthWrite: false }));
      mesh.scale.setScalar(r); mesh.position.set(x, 0.04, z);
      G.world.add(mesh);
      G.fields.set(id, mesh);
    }
  }
  for (const [id, mesh] of G.fields) if (!fs.has(id)) { G.world.remove(mesh); mesh.material.dispose(); G.fields.delete(id); }
}

const PROJ_LOOK = {
  blaze: [0xffd36b, 0.13], blazeS: [0xfff07a, 0.19], bruno: [0xff8bd8, 0.14], brunoS: [0xff4fd2, 0.2],
  tank: [0x9cc6ff, 0.2], cactus: [0x8ef56b, 0.22], spike: [0xe8ffb0, 0.09], melody: [0xff8fb1, 0.3],
  pip: [0x222222, 0.2], pipS: [0x7a4a22, 0.36], cactusS: [0x6fd64a, 0.3],
};
function projMesh(kind) {
  const [color, size] = PROJ_LOOK[kind] || [0xffffff, 0.15];
  const mesh = new THREE.Mesh(geo.sphLo, basicMat(color, kind === 'melody' ? 0.7 : 1));
  if (kind === 'melody') mesh.scale.set(1.0, 0.18, 0.3); else mesh.scale.setScalar(size);
  mesh.userData.size = size;
  return mesh;
}
function syncProjs(m, now) {
  const seen = new Set();
  for (const [id, kind, x, z, vx, vz, owner] of m.pr) {
    seen.add(id);
    let p = G.projs.get(id);
    if (!p) {
      p = { mesh: projMesh(kind), kind, owner };
      if (kind !== 'melody') p.mesh.scale.z *= 1.8;
      G.world.add(p.mesh);
      G.projs.set(id, p);
    }
    Object.assign(p, { x, z, vx, vz, recv: now });
  }
  for (const [id, p] of G.projs) if (!seen.has(id)) { G.world.remove(p.mesh); G.projs.delete(id); }
  const ls = new Set();
  for (const [id, kind, sx, sz, tx, tz, t, dur, owner] of m.lb) {
    ls.add(id);
    let l = G.lobs.get(id);
    if (!l) {
      l = { mesh: projMesh(kind), owner };
      G.world.add(l.mesh);
      const sh = new THREE.Mesh(geo.disc, basicMat(0x000000, 0.25));
      sh.scale.setScalar(0.25); l.shadow = sh; G.world.add(sh);
      G.lobs.set(id, l);
    }
    Object.assign(l, { sx, sz, tx, tz, t, dur, recv: now });
  }
  for (const [id, l] of G.lobs) if (!ls.has(id)) { G.world.remove(l.mesh); G.world.remove(l.shadow); G.lobs.delete(id); }
}

// ============ effects ============
const dmgLayer = () => $('labels');
const _v = new THREE.Vector3();
function toScreen(x, y, z) {
  _v.set(x, y, z).project(camera);
  return [(_v.x * 0.5 + 0.5) * window.innerWidth, (-_v.y * 0.5 + 0.5) * window.innerHeight, _v.z < 1];
}
function floatText(x, z, text, cls) {
  const [sx, sy, ok] = toScreen(x, 1.6, z);
  if (!ok) return;
  if (dmgLayer().childElementCount > 80) return;
  const d = document.createElement('div');
  d.className = 'dmg ' + (cls || '');
  d.textContent = text;
  d.style.left = sx + (Math.random() - 0.5) * 20 + 'px';
  d.style.top = sy + 'px';
  dmgLayer().appendChild(d);
  setTimeout(() => d.remove(), 800);
}
function burst(x, y, z, color, n, speed = 4, size = 0.12) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo.box, basicMat(color));
    m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
    m.position.set(x, y, z);
    G.world.add(m);
    const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
    G.parts.push({ m, vx: Math.cos(a) * s, vy: 2 + Math.random() * 4, vz: Math.sin(a) * s, life: 0.6 + Math.random() * 0.4 });
  }
}
function boom(x, z, r, color = 0xffa030) {
  const m = new THREE.Mesh(geo.sphLo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }));
  m.position.set(x, 0.3, z);
  G.world.add(m);
  G.booms.push({ m, r, t: 0, dur: 0.35 });
}
function handleFx(f) {
  const type = f[0];
  if (type === 'hit') {
    const [, x, z, amt, id] = f;
    const pv = G.pv.get(id);
    if (pv) pv.flash = 0.15;
    if (id === myId) { floatText(x, z, '-' + amt, 'me'); sfx.hurt(); navigator.vibrate?.(25); }
    else if (pv && pv.root.visible) { floatText(x, z, amt, ''); sfx.hit(volAt(x, z) * 0.7); }
  } else if (type === 'boom') {
    const [, x, z, r] = f;
    boom(x, z, r);
    burst(x, 0.3, z, 0xffc040, 6, 3);
    sfx.boom(volAt(x, z));
  } else if (type === 'die') {
    const [, x, z, id, killer] = f;
    const pv = G.pv.get(id);
    burst(x, 0.6, z, pv ? S.BRAWLERS[pv.brawler].color : 0xffffff, 14, 4, 0.16);
    sfx.die(volAt(x, z));
    if (id === myId) { G.spectate = killer || null; navigator.vibrate?.([60, 40, 60]); }
  } else if (type === 'heal') {
    const [, x, z, amt, id] = f;
    boom(x, z, 1.2, 0x5dff7a);
    if (amt > 0) floatText(x, z, '+' + amt, 'heal');
    if (id === myId) sfx.pick();
  } else if (type === 'brk') {
    const [, x, z, ch] = f;
    burst(x, 0.5, z, ch === 'B' ? 0x3fa34d : ch === 'X' ? 0xa8743d : G.mode === 'showdown' ? 0x8d8f99 : 0xc9874a, 7, 3, 0.2);
    sfx.brk(volAt(x, z) * 0.8);
  } else if (type === 'bx') {
    const [, x, z] = f;
    burst(x, 0.8, z, 0xa8743d, 2, 2, 0.1);
  } else if (type === 'pick') {
    if (f[1] === myId) sfx.pick();
  } else if (type === 'shot') {
    const pv = G.pv.get(f[1]);
    if (pv) { pv.recoil = 1; if (f[1] !== myId) sfx.shot(volAt(pv.x, pv.z) * 0.6); }
  } else if (type === 'super') {
    const pv = G.pv.get(f[1]);
    if (pv) { boom(pv.x, pv.z, 1.0, 0xffe14d); sfx.super(volAt(pv.x, pv.z)); }
  } else if (type === 'gem') {
    burst(f[1], 0.5, f[2], 0xc061ff, 5, 2, 0.1);
  }
}

// ============ aim indicators ============
function makeAim() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5), mat);
  const cone = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  const circle = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), mat);
  const fill = new THREE.Mesh(geo.disc, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15, depthWrite: false }));
  const pivot = new THREE.Group();
  pivot.add(line, cone);
  group.add(pivot, circle, fill);
  group.position.y = 0.05;
  group.visible = false;
  return { group, pivot, line, cone, circle, fill, mat, coneKey: '' };
}
function showAim(isSuper, wx, wz, len) {
  const A = G.aim, b = S.BRAWLERS[G.myBrawler];
  const spec = isSuper ? b.super : b.attack;
  const range = spec.range || b.attack.range;
  A.group.visible = true;
  A.group.position.set(G.me.x, 0.05, G.me.z);
  A.mat.color.setHex(isSuper ? 0xffd23f : 0xffffff);
  A.fill.material.color.setHex(isSuper ? 0xffd23f : 0xffffff);
  A.mat.opacity = isSuper ? 0.45 : 0.3;
  A.pivot.rotation.y = Math.atan2(wx, wz);
  A.line.visible = A.cone.visible = A.circle.visible = A.fill.visible = false;
  if (spec.type === 'burst' || spec.type === 'split' || spec.type === 'wave') {
    A.line.visible = true;
    A.line.scale.set(Math.max(0.35, (spec.r || 0.2) * 2.2), 1, range);
  } else if (spec.type === 'spread') {
    const key = range + ':' + spec.arc;
    if (A.coneKey !== key) {
      A.cone.geometry.dispose();
      A.cone.geometry = new THREE.CircleGeometry(range, 24, -Math.PI / 2 - spec.arc / 2 - 0.05, spec.arc + 0.1).rotateX(-Math.PI / 2);
      A.coneKey = key;
    }
    A.cone.visible = true;
  } else if (spec.type === 'lob' || spec.type === 'leap') {
    const d = clamp(len, 0.12, 1) * range;
    A.circle.visible = A.fill.visible = true;
    A.circle.position.set(wx / (Math.hypot(wx, wz) || 1) * d, 0, wz / (Math.hypot(wx, wz) || 1) * d);
    A.fill.position.copy(A.circle.position);
    A.circle.scale.setScalar(spec.splash); A.fill.scale.setScalar(spec.splash);
    A.line.visible = true;
    A.line.scale.set(0.12, 1, d);
  } else if (spec.type === 'heal') {
    A.circle.visible = A.fill.visible = true;
    A.circle.position.set(0, 0, 0); A.fill.position.set(0, 0, 0);
    A.circle.scale.setScalar(spec.range); A.fill.scale.setScalar(spec.range);
  }
}

// ============ input ============
const ptr = { move: null, atk: null, sup: null };
const keys = new Set();
let mouse = { x: 0, y: 0, active: 0, world: null };
const joyR = () => Math.min(window.innerWidth, window.innerHeight) * 0.13;
function btnInfo(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; }
const inGameInput = () => G && !G.endShown && !$('hud').classList.contains('hidden');

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('pointerdown', (e) => {
  initAudio();
  if (!inGameInput()) return;
  if (e.pointerType === 'mouse') {
    mouse.active = performance.now();
    if (e.button === 0) fireAtMouse(false);
    else if (e.button === 2) fireAtMouse(true);
    return;
  }
  const p = { id: e.pointerId, x: e.clientX, y: e.clientY };
  const ab = btnInfo($('atkBtn')), sb = btnInfo($('superBtn'));
  const dA = Math.hypot(e.clientX - ab.x, e.clientY - ab.y), dS = Math.hypot(e.clientX - sb.x, e.clientY - sb.y);
  if (!ptr.sup && dS < sb.r * 1.25 && dS < dA) ptr.sup = { ...p, cx: sb.x, cy: sb.y };
  else if (!ptr.atk && dA < ab.r * 1.35) ptr.atk = { ...p, cx: ab.x, cy: ab.y };
  else if (!ptr.move && e.clientX < window.innerWidth * 0.5) {
    ptr.move = { ...p, cx: e.clientX, cy: e.clientY };
    const jb = $('joyBase');
    jb.classList.remove('hidden');
    jb.style.left = e.clientX + 'px'; jb.style.top = e.clientY + 'px';
    $('joyKnob').style.transform = '';
  } else if (!ptr.atk) ptr.atk = { ...p, cx: e.clientX, cy: e.clientY, free: true };
  updateBtnStates();
}, { passive: true });
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = performance.now(); return; }
  for (const k of ['move', 'atk', 'sup']) {
    const p = ptr[k];
    if (p && p.id === e.pointerId) { p.x = e.clientX; p.y = e.clientY; }
  }
  if (ptr.move) {
    let dx = ptr.move.x - ptr.move.cx, dy = ptr.move.y - ptr.move.cy;
    const l = Math.hypot(dx, dy), R = joyR();
    if (l > R) {
      // drag the joystick base along so it never feels stuck
      ptr.move.cx += (dx / l) * (l - R); ptr.move.cy += (dy / l) * (l - R);
      $('joyBase').style.left = ptr.move.cx + 'px'; $('joyBase').style.top = ptr.move.cy + 'px';
      dx = (dx / l) * R; dy = (dy / l) * R;
    }
    $('joyKnob').style.transform = `translate(${dx}px, ${dy}px)`;
  }
}, { passive: true });
function pointerEnd(e) {
  if (ptr.move && ptr.move.id === e.pointerId) { ptr.move = null; $('joyBase').classList.add('hidden'); }
  for (const k of ['atk', 'sup']) {
    const p = ptr[k];
    if (!p || p.id !== e.pointerId) continue;
    ptr[k] = null;
    if (e.type === 'pointercancel' || !G) continue;
    const R = joyR();
    const sx = (p.x - p.cx) / R, sy = (p.y - p.cy) / R;
    const len = Math.hypot(sx, sy);
    if (len < 0.25) autoFire(k === 'sup');
    else { const [wx, wz] = toWorld(sx, sy); fire(wx, wz, Math.min(1, len), k === 'sup'); }
  }
  updateBtnStates();
}
window.addEventListener('pointerup', pointerEnd);
window.addEventListener('pointercancel', pointerEnd);
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (!inGameInput()) return;
  if (e.code === 'Space' && !e.repeat) autoFire(false);
  if ((e.code === 'KeyE' || e.code === 'KeyQ') && !e.repeat) { if (performance.now() - mouse.active < 4000) fireAtMouse(true); else autoFire(true); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function updateBtnStates() {
  $('atkBtn').classList.toggle('held', !!ptr.atk && !ptr.atk.free);
  $('superBtn').classList.toggle('held', !!ptr.sup);
}
function toWorld(sx, sy) { return G.flip ? [-sx, -sy] : [sx, sy]; }

function moveInput() {
  if (ptr.move) {
    const dx = ptr.move.x - ptr.move.cx, dy = ptr.move.y - ptr.move.cy;
    const l = Math.hypot(dx, dy);
    if (l < joyR() * 0.15) return [0, 0];
    return [dx / l, dy / l];
  }
  let x = 0, y = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  const l = Math.hypot(x, y);
  return l ? [x / l, y / l] : [0, 0];
}

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function mouseWorld() {
  raycaster.setFromCamera(new THREE.Vector2((mouse.x / window.innerWidth) * 2 - 1, -(mouse.y / window.innerHeight) * 2 + 1), camera);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
}
function mouseAim(isSuper) {
  const hit = mouseWorld();
  if (!hit) return null;
  const b = S.BRAWLERS[G.myBrawler];
  const range = (isSuper ? b.super.range : b.attack.range) || b.attack.range;
  const dx = hit.x - G.me.x, dz = hit.z - G.me.z, d = Math.hypot(dx, dz) || 1;
  return [dx / d, dz / d, Math.min(1, d / range)];
}
function fireAtMouse(isSuper) {
  const a = mouseAim(isSuper);
  if (a) fire(a[0], a[1], a[2], isSuper);
}

function canFire(isSuper) {
  const me = G.me;
  if (!me.alive || me.forced) return false;
  if (isSuper ? me.superC < 1 : me.ammo < 1) { if (!isSuper) sfx.empty(); return false; }
  return true;
}
function fire(wx, wz, len, isSuper) {
  if (!canFire(isSuper)) return;
  const l = Math.hypot(wx, wz) || 1;
  send({ t: 'atk', x: r2((wx / l) * len), z: r2((wz / l) * len), sup: isSuper });
  G.me.a = Math.atan2(wx, wz);
  G.me.aimHold = performance.now();
  if (isSuper) G.me.superC = 0; else G.me.ammo -= 1;
  sfx.shot(1);
}
function autoFire(isSuper) {
  if (!canFire(isSuper)) return;
  const b = S.BRAWLERS[G.myBrawler];
  const spec = isSuper ? b.super : b.attack;
  if (spec.type === 'heal') return fire(0, 1, 1, true);
  const range = spec.range || b.attack.range;
  let best = null, bd = range * 1.15;
  for (const pv of G.pv.values()) {
    if (pv.id === myId || pv.team === G.myTeam || !pv.root.visible) continue;
    const d = Math.hypot(pv.x - G.me.x, pv.z - G.me.z);
    if (d < bd) { bd = d; best = [pv.x, pv.z]; }
  }
  if (!best && G.mode === 'showdown') {
    const { w, t } = G.map;
    t.forEach((ch, i) => {
      if (ch !== 'X') return;
      const x = (i % w) + 0.5, z = Math.floor(i / w) + 0.5, d = Math.hypot(x - G.me.x, z - G.me.z);
      if (d < bd) { bd = d; best = [x, z]; }
    });
  }
  const isLob = spec.type === 'lob' || spec.type === 'leap';
  if (best) {
    const dx = best[0] - G.me.x, dz = best[1] - G.me.z;
    fire(dx, dz, isLob ? clamp(bd / range, 0.12, 1) : 1, isSuper);
  } else fire(Math.sin(G.me.a), Math.cos(G.me.a), isLob ? 0.7 : 1, isSuper);
}

// ============ per-frame update ============
let lastFrame = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (G) {
    if (G.tilesDirty) buildTiles();
    updateMe(dt, now);
    updatePlayers(dt, now);
    updateProjectiles(now);
    updateMisc(dt, now);
    updateCamera(dt);
    updateLabels();
    updateHud();
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

function updateMe(dt, now) {
  const me = G.me;
  if (!me.init) return;
  if (me.alive && !me.forced) {
    const [mx, my] = moveInput();
    const [wx, wz] = toWorld(mx, my);
    const spd = S.BRAWLERS[G.myBrawler].speed * (me.slowed ? 0.55 : 1);
    if (wx || wz) {
      [me.x, me.z] = S.moveCircle(G.map, me.x, me.z, wx * spd * dt, wz * spd * dt);
      if (!(now - (me.aimHold || 0) < 350) && !ptr.atk && !ptr.sup) me.a = Math.atan2(wx, wz);
    }
    if (now - G.lastPos > 33) {
      G.lastPos = now;
      send({ t: 'pos', x: r2(me.x), z: r2(me.z), a: r2(me.a) });
    }
  } else if (me.forced) {
    const k = Math.min(1, dt * 18);
    me.x += (me.sx - me.x) * k; me.z += (me.sz - me.z) * k;
  }
  // aim preview
  let shown = false;
  for (const k of ['atk', 'sup']) {
    const p = ptr[k];
    if (!p || !me.alive) continue;
    const R = joyR();
    const sx = (p.x - p.cx) / R, sy = (p.y - p.cy) / R, len = Math.hypot(sx, sy);
    if (len < 0.25) continue;
    const [wx, wz] = toWorld(sx, sy);
    showAim(k === 'sup', wx, wz, len);
    me.a = Math.atan2(wx, wz);
    shown = true;
  }
  if (!shown && me.alive && now - mouse.active < 3000 && G.myBrawler) {
    const a = mouseAim(false);
    if (a) { showAim(false, a[0], a[1], a[2]); G.aim.mat.opacity = 0.18; shown = true; }
  }
  G.aim.group.visible = shown;
}

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function updatePlayers(dt, now) {
  const snaps = G.snaps;
  if (!snaps.length) return;
  const latest = snaps[snaps.length - 1];
  const rt = now - 100;
  let a = snaps[0], b = latest;
  for (let i = snaps.length - 1; i > 0; i--) {
    if (snaps[i - 1].time <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
  }
  const k = b.time > a.time ? clamp((rt - a.time) / (b.time - a.time), 0, 1) : 1;
  for (const pv of G.pv.values()) {
    const e = latest.pm.get(pv.id);
    const alive = e && (e[6] & 1);
    pv.root.visible = !!alive;
    pv.last = e || null;
    if (!alive) continue;
    if (pv.id === myId) {
      pv.x = G.me.x; pv.z = G.me.z;
      pv.a = lerpAngle(pv.a, G.me.a, Math.min(1, dt * 20));
    } else {
      const ea = a.pm.get(pv.id), eb = b.pm.get(pv.id) || e;
      let x = eb[1], z = eb[2], ang = eb[3];
      if (ea && Math.hypot(ea[1] - eb[1], ea[2] - eb[2]) < 3) {
        x = ea[1] + (eb[1] - ea[1]) * k; z = ea[2] + (eb[2] - ea[2]) * k; ang = lerpAngle(ea[3], eb[3], k);
      }
      pv.x = x; pv.z = z;
      pv.a = lerpAngle(pv.a, ang, Math.min(1, dt * 15));
    }
    const moved = Math.hypot(pv.x - pv.px, pv.z - pv.pz);
    pv.px = pv.x; pv.pz = pv.z;
    let y = 0;
    if (e[6] & 4) y = 0; // forced
    if (moved > 0.005) pv.phase += dt * 14; else pv.phase *= 0.8;
    const leap = e[6] & 4 && moved > 0.08;
    pv.leapH = leap ? Math.min(2.2, (pv.leapH || 0) + dt * 10) : Math.max(0, (pv.leapH || 0) - dt * 10);
    y = Math.abs(Math.sin(pv.phase)) * 0.09 + pv.leapH;
    pv.root.position.set(pv.x, 0, pv.z);
    pv.model.position.y = y;
    pv.model.rotation.y = pv.a;
    pv.recoil = Math.max(0, pv.recoil - dt * 6);
    pv.model.scale.set(1 + pv.recoil * 0.12, 1 - pv.recoil * 0.1, 1 + pv.recoil * 0.12);
    pv.model.rotation.x = -pv.recoil * 0.15;
    pv.flash = Math.max(0, pv.flash - dt);
    const inB = !!(e[6] & 2);
    const op = inB ? 0.45 : 1;
    const fl = pv.flash > 0 ? 0.6 : 0;
    if (pv._op !== op || pv._fl !== fl) {
      pv._op = op; pv._fl = fl;
      for (const m of pv.model.userData.mats) { m.opacity = op; m.emissive.setRGB(fl, fl * 0.25, fl * 0.25); }
    }
  }
  if (G.bushMat) G.bushMat.opacity = G.me.inBush ? 0.6 : 0.95;
}

function updateProjectiles(now) {
  for (const p of G.projs.values()) {
    const delay = p.owner === myId ? 0 : 0.1;
    const el = clamp((now - p.recv) / 1000 - delay, -0.15, 0.1);
    p.mesh.position.set(p.x + p.vx * el, 0.55, p.z + p.vz * el);
    p.mesh.rotation.y = Math.atan2(p.vx, p.vz);
  }
  for (const l of G.lobs.values()) {
    const delay = l.owner === myId ? 0 : 0.1;
    const k = clamp((l.t + (now - l.recv) / 1000 - delay) / l.dur, 0, 1);
    const x = l.sx + (l.tx - l.sx) * k, z = l.sz + (l.tz - l.sz) * k;
    const h = 1.2 + Math.hypot(l.tx - l.sx, l.tz - l.sz) * 0.25;
    l.mesh.position.set(x, 0.5 + 4 * h * k * (1 - k), z);
    l.mesh.rotation.x += 0.2;
    l.shadow.position.set(x, 0.03, z);
  }
}

function updateMisc(dt, now) {
  const t = now / 1000;
  for (const it of G.items.values()) {
    it.mesh.position.set(it.x, 0.45 + Math.sin(t * 3 + it.x) * 0.08, it.z);
    it.mesh.rotation.y = t * 2;
  }
  if (G.mineCrystal) G.mineCrystal.rotation.y = t;
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.life -= dt; p.vy -= 14 * dt;
    p.m.position.x += p.vx * dt; p.m.position.y = Math.max(0.05, p.m.position.y + p.vy * dt); p.m.position.z += p.vz * dt;
    p.m.rotation.x += dt * 8;
    if (p.life <= 0) { G.world.remove(p.m); G.parts.splice(i, 1); }
  }
  for (let i = G.booms.length - 1; i >= 0; i--) {
    const b = G.booms[i];
    b.t += dt;
    const k = b.t / b.dur;
    b.m.scale.set(b.r * (0.3 + k * 0.8), b.r * 0.5 * (0.3 + k), b.r * (0.3 + k * 0.8));
    b.m.material.opacity = 0.75 * (1 - k);
    if (k >= 1) { G.world.remove(b.m); b.m.material.dispose(); G.booms.splice(i, 1); }
  }
  if (G.gas && G.sc) {
    const g = G.sc.gas, { w, h } = G.map;
    const sets = [[g, h, g / 2, h / 2], [g, h, w - g / 2, h / 2], [w - 2 * g, g, w / 2, g / 2], [w - 2 * g, g, w / 2, h - g / 2]];
    G.gas.forEach((m, i) => {
      const [sx, sz, x, z] = sets[i];
      m.visible = g > 0 && sx > 0 && sz > 0;
      m.scale.set(sx, 1.6 + Math.sin(t * 2) * 0.1, sz);
      m.position.set(x, 0.8, z);
    });
  }
}

function updateCamera(dt) {
  let tx = G.me.x, tz = G.me.z;
  if (!G.me.alive && G.mode === 'showdown') {
    let pv = G.spectate && G.pv.get(G.spectate);
    if (!pv || !pv.root.visible) {
      pv = [...G.pv.values()].find((q) => q.root.visible);
      G.spectate = pv ? pv.id : null;
    }
    if (pv) { tx = pv.x; tz = pv.z; }
  }
  const { w, h } = G.map;
  tx = clamp(tx, Math.min(w / 2, 6), Math.max(w / 2, w - 6));
  tz = clamp(tz, 2, h - 2);
  if (!G.camT) G.camT = { x: tx, z: tz };
  const k = Math.min(1, dt * 6);
  G.camT.x += (tx - G.camT.x) * k; G.camT.z += (tz - G.camT.z) * k;
  const asp = window.innerWidth / window.innerHeight;
  const zoom = asp < 1.3 ? Math.min(2.1, 1.3 / asp) : 1;
  const sgn = G.flip ? -1 : 1;
  const lx = G.camT.x, lz = G.camT.z - 1.2 * sgn;
  camera.position.set(lx, 12.5 * zoom, lz + 7.5 * zoom * sgn);
  camera.lookAt(lx, 0, lz);
}

function updateLabels() {
  const hidden = { display: 'none' };
  for (const pv of G.pv.values()) {
    const e = pv.last;
    if (!pv.root.visible || !e) { if (pv.label.style.display !== 'none') pv.label.style.display = hidden.display; continue; }
    const [sx, sy, ok] = toScreen(pv.x, 1.75 + pv.model.position.y, pv.z);
    if (!ok) { pv.label.style.display = 'none'; continue; }
    pv.label.style.display = '';
    pv.label.style.transform = `translate(${sx | 0}px, ${sy | 0}px) translate(-50%, -100%)`;
    const hp = e[4], max = e[5];
    const txt = hp + '|' + max + '|' + e[7];
    if (pv.lastTxt !== txt) {
      pv.lastTxt = txt;
      pv.hpFill.style.width = clamp((hp / max) * 100, 0, 100) + '%';
      pv.hpt.textContent = hp;
      pv.gemEl.textContent = e[7] > 0 ? (G.mode === 'showdown' ? '🟩' : '💎') + ' ' + e[7] : '';
    }
    if (pv.id === myId) {
      const am = G.me.ammo;
      pv.ammoEls.forEach((el, i) => { el.style.width = clamp(am - i, 0, 1) * 100 + '%'; });
    }
  }
}

function fmtTime(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function updateHud() {
  const sc = G.sc, me = G.me;
  if (!sc) return;
  let html = '', center = '';
  const mine = G.myTeam === 1 ? 1 : 0, theirs = 1 - mine;
  if (G.mode === 'gemgrab') {
    html = `<span class="pill blue">💎 ${sc.s[mine]}</span><span class="time">${fmtTime(sc.tl)}</span><span class="pill red">${sc.s[theirs]} 💎</span>`;
    if (sc.cd != null) center = `<span style="color:${sc.cdT === G.myTeam ? '#7ab8ff' : '#ff7a7a'}">${sc.cd}</span><small>${sc.cdT === G.myTeam ? 'Hold on! Your team is winning' : 'Enemy team is winning! Grab their gems!'}</small>`;
  } else if (G.mode === 'bounty') {
    html = `<span class="pill blue">⭐ ${sc.s[mine]}</span><span class="time">${fmtTime(sc.tl)}</span><span class="pill red">${sc.s[theirs]} ⭐</span>`;
  } else {
    html = `<span class="time">💀 ${sc.alive} left</span>${me.gems ? `<span class="time">🟩 ${me.gems}</span>` : ''}`;
    if (sc.gas > 0 && sc.gas < 3) center = `<small>☠️ The poison gas is closing in!</small>`;
  }
  if (!me.alive) center = G.mode === 'showdown' ? 'Knocked out!<small>Spectating…</small>' : `Respawning in ${me.respawn}`;
  if (G.lastScoreHtml !== html) { $('score').innerHTML = html; G.lastScoreHtml = html; }
  if (G.lastCenter !== center) { $('center').innerHTML = center; G.lastCenter = center; }
  const sb = $('superBtn');
  const ready = me.superC >= 1;
  sb.classList.toggle('ready', ready);
  sb.style.setProperty('--p', Math.round(me.superC * 100) + '%');
  if (ready && !G.superWasReady && me.alive) sfx.ready();
  G.superWasReady = ready;
}

// ============ end screen ============
function showEnd(m) {
  G.endShown = true;
  ptr.move = ptr.atk = ptr.sup = null;
  $('joyBase').classList.add('hidden');
  const title = $('endTitle');
  let txt, win;
  if (m.mode === 'showdown') {
    const rank = m.ranking.indexOf(myId) + 1;
    win = rank === 1;
    txt = win ? 'VICTORY!' : `#${rank || '?'}`;
    $('endSub').textContent = win ? 'Last brawler standing! 🏆' : `You placed #${rank} of ${m.ranking.length}`;
  } else {
    win = m.winTeam === G.myTeam;
    txt = m.winTeam === -1 ? 'DRAW' : win ? 'VICTORY!' : 'DEFEAT';
    const mine = G.myTeam === 1 ? 1 : 0;
    $('endSub').textContent = `${m.score[mine]} - ${m.score[1 - mine]}`;
  }
  title.textContent = txt;
  title.className = win ? 'win' : m.winTeam === -1 && m.mode !== 'showdown' ? '' : 'lose';
  const rows = m.stats.slice().sort((a, b) => b.kills - a.kills).map((s) => {
    const cls = m.mode === 'showdown' ? (s.id === myId ? 'b' : '') : s.team === G.myTeam ? 'b' : 'r';
    return `<div class="${cls}">${S.BRAWLERS[s.brawler].icon} ${esc(s.name)}${s.id === myId ? ' (you)' : ''}</div><div>💥 ${s.kills}</div><div>💀 ${s.deaths}</div>`;
  }).join('');
  $('endStats').innerHTML = `<div class="h">Brawler</div><div class="h">KOs</div><div class="h">Deaths</div>${rows}`;
  if (win) sfx.ready();
  showScreen('end');
}
