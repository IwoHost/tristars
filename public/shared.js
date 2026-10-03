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
export const BOUNCE_V = 15;      // bounce pads launch you this hard
export const JET_FUEL = 1.6;     // seconds of jetpack thrust
export const AIR_BONUS = 1.25;   // hitting someone in the air does extra damage

export const MODES = {
  gemgrab: { name: 'Gem Grab', icon: '💎', desc: 'Grab 10 gems and hold them for 15s.', team: true },
  ringout: { name: 'Ring Out', icon: '🕳️', desc: 'No health! Hits raise your %, the higher it is the further you fly. Knock enemies off the island.', team: true },
  ball: { name: 'Rocket Ball', icon: '⚽', desc: 'Shoot and blast the ball into the enemy goal. First to 3.', team: true },
  koth: { name: 'King of the Hill', icon: '👑', desc: 'Stand on the hill to score. First team to 60.', team: true },
  bounty: { name: 'Bounty', icon: '⭐', desc: 'First team to 10 knockouts. Knock enemies into the pits!', team: true },
  showdown: { name: 'Showdown', icon: '💀', desc: 'Everyone for themselves. Last one standing!', team: false },
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
  hooky: {
    name: 'Hooky', icon: '🪝', color: 0x2fa8a0, role: 'Grappler', hp: 3400, speed: 3.5, reload: 1.1, superCost: 3500, weight: 1,
    desc: 'Hook a wall to zip over to it. Hook an enemy to yank them to you!',
    attack: { type: 'hook', dmg: 450, range: 8.5, speed: 24, r: 0.25, pull: 15, yank: 9 },
    super: { type: 'hook', count: 3, spread: 0.3, dmg: 650, range: 9.5, speed: 26, r: 0.3, pull: 18, yank: 13 },
  },
  gravo: {
    name: 'Gravo', icon: '🌀', color: 0x7a5cff, role: 'Gravity Gun', hp: 3300, speed: 3.4, reload: 1.4, superCost: 3800, weight: 1,
    desc: 'Gravity beam pulls enemies in. Super drops a black hole that sucks everyone in, then BOOM.',
    attack: { type: 'wave', dmg: 520, range: 7.5, speed: 16, r: 0.35, kb: -6.5, up: 2.5 },
    super: { type: 'lob', count: 1, dmg: 900, range: 8, splash: 3, dur: 0.7, kb: 13, up: 9, well: { r: 3.4, dur: 2.4, pull: 7 } },
  },
  boing: {
    name: 'Boing', icon: '🏀', color: 0xff8a1f, role: 'Bouncer', hp: 3000, speed: 3.5, reload: 1.5, superCost: 3600, weight: 1,
    desc: 'Balls that bounce off walls. Super: one GIANT bouncy ball.',
    attack: { type: 'spread', count: 3, dmg: 380, range: 10, speed: 13, arc: 0.35, r: 0.22, kb: 3, up: 2, bounces: 2 },
    super: { type: 'spread', count: 1, dmg: 950, range: 18, speed: 12, arc: 0, r: 0.6, kb: 10, up: 6, bounces: 6, pierce: true },
  },
  jet: {
    name: 'Jet', icon: '✈️', color: 0xb0b8c8, role: 'Jetpack', hp: 2800, speed: 3.6, reload: 1.2, superCost: 3600, weight: 0.9, jet: true,
    desc: 'Hold JUMP in the air to fly with the jetpack. Super: missile barrage.',
    attack: { type: 'burst', count: 3, dmg: 360, range: 8, speed: 22, spread: 0.04, interval: 0.09, r: 0.16, kb: 1.8 },
    super: { type: 'rocket', count: 5, spread: 0.35, dmg: 550, range: 8, speed: 16, r: 0.2, splash: 1.3, kb: 7, up: 6 },
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
// 'E' explosive barrel, 'X' power cube box, 'J' bounce pad, 'K' crumbling floor, 'C' pushable crate,
// '.' floor, '1'/'2' team spawns, 'G' gem mine / hill (on high ground), 'Y'/'Z' goals (top/bottom)
// Team maps are written as the top half + middle row, the bottom half is mirrored.
const mirrorRow = (s) => s.split('').reverse().join('').replace(/2/g, '1').replace(/Y/g, 'Z');
const mirror = (top, mid) => [...top, mid, ...top.slice().reverse().map(mirrorRow)];
// moving platforms: a w x d slab sliding between a and b
const plat = (ax, az, bx, bz, w, d, period) => ({ ax, az, bx, bz, w, d, period });

const HILLTOP = { name: 'Hilltop', rows: mirror([
  'BB.....2.2.2.....BB',
  'B.................B',
  '...##.........##...',
  '..mhh.........hhm..',
  '...hh...OOO...hh...',
  'BB.....E...E.....BB',
  '....##.......##....',
  '....#BB.....BB#....',
  'OO....B.....B....OO',
  'OBB.....C.......BBO',
  '.##.............##.',
  '......mhhhhhm......',
  '...BB..hhhhh..BB...',
], '...##..hhGhh..##...') };

const CANYON = { name: 'Bounce Canyon', rows: mirror([
  'hhh....2.2.2....hhh',
  'hhm.............mhh',
  '....BB.......BB....',
  '..##...#...#...##..',
  '..C....J...J....C..',
  'OO.....hhhhh.....OO',
  'OOO....hhhhh....OOO',
  'OO...BBhh.hhBB...OO',
  '......E.....E......',
  '..##.....K.....##..',
  '..#....KKKKK....#..',
  '....J...mhm...J....',
  'BB......hhh......BB',
], '.BB....mhGhm....BB.') };

const PITSTOP = { name: 'Pit Stop', rows: mirror([
  'B......2.2.2......B',
  '...C...........C...',
  '..hhh.........hhh..',
  '..mhh...###...hhm..',
  '...................',
  'BB..E.........E..BB',
  '....OOO.....OOO....',
  '....OOO..J..OOO....',
  '.##......B......##.',
  '...BB.........BB...',
  '.......KKKKK.......',
  '..J....OOOOO....J..',
  '.......OOOOO.......',
], '..##...OOOOO...##..'), plats: [plat(7.5, 13.5, 11.5, 13.5, 2, 2, 6)] };

const ISLE = { name: 'Floating Isle', rows: mirror([
  'OOOOOOOOOOOOOOOOOOO',
  'OOOOOOOOOOOOOOOOOOO',
  'OOO....2.2.2....OOO',
  'OO...C.......C...OO',
  'OO..hh.......hh..OO',
  'OO..hm...J...mh..OO',
  'OO.......E.......OO',
  'OOO..BB.....BB..OOO',
  'OOOO...........OOOO',
  'OOOOO..KKKKK..OOOOO',
  'OOOOO..KKKKK..OOOOO',
  'OOOO.....J.....OOOO',
  'OOOOOO.......OOOOOO',
], 'OOOOOOO..G..OOOOOOO'), plats: [plat(3.5, 10, 3.5, 17, 2, 2, 7), plat(15.5, 17, 15.5, 10, 2, 2, 7)] };

const BRIDGES = { name: 'Sky Bridges', rows: mirror([
  'OOOOOOOOOOOOOOOOOOO',
  'OOOOOOOOOOOOOOOOOOO',
  'OOOO...2.2.2...OOOO',
  'OOOO...........OOOO',
  'OOOO..J.....J..OOOO',
  'OOOOO....C....OOOOO',
  'OOOOOOO.....OOOOOOO',
  'OOOOOOOO...OOOOOOOO',
  'OOOOOOOO.K.OOOOOOOO',
  'OOOOOOOO.K.OOOOOOOO',
  'OOO...OO.K.OO...OOO',
  'OOO.E.OO.K.OO.E.OOO',
  'OOO...OO.K.OO...OOO',
], 'OOO.J.OO...OO.J.OOO'), plats: [plat(6.5, 9, 6.5, 18, 1.6, 1.6, 8), plat(12.5, 18, 12.5, 9, 1.6, 1.6, 8)] };

const PITCH = { name: 'The Pitch', rows: mirror([
  '#######YYYYY#######',
  '....B.........B....',
  '.......2.2.2.......',
  '...##.........##...',
  '...................',
  'BB......###......BB',
  '.......J...J.......',
  '...hh.........hh...',
  '...hm.........mh...',
  'O....B.......B....O',
  'OO...............OO',
  '.....##.....##.....',
  '...C...........C...',
], '..BB...........BB..') };

export const MAPS = {
  gemgrab: [HILLTOP, CANYON],
  koth: [HILLTOP, CANYON],
  bounty: [PITSTOP, HILLTOP, CANYON],
  ringout: [ISLE, BRIDGES],
  ball: [PITCH],
};
export const GEM_MAP = HILLTOP.rows;

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
  for (let i = 0; i < 2; i++) { const c = 1 + ((rand() * 14) | 0), r = 1 + ((rand() * 14) | 0); if (get(c, r) === '.') put(c, r, 'J'); }
  for (let i = 0; i < 2; i++) { const c = 1 + ((rand() * 14) | 0), r = 1 + ((rand() * 14) | 0); if (get(c, r) === '.') put(c, r, 'C'); }
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

export function parseMap(rows, plats = []) {
  const h = rows.length, w = rows[0].length;
  const t = [], spawns = [[], []], goals = [[], []], crates = [];
  let mine = null;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    let ch = rows[r][c];
    if (ch === '1') { spawns[0].push([c + 0.5, r + 0.5]); ch = '.'; }
    else if (ch === '2') { spawns[1].push([c + 0.5, r + 0.5]); ch = '.'; }
    else if (ch === 'G') { mine = [c + 0.5, r + 0.5]; ch = 'h'; }
    else if (ch === 'Z') { goals[0].push([c, r]); ch = '.'; } // bottom goal, defended by team 0
    else if (ch === 'Y') { goals[1].push([c, r]); ch = '.'; } // top goal, defended by team 1
    else if (ch === 'C') { crates.push([c + 0.5, r + 0.5]); ch = '.'; }
    t.push(ch);
  }
  return { w, h, t, spawns, mine, goals, crates, plats, time: 0 };
}

// moving platform position/velocity at the map's current time
export function platPos(p, time) {
  const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * time) / p.period);
  const dk = 0.5 * Math.sin((2 * Math.PI * time) / p.period) * (2 * Math.PI / p.period);
  return [p.ax + (p.bx - p.ax) * k, p.az + (p.bz - p.az) * k, (p.bx - p.ax) * dk, (p.bz - p.az) * dk];
}
export function platAt(map, x, z) {
  if (!map.plats) return null;
  for (const p of map.plats) {
    const [px, pz, vx, vz] = platPos(p, map.time);
    if (Math.abs(x - px) <= p.w / 2 && Math.abs(z - pz) <= p.d / 2) return [vx, vz];
  }
  return null;
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
export const TILE_H = { '.': 0, B: 0, m: 0.6, h: 1.2, O: -50, '#': 2.4, X: 0.9, E: 0.9, J: 0, K: 0 };
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
  if (g < 0 && platAt(map, x, z)) g = 0;
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
  return { x, z, y, vx: 0, vy: 0, vz: 0, grounded: true, stun: 0, leaping: false, fuel: JET_FUEL, bounced: false };
}

