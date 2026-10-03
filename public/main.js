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
$('rematchBtn').onclick = () => send({ t: 'rematch' });
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
    case 'rocco':
      add(geo.cyl, 0x3b3b4a, 0.26, 0.42, 0.26, 0, 0.22, 0);
      add(geo.cyl, col, 0.34, 0.44, 0.31, 0, 0.64, 0);
      add(geo.sph, SKIN, 0.28, 0.28, 0.28, 0, 1.05, 0);
      add(geo.sph, 0xffffff, 0.31, 0.24, 0.31, 0, 1.12, -0.02);
      add(geo.box, 0x3a8dff, 0.36, 0.1, 0.06, 0, 1.08, 0.27);
      add(geo.cyl, 0x556b2f, 0.13, 0.95, 0.13, 0.3, 0.98, 0.05).rotation.x = Math.PI / 2;
      add(geo.cyl, 0x222222, 0.15, 0.08, 0.15, 0.3, 0.98, 0.52).rotation.x = Math.PI / 2;
      break;
    case 'hooky':
      add(geo.cyl, 0x3b2a1a, 0.26, 0.42, 0.26, 0, 0.22, 0);
      add(geo.cyl, col, 0.34, 0.44, 0.31, 0, 0.64, 0);
      add(geo.sph, SKIN, 0.28, 0.28, 0.28, 0, 1.05, 0);
      add(geo.sph, 0xd8332a, 0.3, 0.16, 0.3, 0, 1.18, -0.02);
      add(geo.box, 0x111111, 0.12, 0.08, 0.03, 0.1, 1.1, 0.27);
      add(geo.cyl, 0x8a8f98, 0.05, 0.4, 0.05, 0.33, 0.68, 0.25).rotation.x = Math.PI / 2;
      add(geo.cone, 0xd0d4dc, 0.09, 0.22, 0.09, 0.33, 0.68, 0.5).rotation.x = Math.PI / 2;
      add(geo.sph, 0x111111, 0.05, 0.065, 0.05, -0.1, 1.08, 0.25);
      break;
    case 'gravo':
      add(geo.cone, col, 0.42, 0.95, 0.42, 0, 0.48, 0);
      add(geo.sph, 0xd8d0ff, 0.27, 0.27, 0.27, 0, 1.05, 0);
      add(geo.sph, 0x7fe8ff, 0.18, 0.08, 0.06, 0, 1.08, 0.24);
      add(geo.cyl, 0x30304a, 0.08, 0.55, 0.08, 0.3, 0.7, 0.25).rotation.x = Math.PI / 2;
      add(geo.cyl, 0xb08cff, 0.17, 0.05, 0.17, 0.3, 0.7, 0.5).rotation.x = Math.PI / 2;
      add(geo.sph, 0xb08cff, 0.07, 0.07, 0.07, 0, 1.38, 0);
      break;
    case 'boing':
      add(geo.cyl, 0x2b2b2b, 0.24, 0.3, 0.24, 0, 0.15, 0);
      add(geo.sph, col, 0.42, 0.42, 0.4, 0, 0.62, 0);
      add(geo.sph, SKIN, 0.26, 0.26, 0.26, 0, 1.12, 0);
      add(geo.cyl, 0xffffff, 0.28, 0.06, 0.28, 0, 1.2, 0);
      add(geo.sph, 0xe86a1a, 0.17, 0.17, 0.17, 0.38, 0.62, 0.22);
      eyes(1.14, 0.23);
      break;
    case 'jet':
      add(geo.cyl, 0x5a6270, 0.25, 0.42, 0.25, 0, 0.22, 0);
      add(geo.cyl, col, 0.33, 0.44, 0.3, 0, 0.64, 0);
      add(geo.sph, SKIN, 0.28, 0.28, 0.28, 0, 1.05, 0);
      add(geo.box, 0x333333, 0.42, 0.09, 0.06, 0, 1.1, 0.25);
      add(geo.cyl, 0x8a8f98, 0.1, 0.5, 0.1, 0.13, 0.7, -0.35);
      add(geo.cyl, 0x8a8f98, 0.1, 0.5, 0.1, -0.13, 0.7, -0.35);
      add(geo.cone, 0xff9a2a, 0.08, 0.2, 0.08, 0.13, 0.36, -0.35).rotation.x = Math.PI;
      add(geo.cone, 0xff9a2a, 0.08, 0.2, 0.08, -0.13, 0.36, -0.35).rotation.x = Math.PI;
      add(geo.box, 0x333333, 0.08, 0.1, 0.4, 0.3, 0.66, 0.2);
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
  const map = { w: rows[0].length, h: rows.length, t: rows.join('').split(''), spawns: m.spawns, mine: m.mine, plats: m.plats || [], goals: m.goals || [[], []], time: m.time || 0 };
  const meR = m.roster.find((r) => r.id === m.you);
  G = {
    mode: m.mode, map, myTeam: meR ? meR.team : -1, flip: m.mode !== 'showdown' && meR && meR.team === 1,
    pv: new Map(), snaps: [], items: new Map(), projs: new Map(), lobs: new Map(), fields: new Map(),
    parts: [], booms: [], me: { ...S.newBody(0, 0), init: false, a: 0, tp: -1, alive: true, hp: 1, maxHp: 1, ammo: 3, superC: 0, gems: 0, respawn: 0, slowed: false, inBush: false },
    ragdolls: [], shake: 0, camY: 0, jumpQueued: false,
    sc: null, world: new THREE.Group(), tiles: null, tilesDirty: true, camT: null, lastPos: 0, spectate: null, superWasReady: false,
    endShown: false, gas: null, lastScoreHtml: '', objs: new Map(), timeOff: (m.time || 0) - performance.now() / 1000,
    banner: { text: `${S.MODES[m.mode].icon} ${S.MODES[m.mode].name}<small>${esc(m.mapName || '')}</small>`, until: performance.now() + 2800 },
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
  $('feed').innerHTML = '';
  $('respawnPick').classList.add('hidden');
  G = null;
  ptr.move = ptr.atk = ptr.sup = ptr.jump = null;
  $('joyBase').classList.add('hidden');
}

