// Code shared by the server and the browser client.

export const TICK = 30;
export const PLAYER_R = 0.42;
export const BOX_HP = 2600;
export const GAS_START = 40;
export const GAS_STEP = 3.5;
export const GAS_DPS = 1000;
export const MAX_AMMO = 3;

export const MODES = {
  gemgrab: { name: 'Gem Grab', icon: '💎', desc: 'Grab 10 gems and hold them for 15s.' },
  bounty: { name: 'Bounty', icon: '⭐', desc: 'First team to 10 knockouts wins.' },
  showdown: { name: 'Showdown', icon: '💀', desc: 'Everyone for themselves. Last one standing!' },
};

// attack types: burst (bullets one after another), spread (shotgun), lob (thrown over walls),
// split (bullet that splits on impact), wave (wide piercing), leap (jump), heal
export const BRAWLERS = {
  blaze: {
    name: 'Blaze', icon: '🤠', color: 0xf2a33a, role: 'Sharpshooter', hp: 3000, speed: 3.4, reload: 1.5, superCost: 4200,
    desc: 'Long burst of bullets. Super shreds walls.',
    attack: { type: 'burst', count: 6, dmg: 330, range: 9, speed: 20, spread: 0.035, interval: 0.07, r: 0.17 },
    super: { type: 'burst', count: 12, dmg: 330, range: 11, speed: 22, spread: 0.05, interval: 0.05, r: 0.22, breakWalls: true },
  },
  bruno: {
    name: 'Bruno', icon: '💥', color: 0x9b59d0, role: 'Brawler', hp: 3800, speed: 3.4, reload: 1.5, superCost: 3300,
    desc: 'Shotgun blast, brutal up close. Super knocks enemies back.',
    attack: { type: 'spread', count: 5, dmg: 330, range: 6, speed: 17, arc: 0.6, r: 0.2 },
    super: { type: 'spread', count: 9, dmg: 360, range: 7.5, speed: 18, arc: 0.75, r: 0.26, knock: 3, breakWalls: true },
  },
  pip: {
    name: 'Pip', icon: '💣', color: 0xe8d44d, role: 'Thrower', hp: 2600, speed: 3.4, reload: 1.7, superCost: 3000,
    desc: 'Lobs bombs over walls. Super is a huge barrel bomb.',
    attack: { type: 'lob', count: 2, dmg: 950, range: 7.5, splash: 1.3, dur: 0.6, sep: 0.55 },
    super: { type: 'lob', count: 1, dmg: 2000, range: 8, splash: 2.3, dur: 0.8, breakWalls: true, knock: 3 },
  },
  tank: {
    name: 'Tank', icon: '🥊', color: 0x3d7be0, role: 'Heavyweight', hp: 6000, speed: 3.55, reload: 1.1, superCost: 4400,
    desc: 'Huge health, fast punches. Super: flying elbow drop!',
    attack: { type: 'burst', count: 4, dmg: 400, range: 2.9, speed: 14, spread: 0.18, interval: 0.08, r: 0.32 },
    super: { type: 'leap', range: 8, dmg: 1100, splash: 2.1, dur: 0.65, knock: 3, breakWalls: true },
  },
  cactus: {
    name: 'Cactus', icon: '🌵', color: 0x4caf50, role: 'Sniper', hp: 2600, speed: 3.3, reload: 1.6, superCost: 3600,
    desc: 'Needle ball that splits into spikes. Super makes a slowing field.',
    attack: { type: 'split', dmg: 600, range: 7.5, speed: 14, r: 0.26, splitCount: 6, splitDmg: 420, splitRange: 2.6 },
    super: { type: 'lob', count: 1, dmg: 0, range: 8, splash: 2.6, dur: 0.7, field: { r: 2.6, dur: 4.5, dps: 450 } },
  },
  melody: {
    name: 'Melody', icon: '🎸', color: 0xe8607a, role: 'Healer', hp: 3600, speed: 3.3, reload: 1.6, superCost: 4000,
    desc: 'Wide sound wave hits everyone it passes. Super heals the team.',
    attack: { type: 'wave', dmg: 720, range: 7, speed: 12, r: 1.0, pierce: true },
    super: { type: 'heal', amount: 2600, range: 8 },
  },
};

