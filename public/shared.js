// Code shared by the server, the host browser and every client.

export const TICK = 30;
export const PLAYER_R = 0.42;
export const BOX_HP = 2600;
export const GAS_START = 40;
export const GAS_STEP = 3.5;
export const GAS_DPS = 1000;
export const MAX_AMMO = 3;

// ---- physics ----
export const GRAVITY = 26;
export const JUMP_V = 9.4;       // ~1.7 tiles high: enough to hop onto high ground
export const STEP = 0.62;        // max height you can walk up without jumping
export const FALL_DEATH = -6;    // fell into a pit
export const BULLET_ALT = 0.7;   // bullets fly this high above whoever shot them
export const BULLET_DROP = 5;    // bullets glide down off ledges this fast

export const MODES = {
  gemgrab: { name: 'Gem Grab', icon: '💎', desc: 'Grab 10 gems and hold them for 15s. The gem mine is on the hill!' },
  bounty: { name: 'Bounty', icon: '⭐', desc: 'First team to 10 knockouts. Knock enemies into the pits!' },
  showdown: { name: 'Showdown', icon: '💀', desc: 'Everyone for themselves. Last one standing!' },
};

// attack types: burst (bullets one after another), spread (shotgun), lob (thrown over walls),
// split (bullet that splits on impact), wave (wide piercing), leap (jump), heal,
// rocket (explodes where you aim; selfKb/selfUp push the shooter too = rocket jumps)
// kb = knockback speed per hit, up = upward launch speed
export const BRAWLERS = {
  blaze: {
    name: 'Blaze', icon: '🤠', color: 0xf2a33a, role: 'Sharpshooter', hp: 3000, speed: 3.4, reload: 1.5, superCost: 4200, weight: 1,
    desc: 'Long burst of bullets. Super shreds walls.',
    attack: { type: 'burst', count: 6, dmg: 330, range: 9, speed: 20, spread: 0.035, interval: 0.07, r: 0.17, kb: 1.3 },
    super: { type: 'burst', count: 12, dmg: 330, range: 11, speed: 22, spread: 0.05, interval: 0.05, r: 0.22, breakWalls: true, kb: 2 },
  },
  bruno: {
    name: 'Bruno', icon: '💥', color: 0x9b59d0, role: 'Brawler', hp: 3800, speed: 3.4, reload: 1.5, superCost: 3300, weight: 1.1,
    desc: 'Shotgun blast that shoves people. Super sends them flying.',
    attack: { type: 'spread', count: 5, dmg: 330, range: 6, speed: 17, arc: 0.6, r: 0.2, kb: 2.4 },
    super: { type: 'spread', count: 9, dmg: 360, range: 7.5, speed: 18, arc: 0.75, r: 0.26, kb: 5, up: 3, breakWalls: true },
  },
  pip: {
    name: 'Pip', icon: '💣', color: 0xe8d44d, role: 'Thrower', hp: 2600, speed: 3.4, reload: 1.7, superCost: 3000, weight: 0.9,
    desc: 'Lobs bombs over walls and cliffs. Super launches everyone sky high.',
    attack: { type: 'lob', count: 2, dmg: 950, range: 7.5, splash: 1.3, dur: 0.6, sep: 0.55, kb: 6, up: 6, selfKb: 5, selfUp: 9 },
    super: { type: 'lob', count: 1, dmg: 2000, range: 8, splash: 2.3, dur: 0.8, breakWalls: true, kb: 12, up: 10, selfKb: 8, selfUp: 13 },
  },
  tank: {
    name: 'Tank', icon: '🥊', color: 0x3d7be0, role: 'Heavyweight', hp: 6000, speed: 3.55, reload: 1.1, superCost: 4400, weight: 1.7,
    desc: 'Huge, heavy, hard to push. Super: flying elbow drop!',
    attack: { type: 'burst', count: 4, dmg: 400, range: 2.9, speed: 14, spread: 0.18, interval: 0.08, r: 0.32, kb: 3.2 },
    super: { type: 'leap', range: 8, dmg: 1100, splash: 2.1, breakWalls: true, kb: 11, up: 8 },
  },
  cactus: {
    name: 'Cactus', icon: '🌵', color: 0x4caf50, role: 'Sniper', hp: 2600, speed: 3.3, reload: 1.6, superCost: 3600, weight: 0.9,
    desc: 'Needle ball that splits into spikes. Super makes a slowing field.',
    attack: { type: 'split', dmg: 600, range: 7.5, speed: 14, r: 0.26, splitCount: 6, splitDmg: 420, splitRange: 2.6, kb: 2.5, splitKb: 1.5 },
    super: { type: 'lob', count: 1, dmg: 0, range: 8, splash: 2.6, dur: 0.7, field: { r: 2.6, dur: 4.5, dps: 450 } },
  },
  rocco: {
    name: 'Rocco', icon: '🚀', color: 0xe0473a, role: 'Rocket Jumper', hp: 3200, speed: 3.5, reload: 1.25, superCost: 3800, weight: 1,
    desc: 'Rockets blow up where you aim. Shoot your own feet to ROCKET JUMP!',
    attack: { type: 'rocket', dmg: 700, range: 8, speed: 15, r: 0.22, splash: 1.6, kb: 8, up: 7, selfKb: 7, selfUp: 12.5 },
    super: { type: 'rocket', count: 3, spread: 0.22, dmg: 800, range: 9, speed: 17, r: 0.25, splash: 2, kb: 11, up: 9, selfKb: 9, selfUp: 14, breakWalls: true },
  },
  melody: {
    name: 'Melody', icon: '🎸', color: 0xe8607a, role: 'Healer', hp: 3600, speed: 3.3, reload: 1.6, superCost: 4000, weight: 1,
    desc: 'Sound wave that pushes everyone it passes. Super heals the team.',
    attack: { type: 'wave', dmg: 720, range: 7, speed: 12, r: 1.0, pierce: true, kb: 5.5, up: 2 },
    super: { type: 'heal', amount: 2600, range: 8 },
  },
};