function buildWorld() {
  const { w, h } = G.map;
  const sd = G.mode === 'showdown';
  // the arena floats over an abyss: fall in a pit and you're gone
  const abyss = new THREE.Mesh(new THREE.PlaneGeometry(w + 120, h + 120), basicMat(sd ? 0x0f2a33 : 0x1d1430));
  abyss.rotation.x = -Math.PI / 2; abyss.position.set(w / 2, -9, h / 2);
  G.world.add(abyss);
  // border fence
  const fenceMat = lambert(sd ? 0x2f5e2e : 0x8a5a33);
  const mk = (sx, sz, x, z) => { const m = new THREE.Mesh(geo.box, fenceMat); m.scale.set(sx, 5, sz); m.position.set(x, -2.1, z); G.world.add(m); };
  mk(w + 2, 1, w / 2, -0.5); mk(w + 2, 1, w / 2, h + 0.5); mk(1, h, -0.5, h / 2); mk(1, h, w + 0.5, h / 2);
  if (G.map.mine) {
    const my = S.tileH(S.tileAt(G.map, Math.floor(G.map.mine[0]), Math.floor(G.map.mine[1])));
    const mine = new THREE.Mesh(geo.disc, basicMat(0x4a2a5a, 0.8));
    mine.scale.setScalar(1.1); mine.position.set(G.map.mine[0], my + 0.02, G.map.mine[1]);
    G.world.add(mine);
    const crys = new THREE.Mesh(geo.gem, lambert(0xb64dff));
    crys.scale.setScalar(1.6); crys.position.set(G.map.mine[0], my + 0.4, G.map.mine[1]);
    G.world.add(crys); G.mineCrystal = crys;
  }
  if (sd) {
    G.gas = [];
    const gm = new THREE.MeshBasicMaterial({ color: 0x3cff6a, transparent: true, opacity: 0.32, depthWrite: false });
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(geo.box, gm); m.visible = false; G.world.add(m); G.gas.push(m); }
  }
  // moving platforms
  G.platMeshes = G.map.plats.map((pl) => {
    const m = new THREE.Mesh(geo.box, lambert(sd ? 0x8e9aa8 : 0xb08860));
    m.scale.set(pl.w, 0.5, pl.d);
    G.world.add(m);
    return m;
  });
  // goals (Rocket Ball): yours is blue, theirs is red
  G.map.goals.forEach((tiles, tm) => {
    for (const [c, r] of tiles) {
      const g = new THREE.Mesh(geo.box, basicMat(relColor(tm) === 0x3a8dff ? 0x3a8dff : 0xff3b3b, 0.45));
      g.scale.set(1, 0.05, 1); g.position.set(c + 0.5, 0.03, r + 0.5);
      G.world.add(g);
    }
    if (tiles.length) {
      const xs = tiles.map((t) => t[0]), r = tiles[0][1];
      for (const x of [Math.min(...xs), Math.max(...xs) + 1]) {
        const post = new THREE.Mesh(geo.cyl, lambert(0xffffff));
        post.scale.set(0.08, 1.4, 0.08); post.position.set(x, 0.7, r + 0.5);
        G.world.add(post);
      }
      const bar = new THREE.Mesh(geo.box, lambert(0xffffff));
      bar.scale.set(xs.length + 0.1, 0.1, 0.1); bar.position.set(Math.min(...xs) + xs.length / 2, 1.4, r + 0.5);
      G.world.add(bar);
    }
  });
  if (G.mode === 'koth' && G.map.mine) {
    G.hill = new THREE.Mesh(new THREE.RingGeometry(2.25, 2.45, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    G.hill.position.set(G.map.mine[0], 1.24, G.map.mine[1]);
    G.world.add(G.hill);
  }
  // aim indicators
  G.aim = makeAim();
  G.world.add(G.aim.group);
}

function buildTiles() {
  if (G.tiles) { G.world.remove(G.tiles); G.tiles.traverse((o) => { if (o.isInstancedMesh) o.dispose(); }); }
  const { w, h, t } = G.map;
  const sd = G.mode === 'showdown';
  const lists = { col: [], B: [], X: [], E: [], J: [] };
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const ch = t[r * w + c];
    if (ch !== 'O') lists.col.push([c, r, ch]);
    if (lists[ch]) lists[ch].push([c, r]);
  }
  const spawnTint = (c, r) => {
    if (sd) return -1;
    for (const [tm, list] of G.map.spawns.entries()) for (const [x, z] of list) if (Math.abs(c + 0.5 - x) <= 1.5 && Math.abs(r + 0.5 - z) <= 1) return tm;
    return -1;
  };
  const grp = new THREE.Group();
  const tmp = new THREE.Object3D(), col = new THREE.Color(), tint = new THREE.Color();
  const noise = (c, r) => { const n = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453; return n - Math.floor(n) - 0.5; };
  const inst = (list, gm, mat, place, color) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(gm, mat, list.length);
    list.forEach((it, i) => {
      place(tmp, it[0], it[1], it[2]); tmp.updateMatrix(); im.setMatrixAt(i, tmp.matrix);
      color(col, it[0], it[1], it[2]); im.setColorAt(i, col);
    });
    grp.add(im);
    return im;
  };
  // terrain columns: floor, steps, high ground and walls all go down into the abyss
  const C = sd
    ? { a: 0x7cc36a, b: 0x72b862, m: 0x86c873, h: 0x9ad986, wall: 0x8d8f99 }
    : { a: 0xe8c27a, b: 0xddb46c, m: 0xe9bf74, h: 0xf6d796, wall: 0xc9874a };
  inst(lists.col, geo.box, new THREE.MeshLambertMaterial({ color: 0xffffff }), (o, c, r, ch) => {
    const top = ch === '#' ? S.tileH('#') : ch === 'X' || ch === 'E' ? 0 : S.tileH(ch);
    o.position.set(c + 0.5, (top - 5) / 2, r + 0.5); o.scale.set(1, top + 5, 1); o.rotation.set(0, 0, 0);
  }, (cl, c, r, ch) => {
    if (ch === '#') cl.setHex(C.wall).multiplyScalar(1 + noise(c, r) * 0.18);
    else if (ch === 'h') cl.setHex(C.h).multiplyScalar(1 + noise(c, r) * 0.05);
    else if (ch === 'm') cl.setHex(C.m);
    else if (ch === 'K') cl.setHex(sd ? 0x6f7a55 : 0xa08660).multiplyScalar(1 + noise(c, r) * 0.2);
    else cl.setHex((r + c) % 2 ? C.a : C.b);
    const tm = ch === '#' ? -1 : spawnTint(c, r);
    if (tm >= 0) cl.lerp(tint.setHex(relColor(tm) === 0x3a8dff ? 0x5a9cff : 0xff6a6a), 0.35);
  });
  G.bushMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  inst(lists.B, geo.bush, G.bushMat, (o, c, r) => { o.position.set(c + 0.5, 0.42, r + 0.5); o.scale.set(1, 0.8, 1); o.rotation.set(0, c * 1.7 + r, 0); },
    (cl, c, r) => cl.setHex(0x3fa34d).multiplyScalar(1 + noise(c, r) * 0.25));
  inst(lists.X, geo.box, new THREE.MeshLambertMaterial({ color: 0xffffff }), (o, c, r) => { o.position.set(c + 0.5, 0.45, r + 0.5); o.scale.set(0.88, 0.9, 0.88); o.rotation.set(0, 0, 0); },
    (cl) => cl.setHex(0xa8743d));
  for (const [c, r] of lists.X) {
    const cube = new THREE.Mesh(geo.box, basicMat(0x5dff7a));
    cube.scale.setScalar(0.3); cube.position.set(c + 0.5, 0.95, r + 0.5); cube.rotation.set(0.6, 0.6, 0);
    grp.add(cube);
  }
  // bounce pads
  inst(lists.J, geo.cyl, new THREE.MeshLambertMaterial({ color: 0xffffff }), (o, c, r) => { o.position.set(c + 0.5, 0.05, r + 0.5); o.scale.set(0.42, 0.1, 0.42); o.rotation.set(0, 0, 0); },
    (cl) => cl.setHex(0x3dff8a));
  inst(lists.J, geo.cone, new THREE.MeshBasicMaterial({ color: 0xffffff }), (o, c, r) => { o.position.set(c + 0.5, 0.22, r + 0.5); o.scale.set(0.18, 0.22, 0.18); o.rotation.set(0, 0, 0); },
    (cl) => cl.setHex(0xfff36b));
  // explosive barrels
  inst(lists.E, geo.cyl, new THREE.MeshLambertMaterial({ color: 0xffffff }), (o, c, r) => { o.position.set(c + 0.5, 0.43, r + 0.5); o.scale.set(0.36, 0.86, 0.36); o.rotation.set(0, 0, 0); },
    (cl) => cl.setHex(0xd8402a));
  inst(lists.E, geo.cyl, new THREE.MeshLambertMaterial({ color: 0xffffff }), (o, c, r) => { o.position.set(c + 0.5, 0.5, r + 0.5); o.scale.set(0.375, 0.14, 0.375); o.rotation.set(0, 0, 0); },
    (cl) => cl.setHex(0xffd23f));
  G.tiles = grp;
  G.world.add(grp);
  G.tilesDirty = false;
}