// One physics step for a player body. (mx,mz) = wanted move direction (length <= 1).
// thrust = holding jump in the air with a jetpack
export function stepBody(map, b, mx, mz, speed, jump, dt, thrust = false) {
  let ctrl = b.grounded ? (b.stun > 0 ? 2 : 16) : (b.stun > 0 ? 0.8 : 6);
  if (b.leaping) ctrl = 0;
  const k = Math.min(1, ctrl * dt);
  b.vx += (mx * speed - b.vx) * k;
  b.vz += (mz * speed - b.vz) * k;
  b.stun = Math.max(0, b.stun - dt);
  if (jump && b.grounded && !b.leaping) { b.vy = JUMP_V; b.grounded = false; }
  b.vy -= GRAVITY * dt;
  if (thrust && !b.grounded && b.fuel > 0) { b.vy = Math.min(b.vy + 40 * dt, 6.5); b.fuel -= dt; }
  // ride moving platforms
  if (b.grounded) {
    const pv = platAt(map, b.x, b.z);
    if (pv && groundAt(map, b.x, b.z) <= 0.01) { b.x += pv[0] * dt; b.z += pv[1] * dt; }
  }
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
  if (b.grounded) {
    b.fuel = Math.min(JET_FUEL, b.fuel + dt * 0.8);
    if (tileAt(map, Math.floor(b.x), Math.floor(b.z)) === 'J') { b.vy = BOUNCE_V; b.grounded = false; b.bounced = true; }
  }
  return b;
}

// Simple physics for the ball and crates
export function stepObj(map, o, dt, bounce, friction) {
  o.vy -= GRAVITY * dt;
  const [nx, nz, hx, hz] = moveCircle(map, o.x, o.z, o.vx * dt, o.vz * dt, o.r, o.y);
  o.x = nx; o.z = nz;
  if (hx) o.vx = -o.vx * bounce;
  if (hz) o.vz = -o.vz * bounce;
  o.y += o.vy * dt;
  const g = groundAt(map, o.x, o.z, 0.12);
  if (o.y <= g && o.y > g - 1.2) {
    o.y = g;
    if (o.vy < -2.5) o.vy = -o.vy * bounce; else o.vy = 0;
    const f = Math.max(0, 1 - friction * dt);
    o.vx *= f; o.vz *= f;
    if (tileAt(map, Math.floor(o.x), Math.floor(o.z)) === 'J') o.vy = BOUNCE_V * 0.8;
    const pv = platAt(map, o.x, o.z);
    if (pv && g <= 0.01) { o.x += pv[0] * dt; o.z += pv[1] * dt; }
  }
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