export const BARREL = { dmg: 1300, splash: 2.4, kb: 13, up: 9, respawn: 25 };

// ---------- maps ----------
// '#' wall, 'B' bush, 'O' pit (fall = knocked out), 'h' high ground, 'm' step (half height),
// 'E' explosive barrel, 'X' power cube box, '.' floor, '1'/'2' team spawns, 'G' gem mine (on high ground)
const GEM_TOP = [
  'BB.....2.2.2.....BB',
  'B.................B',
  '...##.........##...',
  '..mhh.........hhm..',
  '...hh...OOO...hh...',
  'BB.....E...E.....BB',
  '....##.......##....',
  '....#BB.....BB#....',
  'OO....B.....B....OO',
  'OBB.............BBO',
  '.##.............##.',
  '......mhhhhhm......',
  '...BB..hhhhh..BB...',
];
const GEM_MID = '...##..hhGhh..##...';
const mirrorRow = (s) => s.split('').reverse().join('').replace(/2/g, '1');
export const GEM_MAP = [...GEM_TOP, GEM_MID, ...GEM_TOP.slice().reverse().map(mirrorRow)];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random 4-way symmetric showdown map, different every match.
export function genShowdownMap(seed) {
  const N = 31, H = 16, rand = rng(seed);
  const q = [];
  for (let r = 0; r < H; r++) q.push(new Array(H).fill('.'));
  const put = (c, r, ch) => { if (c >= 0 && r >= 0 && c < H && r < H) q[r][c] = ch; };
  const get = (c, r) => (c >= 0 && r >= 0 && c < H && r < H ? q[r][c] : null);
  // hills with steps
  for (let i = 0; i < 3; i++) {
    const c = 1 + ((rand() * 12) | 0), r = 1 + ((rand() * 12) | 0), w = 2 + ((rand() * 2) | 0), h = 2 + ((rand() * 2) | 0);
    for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) put(c + dc, r + dr, 'h');
    if (rand() < 0.5) put(c - 1, r + ((rand() * h) | 0), 'm'); else put(c + ((rand() * w) | 0), r - 1, 'm');
  }
  const shapes = [[[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [0, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[0, 0], [1, 0], [2, 0], [3, 0]]];
  for (let i = 0; i < 7; i++) {
    const s = shapes[(rand() * shapes.length) | 0], c = (rand() * 14) | 0, r = (rand() * 14) | 0;
    for (const [dc, dr] of s) if (get(c + dc, r + dr) === '.') put(c + dc, r + dr, '#');
  }
  for (let i = 0; i < 8; i++) {
    const c = (rand() * 15) | 0, r = (rand() * 15) | 0, rad = 1 + rand() * 1.4;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
      if (dc * dc + dr * dr <= rad * rad && get(c + dc, r + dr) === '.') put(c + dc, r + dr, 'B');
  }
  for (let i = 0; i < 3; i++) {
    const c = 2 + ((rand() * 11) | 0), r = 2 + ((rand() * 11) | 0);
    for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (get(c + dc, r + dr) !== 'h') put(c + dc, r + dr, 'O');
  }
  for (let i = 0; i < 4; i++) { const c = 1 + ((rand() * 14) | 0), r = 1 + ((rand() * 14) | 0); if (get(c, r) === '.') put(c, r, 'X'); }
  for (let i = 0; i < 3; i++) { const c = 1 + ((rand() * 14) | 0), r = 1 + ((rand() * 14) | 0); if (get(c, r) === '.') put(c, r, 'E'); }
  const rows = [];
  for (let r = 0; r < N; r++) {
    let s = '';
    for (let c = 0; c < N; c++) s += q[Math.min(r, N - 1 - r)][Math.min(c, N - 1 - c)];
    rows.push(s.split(''));
  }
  const n = 10;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + 0.3;
    const c = Math.round(15 + Math.cos(ang) * 12), r = Math.round(15 + Math.sin(ang) * 12);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
      if (rows[r + dr] && rows[r + dr][c + dc] !== undefined) rows[r + dr][c + dc] = '.';
    rows[r][c] = '1';
  }
  return rows.map((r) => r.join(''));
}