function syncRoster(roster) {
  const ids = new Set(roster.map((r) => r.id));
  for (const [id, pv] of G.pv) if (!ids.has(id)) { G.world.remove(pv.root); pv.label.remove(); G.pv.delete(id); }
  for (const r of roster) {
    const old = G.pv.get(r.id);
    if (old && old.brawler === r.brawler) continue;
    if (old) { G.world.remove(old.root); old.label.remove(); G.pv.delete(r.id); }
    const root = new THREE.Group();
    const shadow = new THREE.Mesh(geo.disc, basicMat(0x000000, 0.28));
    shadow.scale.setScalar(0.45); shadow.position.y = 0.015;
    const isMe = r.id === myId;
    const ringColor = isMe ? 0x4cff6a : relColor(r.team);
    const ring = new THREE.Mesh(geo.ring, basicMat(ringColor, 0.85));
    ring.position.y = 0.03;
    const model = makeModel(r.brawler);
    root.add(shadow, ring, model);
    root.userData = { shadow, ring };
    root.visible = false;
    G.world.add(root);
    const label = document.createElement('div');
    label.className = 'plabel';
    const nameColor = isMe ? '#9dff9d' : r.team === G.myTeam ? '#9cc9ff' : '#ff9c9c';
    label.innerHTML = `<div class="gem"></div><div class="n" style="color:${nameColor}">${esc(r.name)}</div><div class="hpt"></div><div class="hpbar"><i></i></div>` +
      (isMe ? '<div class="ammo"><b><i></i></b><b><i></i></b><b><i></i></b></div>' : '') +
      (isMe && S.BRAWLERS[r.brawler].jet ? '<div class="fuel"><i></i></div>' : '');
    label.style.display = 'none';
    $('labels').appendChild(label);
    const hpFill = label.querySelector('.hpbar i');
    hpFill.style.background = isMe ? '#56e05a' : r.team === G.myTeam ? '#3a8dff' : '#ff4a4a';
    G.pv.set(r.id, {
      ...r, root, model, label, hpFill, hpt: label.querySelector('.hpt'), gemEl: label.querySelector('.gem'),
      ammoEls: [...label.querySelectorAll('.ammo i')], x: 0, z: 0, y: 0, a: 0, px: 0, pz: 0, phase: 0, recoil: 0, flash: 0, last: null, lastTxt: '',
      shadow, ring, spin: 0, tumble: 0, fuelEl: label.querySelector('.fuel i'), airT: 0,
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
  G.timeOff += (m.tm - now / 1000 - G.timeOff) * 0.2;
  syncObjs(m.ob || [], now);
  const me = G.me, e = pm.get(myId);
  if (e) {
    if (!me.init || e[10] !== me.tp) {
      Object.assign(me, S.newBody(e[1], e[2], e[12]));
      me.tp = e[10]; me.init = true;
      if (!G.camT) G.camT = { x: e[1], z: e[2] };
    }
    const wasAlive = me.alive;
    me.alive = !!(e[6] & 1); me.inBush = !!(e[6] & 2); me.slowed = !!(e[6] & 8);
    me.hp = e[4]; me.maxHp = e[5]; me.gems = e[7]; me.ammo = e[8]; me.superC = e[9]; me.respawn = e[11];
    if (me.alive && !wasAlive) { Object.assign(me, S.newBody(e[1], e[2], e[12])); G.spectate = null; }
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
  for (const [id, x, z, r, team, fy, kind] of m.fd) {
    fs.add(id);
    if (!G.fields.has(id)) {
      const well = kind === 'well';
      const mesh = new THREE.Mesh(well ? new THREE.RingGeometry(0.15, 1, 24, 1).rotateX(-Math.PI / 2) : geo.disc,
        new THREE.MeshBasicMaterial({ color: well ? 0x6a2cff : team === G.myTeam ? 0x7fd0ff : 0x9cff5a, transparent: true, opacity: well ? 0.55 : 0.35, depthWrite: false }));
      mesh.userData.well = well;
      mesh.scale.setScalar(r); mesh.position.set(x, (fy || 0) + 0.04, z);
      G.world.add(mesh);
      G.fields.set(id, mesh);
    }
  }
  for (const [id, mesh] of G.fields) if (!fs.has(id)) { G.world.remove(mesh); mesh.material.dispose(); G.fields.delete(id); }
}

const PROJ_LOOK = {
  blaze: [0xffd36b, 0.13], blazeS: [0xfff07a, 0.19], bruno: [0xff8bd8, 0.14], brunoS: [0xff4fd2, 0.2],
  tank: [0x9cc6ff, 0.2], cactus: [0x8ef56b, 0.22], spike: [0xe8ffb0, 0.09], melody: [0xff8fb1, 0.3],
  pip: [0x222222, 0.2], pipS: [0x7a4a22, 0.36], cactusS: [0x6fd64a, 0.3], rocco: [0xff5a3a, 0.2], roccoS: [0xffa020, 0.24],
  hooky: [0xd0d4dc, 0.16], hookyS: [0xe0ffff, 0.2], gravo: [0x9a7cff, 0.34], gravoS: [0x2a0a4a, 0.4],
  boing: [0xff8a1f, 0.22], boingS: [0xff6a00, 0.6], jet: [0x9fe8ff, 0.12], jetS: [0xff8040, 0.18],
};
const ROUND = new Set(['melody', 'boing', 'boingS', 'gravo']);
const TRAIL = new Set(['rocco', 'roccoS', 'jetS']);
function projMesh(kind) {
  const [color, size] = PROJ_LOOK[kind] || [0xffffff, 0.15];
  const mesh = new THREE.Mesh(geo.sphLo, basicMat(color, kind === 'melody' ? 0.7 : 1));
  if (kind === 'melody') mesh.scale.set(1.0, 0.18, 0.3); else if (kind === 'gravo') mesh.scale.set(0.45, 0.2, 0.2); else mesh.scale.setScalar(size);
  mesh.userData.size = size;
  return mesh;
}
function syncObjs(list, now) {
  const seen = new Set();
  for (const [id, type, x, z, y, vx, vz] of list) {
    seen.add(id);
    let o = G.objs.get(id);
    if (!o) {
      let mesh;
      if (type === 'ball') {
        mesh = new THREE.Group();
        const s1 = new THREE.Mesh(geo.sph, lambert(0xffffff)); s1.scale.setScalar(0.36);
        const s2 = new THREE.Mesh(geo.cyl, lambert(0xff4a4a)); s2.scale.set(0.37, 0.12, 0.37);
        const s3 = new THREE.Mesh(geo.cyl, lambert(0x3a8dff)); s3.scale.set(0.37, 0.12, 0.37); s3.rotation.z = Math.PI / 2;
        mesh.add(s1, s2, s3);
      } else {
        mesh = new THREE.Mesh(geo.box, lambert(0xb07a3e));
        mesh.scale.setScalar(0.8);
      }
      const sh = new THREE.Mesh(geo.disc, basicMat(0x000000, 0.25));
      G.world.add(mesh, sh);
      o = { mesh, sh, type, r: type === 'ball' ? 0.36 : 0.42 };
      G.objs.set(id, o);
    }
    Object.assign(o, { x, z, y, vx, vz, recv: now });
  }
  for (const [id, o] of G.objs) if (!seen.has(id)) { G.world.remove(o.mesh, o.sh); G.objs.delete(id); }
}

function syncProjs(m, now) {
  const seen = new Set();
  for (const [id, kind, x, z, vx, vz, owner, y] of m.pr) {
    seen.add(id);
    let p = G.projs.get(id);
    if (!p) {
      p = { mesh: projMesh(kind), kind, owner };
      if (!ROUND.has(kind)) p.mesh.scale.z *= 1.8;
      if (kind === 'hooky' || kind === 'hookyS') {
        p.rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x333333 }));
        G.world.add(p.rope);
      }
      G.world.add(p.mesh);
      G.projs.set(id, p);
    }
    Object.assign(p, { x, z, y, vx, vz, recv: now });
  }
  for (const [id, p] of G.projs) if (!seen.has(id)) { G.world.remove(p.mesh); if (p.rope) { G.world.remove(p.rope); p.rope.geometry.dispose(); } G.projs.delete(id); }
  const ls = new Set();
  for (const [id, kind, sx, sz, tx, tz, t, dur, owner, sy, ty] of m.lb) {
    ls.add(id);
    let l = G.lobs.get(id);
    if (!l) {
      l = { mesh: projMesh(kind), owner };
      G.world.add(l.mesh);
      const sh = new THREE.Mesh(geo.disc, basicMat(0x000000, 0.25));
      sh.scale.setScalar(0.25); l.shadow = sh; G.world.add(sh);
      G.lobs.set(id, l);
    }
    Object.assign(l, { sx, sz, sy, tx, tz, ty, t, dur, recv: now });
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
function floatText(x, z, text, cls, y = 0) {
  const [sx, sy, ok] = toScreen(x, 1.6 + y, z);
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
    G.parts.push({ m, vx: Math.cos(a) * s, vy: 2 + Math.random() * 4, vz: Math.sin(a) * s, life: 0.6 + Math.random() * 0.4, floor: Math.max(0, S.groundAt(G.map, x, z, 0)) });
  }
}
function boom(x, z, r, color = 0xffa030, y = 0) {
  const m = new THREE.Mesh(geo.sphLo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }));
  m.position.set(x, y + 0.3, z);
  G.world.add(m);
  G.booms.push({ m, r, t: 0, dur: 0.35 });
}