// ---------- maps ----------
// '#' wall, 'B' bush, 'W' water, 'X' power cube box, '.' floor, '1'/'2' team spawns, 'G' gem mine
const GEM_TOP = [
  'BB.....2.2.2.....BB',
  'B.................B',
  '...####.....####...',
  '...................',
  'BB.....WWWWW.....BB',
  'BB...............BB',
  '....##.......##....',
  '....#BB.....BB#....',
  '......B.....B......',
  '.BB.............BB.',
  '.##......#......##.',
  '........BBB........',
  '...BB.........BB...',
];
const GEM_MID = '...##....G....##...';
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
  const shapes = [[[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [0, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[0, 0], [1, 0], [2, 0], [3, 0]]];
  for (let i = 0; i < 9; i++) {
    const s = shapes[(rand() * shapes.length) | 0], c = (rand() * 14) | 0, r = (rand() * 14) | 0;
    for (const [dc, dr] of s) put(c + dc, r + dr, '#');
  }
  for (let i = 0; i < 9; i++) {
    const c = (rand() * 15) | 0, r = (rand() * 15) | 0, rad = 1 + rand() * 1.4;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
      if (dc * dc + dr * dr <= rad * rad && q[r + dr]?.[c + dc] === '.') put(c + dc, r + dr, 'B');
  }
  for (let i = 0; i < 2; i++) {
    const c = 2 + ((rand() * 11) | 0), r = 2 + ((rand() * 11) | 0);
    put(c, r, 'W'); put(c + 1, r, 'W'); put(c, r + 1, 'W'); put(c + 1, r + 1, 'W');
  }
  for (let i = 0; i < 5; i++) put(1 + ((rand() * 14) | 0), 1 + ((rand() * 14) | 0), 'X');
  const rows = [];
  for (let r = 0; r < N; r++) {
    let s = '';
    for (let c = 0; c < N; c++) s += q[Math.min(r, N - 1 - r)][Math.min(c, N - 1 - c)];
    rows.push(s.split(''));
  }
  // spawns on a ring
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
    else if (ch === 'G') { mine = [c + 0.5, r + 0.5]; ch = '.'; }
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
export const SOLID = { '#': 1, W: 1, X: 1 };
export const SHOT_BLOCK = { '#': 1, X: 1 };

export function circleHits(map, x, z, rad) {
  const c0 = Math.floor(x - rad), c1 = Math.floor(x + rad), r0 = Math.floor(z - rad), r1 = Math.floor(z + rad);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (!SOLID[tileAt(map, c, r)]) continue;
    const nx = Math.max(c, Math.min(x, c + 1)), nz = Math.max(r, Math.min(z, r + 1));
    const dx = x - nx, dz = z - nz;
    if (dx * dx + dz * dz < rad * rad) return true;
  }
  return false;
}

export function moveCircle(map, x, z, dx, dz, rad = PLAYER_R) {
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / 0.15));
  const sx = dx / steps, sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    const bx = circleHits(map, x + sx, z, rad), bz = circleHits(map, x, z + sz, rad);
    if (!bx) x += sx;
    if (!bz) z += sz;
    // corner slide: if blocked on the main axis, nudge sideways around the corner
    if (bx && !bz && Math.abs(sz) < 1e-6) {
      for (const n of [0.06, -0.06]) if (!circleHits(map, x + sx, z + n, rad)) { z += n; break; }
    } else if (bz && !bx && Math.abs(sx) < 1e-6) {
      for (const n of [0.06, -0.06]) if (!circleHits(map, x + n, z + sz, rad)) { x += n; break; }
    }
  }
  return [x, z];
}

export function shotClear(map, x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.25);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (SHOT_BLOCK[tileAt(map, Math.floor(x0 + (x1 - x0) * k), Math.floor(z0 + (z1 - z0) * k))]) return false;
  }
  return true;
}

export function walkClear(map, x0, z0, x1, z1, rad = PLAYER_R) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.3);
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    if (circleHits(map, x0 + (x1 - x0) * k, z0 + (z1 - z0) * k, rad)) return false;
  }
  return true;
}

export function inBush(map, x, z) {
  return tileAt(map, Math.floor(x), Math.floor(z)) === 'B';
}