export function parseMap(rows) {
  const h = rows.length, w = rows[0].length;
  const t = [], spawns = [[], []];
  let mine = null;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    let ch = rows[r][c];
    if (ch === '1') { spawns[0].push([c + 0.5, r + 0.5]); ch = '.'; }
    else if (ch === '2') { spawns[1].push([c + 0.5, r + 0.5]); ch = '.'; }
    else if (ch === 'G') { mine = [c + 0.5, r + 0.5]; ch = 'h'; }
    t.push(ch);
  }
  return { w, h, t, spawns, mine };
}

export function tileAt(map, c, r) {
  if (c < 0 || r < 0 || c >= map.w || r >= map.h) return '#';
  return map.t[r * map.w + c];
}
export function setTile(map, c, r, ch) {
  if (c < 0 || r < 0 || c >= map.w || r >= map.h) return;
  map.t[r * map.w + c] = ch;
}

// top height of each tile type
export const TILE_H = { '.': 0, B: 0, m: 0.6, h: 1.2, O: -50, '#': 2.4, X: 0.9, E: 0.9 };
// things that block movement no matter how high you are
export const BLOCK = { '#': 1, X: 1, E: 1 };
export const tileH = (ch) => TILE_H[ch] ?? 0;

// is (c,r) a wall for something standing at height y?
function solidAt(map, c, r, y) {
  const ch = tileAt(map, c, r);
  return !!BLOCK[ch] || tileH(ch) > y + STEP;
}

export function circleHits(map, x, z, rad, y = 0) {
  const c0 = Math.floor(x - rad), c1 = Math.floor(x + rad), r0 = Math.floor(z - rad), r1 = Math.floor(z + rad);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (!solidAt(map, c, r, y)) continue;
    const nx = Math.max(c, Math.min(x, c + 1)), nz = Math.max(r, Math.min(z, r + 1));
    const dx = x - nx, dz = z - nz;
    if (dx * dx + dz * dz < rad * rad) return true;
  }
  return false;
}