// ============ ragdolls ============
// verlet ragdoll: 7 points joined by sticks, flops around the terrain
const RAG_PTS = [[0, 1.05, 0, 0.26], [0, 0.72, 0, 0.2], [0, 0.35, 0, 0.2], [0.42, 0.7, 0.06, 0.09], [-0.42, 0.7, 0.06, 0.09], [0.16, 0.06, 0, 0.1], [-0.16, 0.06, 0, 0.1]];
const RAG_STICKS = [[0, 1], [1, 2], [1, 3], [1, 4], [2, 5], [2, 6], [0, 2], [3, 2], [4, 2], [5, 6], [0, 3], [0, 4], [5, 1], [6, 1]];
const RAG_BONES = [[1, 3, 0.08], [1, 4, 0.08], [2, 5, 0.09], [2, 6, 0.09]];
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
function spawnRagdoll(brawler, x, y, z, a, vx, vy, vz) {
  if (G.ragdolls.length > 10) removeRagdoll(G.ragdolls[0]);
  const col = S.BRAWLERS[brawler].color;
  const headCol = brawler === 'tank' || brawler === 'cactus' ? col : brawler === 'melody' ? 0xf3f0e8 : SKIN;
  const limbCol = new THREE.Color(col).multiplyScalar(0.6).getHex();
  const ca = Math.cos(a), sa = Math.sin(a), h = 1 / 60;
  const spin = (Math.random() - 0.5) * 6;
  const pts = RAG_PTS.map(([ox, oy, oz, r]) => {
    const px = x + ox * ca + oz * sa, pz = z - ox * sa + oz * ca, py = y + oy;
    // a bit of random spin so every death looks different
    const pvx = vx + (Math.random() - 0.5) * 2 + oy * spin * ca, pvz = vz + (Math.random() - 0.5) * 2 - oy * spin * sa, pvy = vy + Math.random() * 1.5;
    return { x: px, y: py, z: pz, px: px - pvx * h, py: py - pvy * h, pz: pz - pvz * h, r };
  });
  const sticks = RAG_STICKS.map(([i, j]) => [i, j, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z)]);
  const grp = new THREE.Group();
  const mk = (color, sx, sy, sz, g = geo.cyl) => { const m = new THREE.Mesh(g, lambert(color)); m.scale.set(sx, sy, sz); grp.add(m); return m; };
  const head = mk(headCol, 0.27, 0.27, 0.27, geo.sph);
  const torso = mk(col, 0.3, 1, 0.3);
  const bones = RAG_BONES.map(([, , r]) => mk(limbCol, r, 1, r));
  G.world.add(grp);
  G.ragdolls.push({ pts, sticks, grp, head, torso, bones, life: 0, acc: 0 });
}
function removeRagdoll(rd) {
  G.world.remove(rd.grp);
  G.ragdolls.splice(G.ragdolls.indexOf(rd), 1);
}
function placeBone(mesh, a, b) {
  _dir.set(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = _dir.length() || 0.001;
  mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mesh.quaternion.setFromUnitVectors(_up, _dir.multiplyScalar(1 / len));
  mesh.scale.y = len;
}
function updateRagdolls(dt) {
  const h = 1 / 60, map = G.map;
  for (let i = G.ragdolls.length - 1; i >= 0; i--) {
    const rd = G.ragdolls[i];
    rd.life += dt; rd.acc += dt;
    const sinking = rd.life > 5;
    while (rd.acc >= h) {
      rd.acc -= h;
      for (const p of rd.pts) {
        const vx = (p.x - p.px) * 0.995, vy = (p.y - p.py) * 0.995, vz = (p.z - p.pz) * 0.995;
        p.px = p.x; p.py = p.y; p.pz = p.z;
        p.x += vx; p.y += vy - S.GRAVITY * h * h; p.z += vz;
      }
      for (let it = 0; it < 4; it++) {
        for (const [a, b, len] of rd.sticks) {
          const A = rd.pts[a], B = rd.pts[b];
          const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, d = Math.hypot(dx, dy, dz) || 0.0001;
          const k = ((d - len) / d) * 0.5;
          A.x += dx * k; A.y += dy * k; A.z += dz * k;
          B.x -= dx * k; B.y -= dy * k; B.z -= dz * k;
        }
        if (sinking) continue;
        for (const p of rd.pts) {
          const ch = S.tileAt(map, Math.floor(p.x), Math.floor(p.z));
          const top = S.tileH(ch);
          if (p.y - p.r < top) {
            const wasAbove = p.py - p.r >= top - 0.15;
            if (wasAbove || !S.BLOCK[ch] && top - (p.y - p.r) < 0.3) {
              p.y = top + p.r;
              // ground friction
              p.px = p.x - (p.x - p.px) * 0.75; p.pz = p.z - (p.z - p.pz) * 0.75;
              if (p.py < p.y) p.py = p.y + (p.py - p.y) * -0.3;
            } else { p.x = p.px; p.z = p.pz; } // hit a wall/cliff side: stop sideways
          }
        }
      }
    }
    if (sinking) for (const p of rd.pts) { p.y -= dt * 0.5; p.py = p.y; }
    const P = rd.pts;
    rd.head.position.set(P[0].x, P[0].y, P[0].z);
    placeBone(rd.torso, P[1], P[2]);
    rd.torso.scale.y += 0.25;
    RAG_BONES.forEach(([a, b], j) => placeBone(rd.bones[j], P[a], P[b]));
    if (rd.life > 7 || P[1].y < -14) removeRagdoll(rd);
  }
}
function handleFx(f) {
  const type = f[0];
  if (type === 'hit') {
    const [, x, z, amt, id, y, air, isPct] = f;
    const pv = G.pv.get(id);
    if (pv) pv.flash = 0.15;
    const txt = (isPct ? '+' + amt + '%' : (id === myId ? '-' : '') + amt) + (air ? ' AIR!' : '');
    if (id === myId) { floatText(x, z, txt, 'me', y); sfx.hurt(); navigator.vibrate?.(25); }
    else if (pv && pv.root.visible) { floatText(x, z, txt, air ? 'air' : '', y); sfx.hit(volAt(x, z) * 0.7); }
  } else if (type === 'kb') {
    const [, id, vx, vy, vz, set] = f;
    const pv = G.pv.get(id);
    const pow = Math.hypot(vx, vz) + Math.abs(vy);
    if (pv && set !== 2 && set !== 3) pv.tumble = Math.max(pv.tumble, Math.min(1, pow / 10));
    if (id === myId) {
      const me = G.me;
      if (set === 1) { me.vx = vx; me.vy = vy; me.vz = vz; me.leaping = true; me.grounded = false; }
      else if (set === 3) { me.vx = vx; me.vy = vy; me.vz = vz; me.grounded = false; me.stun = Math.max(me.stun, 0.5); } // grapple zip
      else if (set === 2) {
        // rocket jump: keep the momentum, no tumbling
        me.vx += vx; me.vz += vz; me.vy = Math.min(15, Math.max(me.vy, 0) * 0.3 + vy); me.grounded = false;
        me.stun = Math.max(me.stun, 0.45);
        G.shake = Math.min(0.5, G.shake + 0.15);
      }
      else {
        me.vx += vx; me.vz += vz;
        if (vy > 0) { me.vy = Math.min(14, Math.max(me.vy, 0) * 0.3 + vy); me.grounded = false; }
        me.stun = Math.max(me.stun, 0.3 + 0.025 * Math.hypot(vx, vz));
        G.shake = Math.min(0.5, G.shake + pow / 40);
      }
    }
  } else if (type === 'bnc') {
    tone(500, 900, 0.06, 'sine', 0.06 * volAt(f[1], f[2]));
  } else if (type === 'zip' || type === 'hooked') {
    const pv = G.pv.get(f[1]);
    if (pv) tone(1200, 400, 0.12, 'square', 0.06 * volAt(pv.x, pv.z));
  } else if (type === 'shake') {
    burst(f[1], 0.1, f[2], 0xb8a07a, 3, 1.5, 0.08);
    noise(0.15, 0.06 * volAt(f[1], f[2]), 700);
  } else if (type === 'goal') {
    const ours = f[1] === G.myTeam;
    G.banner = { text: `<span style="color:${ours ? '#7ab8ff' : '#ff7a7a'}">GOAL!</span><small>${ours ? 'Your team scored ⚽' : 'The enemy scored'}</small>`, until: performance.now() + 2200 };
    [523, 659, 784].forEach((fr, i) => setTimeout(() => tone(fr, fr, 0.18, 'triangle', 0.12), i * 120));
    navigator.vibrate?.(100);
  } else if (type === 'ballout') {
    G.banner = { text: '<small>Ball fell off! It respawns in the middle.</small>', until: performance.now() + 1500 };
  } else if (type === 'fall') {
    if (f[1] === myId) { tone(600, 80, 0.8, 'sine', 0.15); navigator.vibrate?.(150); }
  } else if (type === 'boom') {
    const [, x, z, r, y = 0] = f;
    boom(x, z, r, 0xffa030, y);
    burst(x, y + 0.3, z, 0xffc040, 6 + r * 3, 3 + r);
    sfx.boom(volAt(x, z));
    G.shake = Math.min(0.6, G.shake + r * 0.15 * volAt(x, z));
  } else if (type === 'die') {
    const [, x, z, id, killer, y = 0, kvx = 0, kvy = 0, kvz = 0] = f;
    if (!G.pv.get(id)) addFeed(killer, id, y < -1);
    const pv = G.pv.get(id);
    if (pv) {
      const seen = pv.root.visible || id === myId;
      const sx = seen ? pv.x : x, sz = seen ? pv.z : z, sy = seen ? pv.y : y;
      // always give the body a fun push
      let vx = kvx * 1.2, vz = kvz * 1.2;
      if (Math.hypot(vx, vz) < 3) { const a2 = Math.random() * 6.28; vx += Math.cos(a2) * 3; vz += Math.sin(a2) * 3; }
      spawnRagdoll(pv.brawler, sx, sy, sz, pv.a, vx, Math.max(kvy, 3) + 2, vz);
      burst(sx, sy + 0.6, sz, S.BRAWLERS[pv.brawler].color, 6, 3, 0.12);
    }
    sfx.die(volAt(x, z));
    if (id === myId) { G.spectate = killer || null; navigator.vibrate?.([60, 40, 60]); }
    addFeed(killer, id, y < -1);
  } else if (type === 'heal') {
    const [, x, z, amt, id] = f;
    const hp = G.pv.get(id);
    boom(x, z, 1.2, 0x5dff7a, hp ? hp.y : 0);
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
    if (pv) { boom(pv.x, pv.z, 1.0, 0xffe14d, pv.y); sfx.super(volAt(pv.x, pv.z)); }
  } else if (type === 'gem') {
    burst(f[1], 0.5, f[2], 0xc061ff, 5, 2, 0.1);
  }
}

function addFeed(killerId, victimId, fell) {
  const k = G.pv.get(killerId), v = G.pv.get(victimId);
  if (!v) return;
  const col = (pv) => (pv.id === myId ? '#9dff9d' : pv.team === G.myTeam ? '#9cc9ff' : '#ff9c9c');
  const nm = (pv) => `<span style="color:${col(pv)}">${S.BRAWLERS[pv.brawler].icon} ${esc(pv.name)}</span>`;
  const d = document.createElement('div');
  d.className = 'kf';
  d.innerHTML = (k && k !== v ? nm(k) + ' ' : '') + (fell ? '🕳️' : '💥') + ' ' + nm(v);
  const feed = $('feed');
  feed.prepend(d);
  while (feed.childElementCount > 4) feed.lastChild.remove();
  setTimeout(() => d.remove(), 5000);
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
  A.group.position.set(G.me.x, G.me.y + 0.05, G.me.z);
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
  } else if (spec.type === 'lob' || spec.type === 'leap' || spec.type === 'rocket') {
    const d = Math.max(spec.type === 'rocket' ? 1.1 : 0, clamp(len, 0.12, 1) * range);
    A.circle.visible = A.fill.visible = true;
    A.circle.position.set(wx / (Math.hypot(wx, wz) || 1) * d, 0, wz / (Math.hypot(wx, wz) || 1) * d);
    A.fill.position.copy(A.circle.position);
    A.circle.scale.setScalar(spec.splash); A.fill.scale.setScalar(spec.splash);
    A.line.visible = true;
    A.line.scale.set(spec.type === 'rocket' ? 0.3 : 0.12, 1, d);
  } else if (spec.type === 'heal') {
    A.circle.visible = A.fill.visible = true;
    A.circle.position.set(0, 0, 0); A.fill.position.set(0, 0, 0);
    A.circle.scale.setScalar(spec.range); A.fill.scale.setScalar(spec.range);
  }
}