// highest ground under a small footprint around (x,z)
export function groundAt(map, x, z, foot = 0.22) {
  let g = -50;
  for (const [ox, oz] of [[-foot, -foot], [foot, -foot], [-foot, foot], [foot, foot]]) {
    const ch = tileAt(map, Math.floor(x + ox), Math.floor(z + oz));
    if (BLOCK[ch]) continue;
    g = Math.max(g, tileH(ch));
  }
  return g;
}

// returns [x, z, blockedX, blockedZ]
export function moveCircle(map, x, z, dx, dz, rad = PLAYER_R, y = 0) {
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / 0.15));
  const sx = dx / steps, sz = dz / steps;
  let hitX = false, hitZ = false;
  for (let i = 0; i < steps; i++) {
    const bx = circleHits(map, x + sx, z, rad, y), bz = circleHits(map, x, z + sz, rad, y);
    if (!bx) x += sx; else hitX = true;
    if (!bz) z += sz; else hitZ = true;
    // corner slide: if blocked on the main axis, nudge sideways around the corner
    if (bx && !bz && Math.abs(sz) < 1e-6) {
      for (const n of [0.06, -0.06]) if (!circleHits(map, x + sx, z + n, rad, y)) { z += n; break; }
    } else if (bz && !bx && Math.abs(sx) < 1e-6) {
      for (const n of [0.06, -0.06]) if (!circleHits(map, x + n, z + sz, rad, y)) { x += n; break; }
    }
  }
  return [x, z, hitX, hitZ];
}

export function newBody(x, z, y = 0) {
  return { x, z, y, vx: 0, vy: 0, vz: 0, grounded: true, stun: 0, leaping: false };
}

// One physics step for a player body. (mx,mz) = wanted move direction (length <= 1).
export function stepBody(map, b, mx, mz, speed, jump, dt) {
  let ctrl = b.grounded ? (b.stun > 0 ? 2 : 16) : (b.stun > 0 ? 0.8 : 6);
  if (b.leaping) ctrl = 0;
  const k = Math.min(1, ctrl * dt);
  b.vx += (mx * speed - b.vx) * k;
  b.vz += (mz * speed - b.vz) * k;
  b.stun = Math.max(0, b.stun - dt);
  if (jump && b.grounded && !b.leaping) { b.vy = JUMP_V; b.grounded = false; }
  b.vy -= GRAVITY * dt;
  const [nx, nz, hx, hz] = moveCircle(map, b.x, b.z, b.vx * dt, b.vz * dt, PLAYER_R, b.y);
  b.x = nx; b.z = nz;
  // bounce off walls when knocked around
  if (hx) b.vx = b.stun > 0 ? -b.vx * 0.4 : 0;
  if (hz) b.vz = b.stun > 0 ? -b.vz * 0.4 : 0;
  b.y += b.vy * dt;
  const g = groundAt(map, b.x, b.z);
  if (b.y <= g && b.y > g - 1.2) {
    b.y = g;
    if (b.vy < -11 && b.stun > 0) b.vy = -b.vy * 0.3; // bouncy landing when launched
    else { b.vy = 0; b.grounded = true; b.leaping = false; }
  } else b.grounded = false;
  return b;
}

// knockback multiplier: the more hurt you are, the further you fly (Smash style)
export function kbMult(hp, maxHp, weight = 1) {
  return (1 + Math.max(0, 1 - hp / maxHp) * 1.2) / weight;
}

export function shotClear(map, x0, z0, x1, z1, y = 0) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.25);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const ch = tileAt(map, Math.floor(x0 + (x1 - x0) * k), Math.floor(z0 + (z1 - z0) * k));
    if (tileH(ch) >= y + BULLET_ALT - 0.05) return false;
  }
  return true;
}

export function walkClear(map, x0, z0, x1, z1, rad = PLAYER_R, y = 0) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.3);
  for (let i = 1; i <= n; i++) {
    const k = i / n, x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k;
    if (circleHits(map, x, z, rad, y) || pitNear(map, x, z, 0.5)) return false;
  }
  return true;
}

export function pitNear(map, x, z, r) {
  for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]]) if (tileAt(map, Math.floor(x + ox), Math.floor(z + oz)) === 'O') return true;
  return false;
}

export function inBush(map, x, z) {
  return tileAt(map, Math.floor(x), Math.floor(z)) === 'B';
}