// ============ input ============
const ptr = { move: null, atk: null, sup: null, jump: null };
const keys = new Set();
let mouse = { x: 0, y: 0, active: 0, world: null };
const joyR = () => Math.min(window.innerWidth, window.innerHeight) * 0.13;
function btnInfo(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; }
const inGameInput = () => G && !G.endShown && !$('hud').classList.contains('hidden');

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('pointerdown', (e) => {
  initAudio();
  if (!inGameInput() || e.target.closest?.('#respawnPick, #fsBtn')) return;
  if (e.pointerType === 'mouse') {
    mouse.active = performance.now();
    if (e.button === 0) fireAtMouse(false);
    else if (e.button === 2) fireAtMouse(true);
    return;
  }
  const p = { id: e.pointerId, x: e.clientX, y: e.clientY };
  const jb = btnInfo($('jumpBtn'));
  if (!ptr.jump && Math.hypot(e.clientX - jb.x, e.clientY - jb.y) < jb.r * 1.3) {
    ptr.jump = p; G.jumpQueued = true; updateBtnStates(); return;
  }
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
  if (ptr.jump && ptr.jump.id === e.pointerId) ptr.jump = null;
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
  if (e.code === 'Space' && !e.repeat) G.jumpQueued = true;
  if (e.code === 'KeyF' && !e.repeat) autoFire(false);
  if ((e.code === 'KeyE' || e.code === 'KeyQ') && !e.repeat) { if (performance.now() - mouse.active < 4000) fireAtMouse(true); else autoFire(true); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function updateBtnStates() {
  $('atkBtn').classList.toggle('held', !!ptr.atk && !ptr.atk.free);
  $('superBtn').classList.toggle('held', !!ptr.sup);
  $('jumpBtn').classList.toggle('held', !!ptr.jump);
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
  if (!me.alive || me.leaping) return false;
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
  if (!best && G.mode === 'ball') {
    for (const o of G.objs.values()) {
      if (o.type !== 'ball') continue;
      const d = Math.hypot(o.x - G.me.x, o.z - G.me.z);
      if (d < range * 1.15) { bd = d; best = [o.x, o.z]; }
    }
  }
  if (!best && G.mode === 'showdown') {
    const { w, t } = G.map;
    t.forEach((ch, i) => {
      if (ch !== 'X') return;
      const x = (i % w) + 0.5, z = Math.floor(i / w) + 0.5, d = Math.hypot(x - G.me.x, z - G.me.z);
      if (d < bd) { bd = d; best = [x, z]; }
    });
  }
  const isLob = spec.type === 'lob' || spec.type === 'leap' || spec.type === 'rocket';
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
  if (me.alive) {
    const [mx, my] = moveInput();
    const [wx, wz] = toWorld(mx, my);
    const spd = S.BRAWLERS[G.myBrawler].speed * (me.slowed ? 0.55 : 1);
    const holdJump = !!ptr.jump || keys.has('Space');
    const jet = !!S.BRAWLERS[G.myBrawler].jet;
    let jump = G.jumpQueued || holdJump;
    G.jumpQueued = false;
    const wasGrounded = me.grounded;
    // fixed small steps so physics feels the same on every phone
    let left = dt;
    while (left > 1e-4) {
      const h = Math.min(left, 1 / 60);
      S.stepBody(G.map, me, wx, wz, spd, jump, h, jet && holdJump);
      jump = false;
      left -= h;
    }
    if (wasGrounded && !me.grounded && me.vy > 5 && !me.leaping) tone(300, 600, 0.12, 'sine', 0.06);
    if (me.y < -30) me.y = -30;
    if (me.bounced) { me.bounced = false; tone(200, 900, 0.25, 'sine', 0.12); }
    if (jet && holdJump && !me.grounded && me.fuel > 0 && Math.random() < 0.5) burst(me.x, me.y + 0.3, me.z, 0xff9a2a, 1, 0.8, 0.08);
    if ((wx || wz) && !(now - (me.aimHold || 0) < 350) && !ptr.atk && !ptr.sup) me.a = Math.atan2(wx, wz);
    if (now - G.lastPos > 33) {
      G.lastPos = now;
      send({ t: 'pos', x: r2(me.x), z: r2(me.z), y: r2(me.y), g: me.grounded ? 1 : 0, s: me.stun > 0 ? 1 : 0, a: r2(me.a) });
    }
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
    let airborne, stunned;
    if (pv.id === myId) {
      pv.x = G.me.x; pv.z = G.me.z; pv.y = G.me.y;
      pv.a = lerpAngle(pv.a, G.me.a, Math.min(1, dt * 20));
      airborne = !G.me.grounded; stunned = G.me.stun > 0;
    } else {
      const ea = a.pm.get(pv.id), eb = b.pm.get(pv.id) || e;
      let x = eb[1], z = eb[2], y = eb[12], ang = eb[3];
      if (ea && Math.hypot(ea[1] - eb[1], ea[2] - eb[2]) < 3) {
        x = ea[1] + (eb[1] - ea[1]) * k; z = ea[2] + (eb[2] - ea[2]) * k; y = ea[12] + (eb[12] - ea[12]) * k;
        ang = lerpAngle(ea[3], eb[3], k);
      }
      pv.x = x; pv.z = z; pv.y = y;
      pv.a = lerpAngle(pv.a, ang, Math.min(1, dt * 15));
      airborne = !!(e[6] & 4); stunned = !!(e[6] & 16);
    }
    const moved = Math.hypot(pv.x - pv.px, pv.z - pv.pz);
    pv.px = pv.x; pv.pz = pv.z;
    if (moved > 0.005 && !airborne) pv.phase += dt * 14; else pv.phase *= 0.8;
    if (airborne) pv.airT += dt;
    else { if (pv.airT > 0.4) burst(pv.x, pv.y + 0.05, pv.z, 0xd8c8a0, 5, 2.5, 0.1); pv.airT = 0; }
    // tumble while flying through the air after a big hit
    if (airborne && pv.tumble > 0.3) { pv.tumble = Math.min(1, pv.tumble + dt * 3); pv.spin += dt * 11 * pv.tumble; }
    else { pv.tumble = Math.max(0, pv.tumble - dt * 4); if (pv.tumble === 0) pv.spin = 0; }
    pv.root.position.set(pv.x, 0, pv.z);
    pv.model.position.y = pv.y + Math.abs(Math.sin(pv.phase)) * 0.09 + (pv.spin ? 0.5 : 0);
    pv.model.rotation.y = pv.a;
    pv.recoil = Math.max(0, pv.recoil - dt * 6);
    pv.model.scale.set(1 + pv.recoil * 0.12, 1 - pv.recoil * 0.1, 1 + pv.recoil * 0.12);
    pv.model.rotation.x = -pv.recoil * 0.15 + pv.spin;
    const g = S.groundAt(G.map, pv.x, pv.z);
    pv.shadow.visible = pv.ring.visible = g > -1;
    pv.shadow.position.y = g + 0.015; pv.ring.position.y = g + 0.03;
    pv.shadow.scale.setScalar(0.45 * Math.max(0.4, 1 - (pv.y - g) * 0.15));
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
    p.mesh.position.set(p.x + p.vx * el, p.y ?? 0.55, p.z + p.vz * el);
    p.mesh.rotation.y = Math.atan2(p.vx, p.vz);
    if (TRAIL.has(p.kind) && now - (p.lastTrail || 0) > 35) {
      p.lastTrail = now;
      smoke(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z);
    }
    if (p.rope) {
      const o = G.pv.get(p.owner);
      if (o) {
        const pos = p.rope.geometry.attributes.position;
        pos.setXYZ(0, o.x, o.y + 0.7, o.z); pos.setXYZ(1, p.mesh.position.x, p.mesh.position.y, p.mesh.position.z);
        pos.needsUpdate = true;
      }
    }
  }
  for (const l of G.lobs.values()) {
    const delay = l.owner === myId ? 0 : 0.1;
    const k = clamp((l.t + (now - l.recv) / 1000 - delay) / l.dur, 0, 1);
    const x = l.sx + (l.tx - l.sx) * k, z = l.sz + (l.tz - l.sz) * k;
    const h = 1.2 + Math.hypot(l.tx - l.sx, l.tz - l.sz) * 0.25;
    const sy = l.sy ?? 0.5, ty = l.ty ?? 0;
    l.mesh.position.set(x, sy + (ty - sy) * k + 4 * h * k * (1 - k), z);
    l.mesh.rotation.x += 0.2;
    if ((l.mesh.userData.size || 0) > 0.3 && now - (l.lastTrail || 0) > 50) { l.lastTrail = now; smoke(l.mesh.position.x, l.mesh.position.y, l.mesh.position.z); }
    l.shadow.position.set(x, Math.max(0, S.groundAt(G.map, x, z, 0)) + 0.03, z);
  }
}

function smoke(x, y, z) {
  if (G.parts.length > 220) return;
  const m = new THREE.Mesh(geo.sphLo, basicMat(0xcfcfcf, 0.6));
  m.scale.setScalar(0.09 + Math.random() * 0.05);
  m.position.set(x, y, z);
  G.world.add(m);
  G.parts.push({ m, vx: (Math.random() - 0.5) * 0.6, vy: 0.6, vz: (Math.random() - 0.5) * 0.6, life: 0.45, g: 0, floor: -99, grow: 1.5 });
}

function updateMisc(dt, now) {
  const t = now / 1000;
  for (const it of G.items.values()) {
    if (it.gy === undefined || it.gx !== it.x) { it.gy = Math.max(0, S.groundAt(G.map, it.x, it.z, 0)); it.gx = it.x; }
    it.mesh.position.set(it.x, it.gy + 0.45 + Math.sin(t * 3 + it.x) * 0.08, it.z);
    it.mesh.rotation.y = t * 2;
  }
  if (G.mineCrystal) G.mineCrystal.rotation.y = t;
  G.map.time = now / 1000 + G.timeOff;
  G.map.plats.forEach((pl, i) => {
    const [px, pz] = S.platPos(pl, G.map.time);
    G.platMeshes[i].position.set(px, -0.25, pz);
  });
  for (const o of G.objs.values()) {
    const el = clamp((now - o.recv) / 1000, 0, 0.1);
    const x = o.x + o.vx * el, z = o.z + o.vz * el;
    o.mesh.position.set(x, o.y + o.r, z);
    if (o.type === 'ball') { o.mesh.rotation.x += (o.vz * dt) / o.r; o.mesh.rotation.z -= (o.vx * dt) / o.r; }
    else o.mesh.rotation.y += (Math.abs(o.vx) + Math.abs(o.vz)) * dt * 0.3;
    const g = S.groundAt(G.map, x, z, 0);
    o.sh.visible = g > -1;
    o.sh.scale.setScalar(o.r * Math.max(0.4, 1 - (o.y - g) * 0.15));
    o.sh.position.set(x, g + 0.02, z);
  }
  for (const mesh of G.fields.values()) if (mesh.userData.well) { mesh.rotation.y += dt * 4; mesh.material.opacity = 0.45 + Math.sin(t * 10) * 0.15; }
  if (G.hill && G.sc) {
    const c = G.sc.ctrl;
    G.hill.material.color.setHex(c === G.myTeam ? 0x3a8dff : c === -2 ? 0xffd23f : c >= 0 ? 0xff3b3b : 0xffffff);
  }
  updateRagdolls(dt);
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.life -= dt; p.vy -= 14 * dt * (p.g ?? 1);
    if (p.grow) p.m.scale.multiplyScalar(1 + p.grow * dt);
    p.m.position.x += p.vx * dt; p.m.position.y = Math.max(p.floor + 0.05, p.m.position.y + p.vy * dt); p.m.position.z += p.vz * dt;
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
  let tx = G.me.x, tz = G.me.z, ty = G.me.y;
  if (!G.me.alive && G.mode === 'showdown') {
    let pv = G.spectate && G.pv.get(G.spectate);
    if (!pv || !pv.root.visible) {
      pv = [...G.pv.values()].find((q) => q.root.visible);
      G.spectate = pv ? pv.id : null;
    }
    if (pv) { tx = pv.x; tz = pv.z; ty = pv.y; }
  }
  const { w, h } = G.map;
  tx = clamp(tx, Math.min(w / 2, 6), Math.max(w / 2, w - 6));
  tz = clamp(tz, 2, h - 2);
  ty = clamp(ty, 0, 2.5);
  if (!G.camT) G.camT = { x: tx, z: tz };
  const k = Math.min(1, dt * 6);
  G.camT.x += (tx - G.camT.x) * k; G.camT.z += (tz - G.camT.z) * k;
  G.camY += (ty * 0.6 - G.camY) * Math.min(1, dt * 3);
  const asp = window.innerWidth / window.innerHeight;
  const zoom = asp < 1.3 ? Math.min(2.1, 1.3 / asp) : 1;
  const sgn = G.flip ? -1 : 1;
  G.shake = Math.max(0, G.shake - dt * 1.5);
  const sh = G.shake * G.shake * 1.2;
  const lx = G.camT.x + (Math.random() - 0.5) * sh, lz = G.camT.z - 1.2 * sgn + (Math.random() - 0.5) * sh;
  camera.position.set(lx, 12.5 * zoom + G.camY, lz + 7.5 * zoom * sgn);
  camera.lookAt(lx, G.camY, lz);
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
    const hp = e[4], max = e[5], pct = e[13] || 0;
    const txt = hp + '|' + max + '|' + e[7] + '|' + pct;
    if (pv.lastTxt !== txt) {
      pv.lastTxt = txt;
      if (G.mode === 'ringout') {
        pv.hpFill.parentElement.style.display = 'none';
        pv.hpt.textContent = pct + '%';
        pv.hpt.className = 'hpt pct';
        pv.hpt.style.color = `hsl(${Math.max(0, 60 - pct * 0.5)}, 100%, ${Math.max(50, 90 - pct * 0.3)}%)`;
      } else {
        pv.hpFill.style.width = clamp((hp / max) * 100, 0, 100) + '%';
        pv.hpt.textContent = hp;
      }
      pv.gemEl.textContent = e[7] > 0 ? (G.mode === 'showdown' ? '🟩' : '💎') + ' ' + e[7] : '';
    }
    if (pv.id === myId) {
      const am = G.me.ammo;
      pv.ammoEls.forEach((el, i) => { el.style.width = clamp(am - i, 0, 1) * 100 + '%'; });
      if (pv.fuelEl) pv.fuelEl.style.width = clamp(G.me.fuel / S.JET_FUEL, 0, 1) * 100 + '%';
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
  } else if (G.mode === 'bounty' || G.mode === 'ringout' || G.mode === 'ball' || G.mode === 'koth') {
    const ic = { bounty: '⭐', ringout: '🕳️', ball: '⚽', koth: '👑' }[G.mode];
    html = `<span class="pill blue">${ic} ${sc.s[mine]}</span><span class="time">${fmtTime(sc.tl)}</span><span class="pill red">${sc.s[theirs]} ${ic}</span>`;
    if (G.mode === 'koth') {
      const c = sc.ctrl;
      center = c === G.myTeam ? '<small style="color:#7ab8ff">👑 Your team holds the hill!</small>' : c === -2 ? '<small style="color:#ffd23f">⚔️ Hill contested!</small>'
        : c >= 0 ? '<small style="color:#ff7a7a">The enemy holds the hill! Knock them off!</small>' : '';
    }
  } else {
    html = `<span class="time">💀 ${sc.alive} left</span>${me.gems ? `<span class="time">🟩 ${me.gems}</span>` : ''}`;
    if (sc.gas > 0 && sc.gas < 3) center = `<small>☠️ The poison gas is closing in!</small>`;
  }
  if (performance.now() < G.banner.until) center = G.banner.text;
  if (!me.alive) center = G.mode === 'showdown' ? 'Knocked out!<small>Spectating…</small>' : `Respawning in ${me.respawn}<small>Tap a brawler below to switch</small>`;
  const showPick = !me.alive && G.mode !== 'showdown' && !G.endShown;
  if (showPick !== G.pickShown) { G.pickShown = showPick; $('respawnPick').classList.toggle('hidden', !showPick); if (showPick) renderRespawnPick(); }
  if (G.lastScoreHtml !== html) { $('score').innerHTML = html; G.lastScoreHtml = html; }
  if (G.lastCenter !== center) { $('center').innerHTML = center; G.lastCenter = center; }
  const sb = $('superBtn');
  const ready = me.superC >= 1;
  sb.classList.toggle('ready', ready);
  sb.style.setProperty('--p', Math.round(me.superC * 100) + '%');
  if (ready && !G.superWasReady && me.alive) sfx.ready();
  G.superWasReady = ready;
}

function renderRespawnPick() {
  const el = $('respawnPick');
  el.innerHTML = '';
  for (const k of BK) {
    const b = S.BRAWLERS[k];
    const d = document.createElement('div');
    d.className = 'rp' + (k === selBrawler ? ' sel' : '');
    d.innerHTML = `${b.icon}<small>${b.name}</small>`;
    d.onclick = () => { selBrawler = k; store.set('ts_brawler', k); send({ t: 'pick', brawler: k }); renderRespawnPick(); };
    el.appendChild(d);
  }
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
  const best = (f) => m.stats.reduce((a, b) => (f(b) > f(a) ? b : a), m.stats[0]);
  const awards = [];
  const mvp = best((s) => s.kills * 2 + (s.pitKills || 0) + (s.dmg || 0) / 1500 - s.deaths * 0.5);
  if (mvp) awards.push(['🏆 MVP', mvp]);
  const pit = best((s) => s.pitKills || 0);
  if (pit && pit.pitKills > 0) awards.push([`🕳️ Pit Master (${pit.pitKills})`, pit]);
  const air = best((s) => s.airHits || 0);
  if (air && air.airHits > 0) awards.push([`✈️ Air Ace (${air.airHits} air hits)`, air]);
  const dmg = best((s) => s.dmg || 0);
  if (dmg && dmg.dmg > 0 && m.mode !== 'ringout') awards.push([`💥 Damage King (${dmg.dmg})`, dmg]);
  $('awards').innerHTML = awards.map(([t, s]) => `<div class="award${s.id === myId ? ' me' : ''}">${t}<b>${S.BRAWLERS[s.brawler].icon} ${esc(s.name)}</b></div>`).join('');
  $('rematchBtn').classList.toggle('hidden', !lobby || lobby.hostId !== myId);
  if (win) sfx.ready();
  showScreen('end');
}
