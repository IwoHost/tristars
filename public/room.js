// Game simulation + lobby. Runs on the Node server (LAN mode) or inside the host's browser (room-code mode).
import * as S from './shared.js';

const R = S.PLAYER_R;
const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = (v) => Math.round(v * 100) / 100;
const BOT_NAMES = ['Rusty', 'Ziggy', 'Bolt', 'Nova', 'Pico', 'Mango', 'Taco', 'Fizz', 'Dot', 'Bongo', 'Pixel', 'Noodle'];
const BRAWLER_KEYS = Object.keys(S.BRAWLERS);
const walkable = (ch) => !S.BLOCK[ch] && ch !== 'O';

function findFree(map, x, z) {
  const ok = (px, pz) => { const y = Math.max(0, S.groundAt(map, px, pz)); return !S.circleHits(map, px, pz, R, y) && !S.pitNear(map, px, pz, R); };
  if (ok(x, z)) return [x, z];
  for (let rad = 0.5; rad < 6; rad += 0.5) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const nx = x + Math.cos(a) * rad, nz = z + Math.sin(a) * rad;
      if (ok(nx, nz)) return [nx, nz];
    }
  }
  return [x, z];
}

// ---------------- game ----------------
export class Game {
  constructor(settings, humans, room) {
    this.room = room;
    this.mode = settings.mode;
    this.t = 0;
    this.ended = false;
    this.nid = 1;
    this.rows = this.mode === 'showdown' ? S.genShowdownMap((Math.random() * 1e9) | 0) : S.GEM_MAP;
    this.map = S.parseMap(this.rows);
    this.boxHp = new Map();
    this.barrels = [];
    this.map.t.forEach((ch, i) => {
      if (ch === 'X') this.boxHp.set(i, S.BOX_HP);
      if (ch === 'E') this.barrels.push({ c: i % this.map.w, r: (i / this.map.w) | 0, goneAt: null });
    });
    this.pending = []; // chained barrel explosions
    this.players = new Map();
    this.proj = []; this.lobs = []; this.fields = []; this.items = [];
    this.fx = []; this.tc = [];
    this.score = [0, 0]; this.kills = [0, 0];
    this.cdTeam = -1; this.cdEnd = 0;
    this.nextGem = 4;
    this.gas = 0; this.nextGas = S.GAS_START; this.gasTick = 0;
    this.out = [];
    this.timeLimit = this.mode === 'gemgrab' ? 180 : this.mode === 'bounty' ? 150 : 1e9;
    this.spawnI = [0, 0];
    this.sdSpawns = this.map.spawns[0].slice().sort(() => Math.random() - 0.5);
    for (const c of humans) this.addPlayer(c, false);
    if (settings.bots) this.fillBots();
  }

  stats(p) { return S.BRAWLERS[p.brawler]; }
  hasHumans() { for (const p of this.players.values()) if (!p.bot) return true; return false; }

  fillBots() {
    let bid = 10000;
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const mk = (team) => ({ id: bid++, name: '🤖' + names.pop(), brawler: BRAWLER_KEYS[(Math.random() * BRAWLER_KEYS.length) | 0], team });
    if (this.mode === 'showdown') {
      while (this.players.size < 8) this.addPlayer(mk(0), true);
    } else {
      const cnt = [0, 0];
      for (const p of this.players.values()) cnt[p.team]++;
      const target = Math.max(3, cnt[0], cnt[1]);
      for (let tm = 0; tm < 2; tm++) while (cnt[tm] < target) { this.addPlayer(mk(tm), true); cnt[tm]++; }
    }
  }

  addPlayer(c, bot) {
    const st = S.BRAWLERS[c.brawler] || S.BRAWLERS.blaze;
    const p = {
      id: c.id, name: c.name, brawler: S.BRAWLERS[c.brawler] ? c.brawler : 'blaze', bot,
      team: this.mode === 'showdown' ? 100 + c.id : c.team,
      ...S.newBody(0, 0), a: 0, safeX: 0, safeZ: 0,
      hp: st.hp, maxHp: st.hp, ammo: S.MAX_AMMO, superC: 0, gems: 0, cubes: 0,
      alive: false, respawnAt: 0, lastHurt: -9, lastAtk: -9, reveal: -9, tp: 0, slowUntil: 0,
      lastHitBy: 0, lastHitAt: -99, lastKb: [0, 0, 0], leap: null,
      queue: [], kills: 0, deaths: 0, lastShot: -9,
      ai: { timer: Math.random() * 0.3, mx: 0, mz: 0, jump: false, strafe: Math.random() < 0.5 ? 1 : -1 },
    };
    this.players.set(p.id, p);
    this.spawn(p);
    return p;
  }

  spawn(p) {
    let pos;
    if (this.mode === 'showdown') {
      pos = this.sdSpawns[(this.players.size - 1 + this.out.length) % this.sdSpawns.length];
      const used = new Set([...this.players.values()].filter((q) => q !== p && q.alive).map((q) => `${q.safeX},${q.safeZ}`));
      for (const s of this.sdSpawns) if (!used.has(`${s[0]},${s[1]}`)) { pos = s; break; }
    } else {
      const list = this.map.spawns[p.team];
      pos = list[this.spawnI[p.team]++ % list.length];
    }
    const st = this.stats(p);
    const [x, z] = findFree(this.map, pos[0], pos[1]);
    Object.assign(p, S.newBody(x, z, Math.max(0, S.groundAt(this.map, x, z))));
    p.safeX = pos[0]; p.safeZ = pos[1];
    p.a = this.mode !== 'showdown' && p.team === 0 ? Math.PI : 0;
    p.maxHp = st.hp + p.cubes * 400;
    p.hp = p.maxHp;
    p.alive = true; p.ammo = S.MAX_AMMO; p.queue = []; p.leap = null; p.tp++;
    p.lastHurt = this.t; p.slowUntil = 0; p.lastHitBy = 0;
    this.fx.push(['spawn', r2(p.x), r2(p.z), p.id]);
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.alive) {
      this.dropGems(p);
      if (this.mode === 'showdown') this.out.push(p.id);
    }
    this.players.delete(id);
  }

  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, brawler: p.brawler, team: p.team, bot: p.bot }));
  }

  // ---- input from humans (they simulate their own body and tell us where they are) ----
  onPos(p, m) {
    if (!p.alive || !Number.isFinite(m.x) || !Number.isFinite(m.z) || !Number.isFinite(m.y)) return;
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    if (d < 2.5 && (m.y < -0.5 || !S.circleHits(this.map, m.x, m.z, R * 0.85, m.y))) {
      p.x = m.x; p.z = m.z; p.y = m.y; p.grounded = !!m.g; p.stun = m.s ? 0.2 : 0;
    } else if (d > 0.01) p.tp++; // force client to resync
    if (Number.isFinite(m.a) && this.t - p.lastShot > 0.35) p.a = m.a;
  }

  onAttack(p, m) {
    if (!p.alive || p.leap || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    const isSuper = !!m.sup;
    if (isSuper ? p.superC < 1 : p.ammo < 1 || this.t - p.lastShot < 0.3 || p.queue.length) return;
    this.attack(p, m.x, m.z, isSuper);
  }

  attack(p, ax, az, isSuper) {
    const st = this.stats(p);
    const spec = isSuper ? st.super : st.attack;
    let len = Math.hypot(ax, az);
    let dx, dz;
    if (len < 0.01) { dx = Math.sin(p.a); dz = Math.cos(p.a); len = 1; } else { dx = ax / len; dz = az / len; }
    const f = Math.max(0.12, Math.min(1, len));
    if (isSuper) { p.superC = 0; this.fx.push(['super', p.id]); } else p.ammo -= 1;
    p.lastShot = this.t; p.lastAtk = this.t; p.reveal = this.t + 1.2;
    p.a = Math.atan2(dx, dz);
    this.fx.push(['shot', p.id, isSuper ? 1 : 0]);
    const mul = 1 + 0.1 * p.cubes;
    switch (spec.type) {
      case 'burst':
        for (let i = 0; i < spec.count; i++) p.queue.push({ at: this.t + i * spec.interval, dx, dz, spec, isSuper });
        break;
      case 'spread':
        for (let i = 0; i < spec.count; i++) {
          const ang = p.a + (spec.count > 1 ? (i / (spec.count - 1) - 0.5) * spec.arc : 0);
          this.bullet(p, spec, Math.sin(ang), Math.cos(ang), isSuper, mul);
        }
        break;
      case 'split': case 'wave':
        this.bullet(p, spec, dx, dz, isSuper, mul);
        break;
      case 'rocket': {
        const n = spec.count || 1;
        for (let i = 0; i < n; i++) {
          const ang = p.a + (n > 1 ? (i / (n - 1) - 0.5) * 2 * spec.spread : 0);
          this.bullet(p, { ...spec, range: Math.max(1.1, f * spec.range) }, Math.sin(ang), Math.cos(ang), isSuper, mul);
        }
        break;
      }
      case 'lob': {
        const d = f * spec.range;
        for (let i = 0; i < spec.count; i++) {
          const off = (i - (spec.count - 1) / 2) * (spec.sep || 0);
          const tx = p.x + dx * d + dz * off, tz = p.z + dz * d - dx * off;
          this.lobs.push({
            id: this.nid++, kind: p.brawler + (isSuper ? 'S' : ''), sx: p.x, sz: p.z, sy: p.y + 1.2,
            tx, tz, ty: Math.max(0, S.groundAt(this.map, tx, tz)), t: 0, dur: spec.dur * (0.6 + 0.4 * f),
            spec, owner: p.id, team: p.team, isSuper, mul,
          });
        }
        break;
      }
      case 'leap': {
        const d = f * spec.range;
        const T = 0.85, vy = (S.GRAVITY * T) / 2;
        this.setVelocity(p, (dx * d) / T, vy, (dz * d) / T, true);
        p.leap = { t0: this.t, spec, mul };
        break;
      }
      case 'heal':
        for (const q of this.players.values()) {
          if (!q.alive || q.team !== p.team || dist(p, q) > spec.range) continue;
          const amt = Math.min(spec.amount, q.maxHp - q.hp);
          q.hp += amt;
          this.fx.push(['heal', r2(q.x), r2(q.z), Math.round(amt), q.id]);
        }
        break;
    }
  }

  bullet(p, spec, dx, dz, isSuper, mul, from) {
    const ox = from ? from[0] : p.x + dx * 0.35, oz = from ? from[1] : p.z + dz * 0.35;
    this.proj.push({
      id: this.nid++, kind: from ? 'spike' : p.brawler + (isSuper ? 'S' : ''),
      x: ox, z: oz, y: from ? from[3] : p.y + S.BULLET_ALT, vx: dx * spec.speed, vz: dz * spec.speed, dist: 0, range: spec.range,
      dmg: spec.dmg * mul, r: spec.r, owner: p.id, team: p.team, pierce: !!spec.pierce, hit: new Set(from ? from[2] : []),
      breakWalls: !!spec.breakWalls, kb: spec.kb || 0, up: spec.up || 0, split: spec.splitCount ? spec : null, isSuper, mul,
      rocket: spec.type === 'rocket' ? spec : null,
    });
  }

  // ---- physics pushes ----
  // humans simulate their own body, so they get the push as an event; bots get it directly
  setVelocity(p, vx, vy, vz, leap) {
    if (p.bot) { p.vx = vx; p.vy = vy; p.vz = vz; p.grounded = false; p.leaping = !!leap; }
    this.fx.push(['kb', p.id, r2(vx), r2(vy), r2(vz), 1]);
  }

  impulse(q, dx, dz, kb, up, self) {
    if (!q.alive || (!kb && !up)) return;
    const l = Math.hypot(dx, dz) || 1;
    const m = self ? 1 : S.kbMult(q.hp, q.maxHp, this.stats(q).weight);
    const h = Math.min(20, kb * m);
    const vx = (dx / l) * h, vz = (dz / l) * h, vy = Math.min(13, (up || 0) * m);
    if (q.bot) {
      q.vx += vx; q.vz += vz;
      if (vy > 0) { q.vy = Math.min(14, Math.max(q.vy, 0) * 0.3 + vy); q.grounded = false; }
      q.stun = Math.max(q.stun, 0.3 + 0.025 * Math.hypot(vx, vz));
    }
    q.lastKb = [vx, vy, vz];
    this.fx.push(['kb', q.id, r2(vx), r2(vy), r2(vz), self ? 2 : 0]);
  }

  // ---- damage ----
  damage(target, amount, attacker, isSuper) {
    if (!target.alive) return;
    amount = Math.round(amount);
    if (amount <= 0) return;
    target.hp -= amount; target.lastHurt = this.t; target.reveal = this.t + 0.8;
    if (attacker && attacker !== target) { target.lastHitBy = attacker.id; target.lastHitAt = this.t; }
    this.fx.push(['hit', r2(target.x), r2(target.z), amount, target.id, r2(target.y)]);
    if (attacker && attacker.superC !== undefined && !isSuper && attacker !== target) {
      attacker.superC = Math.min(1, attacker.superC + amount / this.stats(attacker).superCost);
    }
    if (target.hp <= 0) this.kill(target, attacker);
  }

  kill(p, killer) {
    p.alive = false; p.hp = 0; p.queue = []; p.leap = null; p.deaths++;
    const fell = p.y < -1;
    const [kx, ky, kz] = p.lastKb;
    this.fx.push(['die', r2(p.x), r2(p.z), p.id, killer ? killer.id : 0, r2(p.y), r2(kx), r2(ky), r2(kz)]);
    if (killer && killer !== p && killer.kills !== undefined) killer.kills++;
    const dx = fell ? p.safeX : p.x, dz = fell ? p.safeZ : p.z;
    if (this.mode === 'showdown') {
      const n = Math.max(1, p.cubes);
      for (let i = 0; i < n; i++) this.dropItem('cube', dx, dz);
      this.out.push(p.id);
    } else {
      p.respawnAt = this.t + 3;
      for (let i = 0; i < p.gems; i++) this.dropItem('gem', dx, dz);
      p.gems = 0;
      if (this.mode === 'bounty' && killer && killer.team !== p.team && killer.team !== undefined) this.kills[killer.team]++;
    }
  }

  dropGems(p) {
    for (let i = 0; i < p.gems; i++) this.dropItem('gem', p.safeX, p.safeZ);
    p.gems = 0;
  }

  dropItem(type, x, z, minR = 0.4, maxR = 1.6) {
    let px = x, pz = z;
    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2, d = rnd(minR, maxR);
      const nx = x + Math.cos(a) * d, nz = z + Math.sin(a) * d;
      const ch = S.tileAt(this.map, Math.floor(nx), Math.floor(nz));
      if (walkable(ch) && !S.pitNear(this.map, nx, nz, 0.25)) { px = nx; pz = nz; break; }
    }
    this.items.push({ id: this.nid++, type, x: px, z: pz, born: this.t });
  }

  destroyTile(c, r, by) {
    if (c < 0 || r < 0 || c >= this.map.w || r >= this.map.h) return;
    const ch = S.tileAt(this.map, c, r);
    if (ch === 'E') return this.triggerBarrel(c, r, by);
    if (ch !== '#' && ch !== 'B' && ch !== 'X') return;
    S.setTile(this.map, c, r, '.');
    this.tc.push([c, r, '.']);
    this.fx.push(['brk', c + 0.5, r + 0.5, ch]);
    if (ch === 'X') { this.boxHp.delete(r * this.map.w + c); this.dropItem('cube', c + 0.5, r + 0.5, 0, 0.3); }
  }

  triggerBarrel(c, r, by) {
    if (S.tileAt(this.map, c, r) !== 'E') return;
    S.setTile(this.map, c, r, '.');
    this.tc.push([c, r, '.']);
    const b = this.barrels.find((q) => q.c === c && q.r === r);
    if (b) b.goneAt = this.t;
    this.pending.push({ at: this.t + 0.12, c, r, by });
  }

  hitBox(c, r, dmg, by) {
    if (S.tileAt(this.map, c, r) === 'E') return this.triggerBarrel(c, r, by);
    const i = r * this.map.w + c;
    if (!this.boxHp.has(i)) return;
    const hp = this.boxHp.get(i) - dmg;
    this.fx.push(['bx', c + 0.5, r + 0.5, Math.round(dmg)]);
    if (hp <= 0) this.destroyTile(c, r); else this.boxHp.set(i, hp);
  }

  explode(x, z, y, rad, dmg, owner, team, isSuper, breakWalls, kb, up, selfKb, selfUp) {
    this.fx.push(['boom', r2(x), r2(z), rad, r2(y)]);
    // blast jumping: your own explosions push you (but don't hurt you)
    if (selfKb || selfUp) {
      const o = owner;
      const d = o && Math.hypot(o.x - x, o.z - z);
      if (o && o.alive && d < rad + 0.6 && o.y > y - 1 && o.y < y + rad + 0.5) {
        const near = 1 - (0.5 * d) / (rad + 0.6);
        this.impulse(o, o.x - x, o.z - z, selfKb * near * Math.min(1, d + 0.3), selfUp * near, true);
        if (o.bot) o.stun = Math.max(o.stun, 0.6);
      }
    }
    for (const q of this.players.values()) {
      if (!q.alive || q.team === team) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < rad + R * 0.5 && q.y > y - 1.2 && q.y < y + rad + 0.5) {
        if (dmg > 0) this.damage(q, dmg, owner, isSuper);
        let dx = q.x - x, dz = q.z - z;
        if (d < 0.1) { const a = Math.random() * 6.28; dx = Math.cos(a); dz = Math.sin(a); }
        this.impulse(q, dx, dz, (kb || 0) * (1 - (0.4 * d) / (rad + 0.5)), up || 0);
      }
    }
    const c0 = Math.floor(x - rad), c1 = Math.floor(x + rad), rr0 = Math.floor(z - rad), rr1 = Math.floor(z + rad);
    for (let r = rr0; r <= rr1; r++) for (let c = c0; c <= c1; c++) {
      if (Math.hypot(c + 0.5 - x, r + 0.5 - z) > rad + 0.3) continue;
      const ch = S.tileAt(this.map, c, r);
      if (ch === 'E') this.triggerBarrel(c, r, owner);
      else if (breakWalls) this.destroyTile(c, r, owner);
      else if (dmg > 0 && ch === 'X') this.hitBox(c, r, dmg, owner);
    }
  }

  // ---- main update ----
  update(dt) {
    this.t += dt;
    const t = this.t;
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.mode !== 'showdown' && !this.ended && t >= p.respawnAt) this.spawn(p);
        continue;
      }
      const st = this.stats(p);
      if (p.ammo < S.MAX_AMMO) p.ammo = Math.min(S.MAX_AMMO, p.ammo + dt / st.reload);
      if (t - p.lastHurt > 3 && t - p.lastAtk > 3 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.13 * dt);
      while (p.queue.length && p.queue[0].at <= t) {
        const q = p.queue.shift();
        const ang = Math.atan2(q.dx, q.dz) + (Math.random() - 0.5) * 2 * q.spec.spread;
        this.bullet(p, q.spec, Math.sin(ang), Math.cos(ang), q.isSuper, 1 + 0.1 * p.cubes);
      }
      if (p.bot && !this.ended) this.botThink(p, dt);
      if (p.leap) {
        if (t - p.leap.t0 > 0.3 && p.grounded) {
          const l = p.leap;
          p.leap = null;
          this.explode(p.x, p.z, p.y, l.spec.splash, l.spec.dmg * l.mul, p, p.team, true, l.spec.breakWalls, l.spec.kb, l.spec.up);
        } else if (t - p.leap.t0 > 2.5) p.leap = null;
      }
      if (p.grounded && p.y > -0.1 && !S.pitNear(this.map, p.x, p.z, 0.3)) { p.safeX = p.x; p.safeZ = p.z; }
      if (p.y < S.FALL_DEATH) {
        const killer = t - p.lastHitAt < 6 ? this.players.get(p.lastHitBy) : null;
        this.fx.push(['fall', p.id]);
        this.kill(p, killer);
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const b = this.pending[i];
      if (t < b.at) continue;
      this.pending.splice(i, 1);
      this.explode(b.c + 0.5, b.r + 0.5, 0, S.BARREL.splash, S.BARREL.dmg, b.by || null, -1, true, false, S.BARREL.kb, S.BARREL.up);
    }
    for (const b of this.barrels) {
      if (b.goneAt === null || t - b.goneAt < S.BARREL.respawn || S.tileAt(this.map, b.c, b.r) !== '.') continue;
      if ([...this.players.values()].some((p) => p.alive && Math.hypot(p.x - b.c - 0.5, p.z - b.r - 0.5) < 1.5)) continue;
      S.setTile(this.map, b.c, b.r, 'E');
      this.tc.push([b.c, b.r, 'E']);
      b.goneAt = null;
    }
    this.updateProjectiles(dt);
    for (let i = this.lobs.length - 1; i >= 0; i--) {
      const l = this.lobs[i];
      l.t += dt;
      if (l.t >= l.dur) {
        this.lobs.splice(i, 1);
        const owner = this.players.get(l.owner);
        this.explode(l.tx, l.tz, l.ty, l.spec.splash, l.spec.dmg * l.mul, owner, l.team, l.isSuper, l.spec.breakWalls, l.spec.kb, l.spec.up, l.spec.selfKb, l.spec.selfUp);
        if (l.spec.field) this.fields.push({ id: this.nid++, x: l.tx, z: l.tz, y: l.ty, r: l.spec.field.r, until: t + l.spec.field.dur, next: t, dps: l.spec.field.dps * l.mul, team: l.team, owner: l.owner });
      }
    }
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i];
      if (t >= f.until) { this.fields.splice(i, 1); continue; }
      if (t >= f.next) {
        f.next += 0.5;
        for (const q of this.players.values()) {
          if (!q.alive || q.team === f.team || Math.hypot(q.x - f.x, q.z - f.z) > f.r || Math.abs(q.y - f.y) > 1.5) continue;
          q.slowUntil = t + 0.6;
          this.damage(q, f.dps * 0.5, this.players.get(f.owner), true);
        }
      }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (t - it.born < 0.4) continue;
      const iy = Math.max(0, S.groundAt(this.map, it.x, it.z));
      for (const p of this.players.values()) {
        if (!p.alive || Math.hypot(p.x - it.x, p.z - it.z) > 0.85 || Math.abs(p.y - iy) > 1) continue;
        if (it.type === 'gem') p.gems++;
        else { p.cubes++; p.maxHp += 400; p.hp += 400; }
        this.fx.push(['pick', p.id, it.type]);
        this.items.splice(i, 1);
        break;
      }
    }
    if (!this.ended) this.modeLogic(dt);
  }

  updateProjectiles(dt) {
    const map = this.map;
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const b = this.proj[i];
      const spd = Math.hypot(b.vx, b.vz) * dt;
      const n = Math.max(1, Math.ceil(spd / 0.2));
      const sx = (b.vx * dt) / n, sz = (b.vz * dt) / n, sdt = dt / n;
      let dead = false, hitId = null;
      const owner = this.players.get(b.owner) || null;
      for (let k = 0; k < n && !dead; k++) {
        b.x += sx; b.z += sz; b.dist += spd / n;
        const c = Math.floor(b.x), r = Math.floor(b.z);
        if (c < 0 || r < 0 || c >= map.w || r >= map.h) { dead = true; break; }
        const ch = map.t[r * map.w + c];
        const top = S.tileH(ch);
        if (S.BLOCK[ch]) {
          if (top >= b.y - 0.05) {
            if (b.breakWalls) this.destroyTile(c, r, owner);
            else { if (ch === 'X' || ch === 'E') this.hitBox(c, r, b.dmg, owner); dead = true; break; }
          } else b.y = Math.max(top + 0.15, b.y - S.BULLET_DROP * sdt);
        } else {
          if (ch === 'B' && b.breakWalls) this.destroyTile(c, r, owner);
          const g = Math.max(0, top);
          if (g >= b.y - 0.05) { dead = true; break; } // hit a cliff face
          b.y = Math.max(g + S.BULLET_ALT, b.y - S.BULLET_DROP * sdt);
        }
        for (const p of this.players.values()) {
          if (!p.alive || p.team === b.team || b.hit.has(p.id) || b.y < p.y - 0.3 || b.y > p.y + 1.7) continue;
          const rr = b.r + R;
          if ((p.x - b.x) ** 2 + (p.z - b.z) ** 2 < rr * rr) {
            b.hit.add(p.id);
            if (b.rocket) { dead = true; break; }
            this.damage(p, b.dmg, owner, b.isSuper);
            this.impulse(p, b.vx, b.vz, b.kb, b.up);
            if (!b.pierce) { dead = true; hitId = p.id; break; }
          }
        }
        if (b.dist >= b.range) dead = true;
      }
      if (dead) {
        this.proj.splice(i, 1);
        if (b.rocket) {
          const ex = b.x - sx * 0.5, ez = b.z - sz * 0.5, rs = b.rocket;
          this.explode(ex, ez, Math.max(0, b.y - S.BULLET_ALT), rs.splash, rs.dmg * b.mul, owner, b.team, b.isSuper, rs.breakWalls, rs.kb, rs.up, rs.selfKb, rs.selfUp);
          continue;
        }
        if (b.split) {
          const sp = { speed: 12, range: b.split.splitRange, dmg: b.split.splitDmg, r: 0.15, kb: b.split.splitKb };
          const ox = b.x - sx, oz = b.z - sz;
          const base = Math.random() * Math.PI;
          for (let j = 0; j < b.split.splitCount; j++) {
            const a = base + (j / b.split.splitCount) * Math.PI * 2;
            this.bullet(owner || { id: b.owner, team: b.team }, sp, Math.sin(a), Math.cos(a), false, b.mul, [ox, oz, hitId ? [hitId] : [], b.y]);
          }
        }
      }
    }
  }

  modeLogic(dt) {
    const t = this.t;
    if (this.mode === 'gemgrab') {
      if (t >= this.nextGem) {
        this.nextGem = t + 7;
        const onField = this.items.length + [...this.players.values()].reduce((s, p) => s + p.gems, 0);
        if (onField < 29) { this.dropItem('gem', this.map.mine[0], this.map.mine[1], 0.6, 1.8); this.fx.push(['gem', ...this.map.mine]); }
      }
      this.score = [0, 0];
      for (const p of this.players.values()) this.score[p.team] += p.gems;
      const lead = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : -1;
      if (lead >= 0 && this.score[lead] >= 10) {
        if (this.cdTeam !== lead) { this.cdTeam = lead; this.cdEnd = t + 15; }
        if (t >= this.cdEnd) return this.finish(lead);
      } else this.cdTeam = -1;
      if (t >= this.timeLimit) return this.finish(lead);
    } else if (this.mode === 'bounty') {
      if (this.kills[0] >= 10) return this.finish(0);
      if (this.kills[1] >= 10) return this.finish(1);
      if (t >= this.timeLimit) return this.finish(this.kills[0] > this.kills[1] ? 0 : this.kills[1] > this.kills[0] ? 1 : -1);
    } else {
      const maxGas = Math.floor(this.map.w / 2) - 2;
      if (t >= this.nextGas && this.gas < maxGas) { this.gas++; this.nextGas = t + S.GAS_STEP; }
      if (this.gas > 0 && t >= this.gasTick) {
        this.gasTick = t + 0.5;
        const g = this.gas, w = this.map.w, h = this.map.h;
        for (const p of this.players.values()) {
          if (p.alive && (p.x < g || p.x > w - g || p.z < g || p.z > h - g)) this.damage(p, S.GAS_DPS * 0.5, null, true);
        }
      }
      const alive = [...this.players.values()].filter((p) => p.alive);
      const humansAlive = alive.some((p) => !p.bot);
      if (alive.length <= 1 || !humansAlive) return this.finish(alive.length === 1 ? alive[0].team : -1);
    }
  }

  finish(winTeam) {
    this.ended = true;
    this.endAt = this.t + 6;
    const ranking = [...this.players.values()].filter((p) => p.alive).map((p) => p.id).concat(this.out.slice().reverse());
    const stats = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, brawler: p.brawler, team: p.team, kills: p.kills, deaths: p.deaths }));
    this.room.broadcast({ t: 'end', mode: this.mode, winTeam, ranking, stats, score: this.mode === 'bounty' ? this.kills : this.score });
  }

  // ---- bots ----
  visibleTo(q, viewer) {
    return !S.inBush(this.map, q.x, q.z) || this.t < q.reveal || dist(q, viewer) < 2.3;
  }

  botThink(p, dt) {
    const ai = p.ai;
    ai.timer -= dt;
    if (ai.timer <= 0) { ai.timer = 0.18 + Math.random() * 0.15; this.botDecide(p); }
    const st = this.stats(p);
    const spd = st.speed * (p.slowUntil > this.t ? 0.55 : 1);
    let { mx, mz } = ai;
    // don't walk into pits
    if ((mx || mz) && p.grounded && S.pitNear(this.map, p.x + mx * 0.7, p.z + mz * 0.7, 0.2) && !S.pitNear(this.map, p.x, p.z, 0.2)) {
      if (p.stun <= 0) { mx = -mx * 0.3; mz = -mz * 0.3; ai.strafe *= -1; }
    }
    // hop up ledges
    let jump = ai.jump;
    if ((mx || mz) && p.grounded && S.circleHits(this.map, p.x + mx * 0.45, p.z + mz * 0.45, R, p.y) &&
      !S.circleHits(this.map, p.x + mx * 0.45, p.z + mz * 0.45, R, p.y + 1.4)) jump = true;
    ai.jump = false;
    S.stepBody(this.map, p, mx, mz, spd, jump, dt);
    if ((mx || mz) && this.t - p.lastShot > 0.4) p.a = Math.atan2(mx, mz);
  }

  pathDir(p, gx, gz) {
    const map = this.map;
    if (Math.hypot(gx - p.x, gz - p.z) < 0.3) return [0, 0];
    if (S.walkClear(map, p.x, p.z, gx, gz, R, p.y)) {
      const l = Math.hypot(gx - p.x, gz - p.z);
      return [(gx - p.x) / l, (gz - p.z) / l];
    }
    const w = map.w, h = map.h;
    const sc = Math.floor(p.x), sr = Math.floor(p.z);
    let gc = Math.floor(gx), gr = Math.floor(gz);
    if (!walkable(S.tileAt(map, gc, gr))) {
      for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (walkable(S.tileAt(map, gc + dc, gr + dr))) { gc += dc; gr += dr; break; }
      }
    }
    const prev = new Int32Array(w * h).fill(-1);
    const start = sr * w + sc, goal = gr * w + gc;
    if (start < 0 || start >= w * h) return [0, 0];
    const queue = [start];
    prev[start] = start;
    let found = false;
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      if (cur === goal) { found = true; break; }
      const c = cur % w, r = (cur / w) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= w || nr >= h) continue;
        const ni = nr * w + nc;
        if (prev[ni] !== -1 || !walkable(map.t[ni])) continue;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    if (!found) return [0, 0];
    const path = [];
    for (let cur = goal; cur !== start; cur = prev[cur]) path.push(cur);
    path.reverse();
    if (!path.length) return [0, 0];
    // pick the furthest of the next few tiles we can walk to directly
    let tx = null, tz = null;
    for (let i = Math.min(path.length - 1, 4); i >= 0; i--) {
      const cx = (path[i] % w) + 0.5, cz = ((path[i] / w) | 0) + 0.5;
      if (i === 0 || S.walkClear(map, p.x, p.z, cx, cz, R, p.y + 1.3)) { tx = cx; tz = cz; break; }
    }
    const l = Math.hypot(tx - p.x, tz - p.z) || 1;
    return [(tx - p.x) / l, (tz - p.z) / l];
  }

  botDecide(p) {
    const st = this.stats(p);
    const ai = p.ai, map = this.map, t = this.t;
    const range = st.attack.range;
    let target = null, bd = 1e9;
    for (const q of this.players.values()) {
      if (!q.alive || q.team === p.team) continue;
      const d = dist(p, q);
      if (d < bd && d < 12 && this.visibleTo(q, p)) { bd = d; target = q; }
    }
    let goal = null;
    const lob = st.attack.type === 'lob' || st.attack.type === 'rocket';
    const g = this.gas;
    const inDanger = this.mode === 'showdown' && g > 0 &&
      (p.x < g + 1.5 || p.x > map.w - g - 1.5 || p.z < g + 1.5 || p.z > map.h - g - 1.5);
    const home = this.mode !== 'showdown' ? this.map.spawns[p.team][1] : null;

    if (inDanger) goal = [map.w / 2, map.h / 2];
    if (target) {
      const above = target.y > p.y + 0.5;
      let canHit = st.attack.type === 'lob' || S.shotClear(map, p.x, p.z, target.x, target.z, Math.max(p.y, target.y - 0.3));
      // enemy on high ground: jump and shoot
      if (above && !lob && bd < range && p.grounded && Math.random() < 0.5) { ai.jump = true; canHit = true; }
      let aimX = target.x - p.x, aimZ = target.z - p.z;
      const err = (Math.random() - 0.5) * 0.35;
      const ca = Math.cos(err), sa = Math.sin(err);
      [aimX, aimZ] = [aimX * ca - aimZ * sa, aimX * sa + aimZ * ca];
      const fire = () => !above || lob || !p.grounded;
      if (p.superC >= 1 && bd < (st.super.range || 6) * 0.9 && (canHit || st.super.type === 'lob' || st.super.type === 'leap' || st.super.type === 'heal')) {
        if (st.super.type !== 'heal' || p.hp < p.maxHp * 0.6) {
          const f = st.super.range ? bd / st.super.range : 1;
          if (t > 3) this.attack(p, (aimX / bd) * f, (aimZ / bd) * f, true);
        }
      } else if (bd <= range * 1.02 && canHit && fire() && p.ammo >= 1 && !p.queue.length && t - p.lastShot > 0.45 && Math.random() < 0.6) {
        const f = lob ? bd / range : 1;
        if (t > 3) this.attack(p, (aimX / bd) * f, (aimZ / bd) * f, false);
      }
      if (!goal) {
        const prefer = st.attack.range < 4 ? 0.8 : range * 0.7;
        const scared = p.hp < p.maxHp * 0.3 && target.hp > p.hp;
        if (scared && home) goal = home;
        else if (scared) goal = [p.x - (target.x - p.x), p.z - (target.z - p.z)];
        else if (bd > prefer || !canHit) goal = [target.x, target.z];
        else {
          if (Math.random() < 0.08) ai.strafe *= -1;
          if (Math.random() < 0.03) ai.jump = true;
          const ux = (target.x - p.x) / bd, uz = (target.z - p.z) / bd;
          const back = bd < prefer * 0.6 ? -0.6 : 0;
          ai.mx = -uz * ai.strafe + ux * back; ai.mz = ux * ai.strafe + uz * back;
          const l = Math.hypot(ai.mx, ai.mz) || 1;
          ai.mx /= l; ai.mz /= l;
          return;
        }
      }
    }
    if (!goal) {
      if (this.mode === 'gemgrab') {
        if (p.gems > 0 && this.score[p.team] >= 10) goal = home;
        else {
          let bi = null, bdist = 1e9;
          for (const it of this.items) { const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bdist) { bdist = d; bi = it; } }
          goal = bi ? [bi.x, bi.z] : [map.mine[0] + Math.sin(p.id) * 2, map.mine[1] + Math.cos(p.id) * 2];
        }
      } else if (this.mode === 'bounty') {
        const enemySpawn = this.map.spawns[1 - p.team][1];
        goal = [map.w / 2 + Math.sin(p.id + t * 0.1) * 5, (map.h / 2 + enemySpawn[1]) / 2];
      } else {
        let bi = null, bdist = 12;
        for (const it of this.items) { const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bdist) { bdist = d; bi = it; } }
        if (bi) goal = [bi.x, bi.z];
        else {
          let bc = null; bdist = 14;
          for (const [i] of this.boxHp) {
            const c = i % map.w, r = (i / map.w) | 0;
            const d = Math.hypot(c + 0.5 - p.x, r + 0.5 - p.z);
            if (d < bdist) { bdist = d; bc = [c + 0.5, r + 0.5]; }
          }
          if (bc) {
            if (bdist < range * 0.9 && (lob || S.shotClear(map, p.x, p.z, bc[0], bc[1], p.y)) && p.ammo >= 1 && !p.queue.length && t - p.lastShot > 0.5 && st.attack.type !== 'heal') {
              const f = lob ? bdist / range : 1;
              this.attack(p, ((bc[0] - p.x) / bdist) * f, ((bc[1] - p.z) / bdist) * f, false);
            }
            goal = bdist < range * 0.6 ? null : bc;
          } else goal = [map.w / 2 + Math.sin(p.id * 7) * 4, map.h / 2 + Math.cos(p.id * 7) * 4];
        }
      }
    }
    if (goal) [ai.mx, ai.mz] = this.pathDir(p, goal[0], goal[1]);
    else ai.mx = ai.mz = 0;
  }

  // ---- networking ----
  snapshot(viewerId) {
    const v = this.players.get(viewerId);
    const vt = v ? v.team : -999;
    const allies = [...this.players.values()].filter((q) => q.alive && q.team === vt);
    const p = [];
    for (const q of this.players.values()) {
      const bush = S.inBush(this.map, q.x, q.z) && q.y < 0.3;
      if (q.team !== vt && q.alive && bush && this.t >= q.reveal && !allies.some((a) => dist(a, q) < 2.3)) continue;
      const flags = (q.alive ? 1 : 0) | (bush ? 2 : 0) | (q.grounded ? 0 : 4) | (q.slowUntil > this.t ? 8 : 0) | (q.stun > 0 ? 16 : 0);
      p.push([q.id, r2(q.x), r2(q.z), r2(q.a), Math.ceil(q.hp), q.maxHp, flags, this.mode === 'showdown' ? q.cubes : q.gems,
        Math.round(q.ammo * 100) / 100, Math.round(q.superC * 100) / 100, q.tp, q.alive ? 0 : Math.max(0, Math.ceil(q.respawnAt - this.t)), r2(q.y)]);
    }
    let sc;
    if (this.mode === 'gemgrab') sc = { s: this.score, cd: this.cdTeam >= 0 ? Math.max(0, Math.ceil(this.cdEnd - this.t)) : null, cdT: this.cdTeam, tl: Math.max(0, Math.ceil(this.timeLimit - this.t)) };
    else if (this.mode === 'bounty') sc = { s: this.kills, tl: Math.max(0, Math.ceil(this.timeLimit - this.t)) };
    else sc = { alive: [...this.players.values()].filter((q) => q.alive).length, gas: this.gas };
    return {
      t: 's', tm: r2(this.t), p,
      pr: this.proj.map((b) => [b.id, b.kind, r2(b.x), r2(b.z), r2(b.vx), r2(b.vz), b.owner, r2(b.y)]),
      lb: this.lobs.map((l) => [l.id, l.kind, r2(l.sx), r2(l.sz), r2(l.tx), r2(l.tz), r2(l.t), r2(l.dur), l.owner, r2(l.sy), r2(l.ty)]),
      fd: this.fields.map((f) => [f.id, r2(f.x), r2(f.z), f.r, f.team, r2(f.y)]),
      it: this.items.map((i) => [i.id, i.type, r2(i.x), r2(i.z)]),
      fx: this.fx, tc: this.tc, sc,
    };
  }

  startMsg(youId) {
    return { t: 'gstart', mode: this.mode, rows: this.map.t.reduce((acc, ch, i) => { const r = (i / this.map.w) | 0; acc[r] = (acc[r] || '') + ch; return acc; }, []),
      spawns: this.map.spawns, mine: this.map.mine, roster: this.roster(), you: youId };
  }
}

// ---------------- lobby ----------------
// A Room knows nothing about the network: each client is just a send(string) function.
export class Room {
  constructor(info = {}) {
    this.info = info; // sent to clients in 'hello' (lan ips / room code)
    this.nextId = 1;
    this.clients = new Map();
    this.hostId = null;
    this.settings = { mode: 'gemgrab', bots: true };
    this.game = null;
  }

  // Returns handlers the transport calls on incoming data / disconnect.
  connect(sendFn) {
    const c = { id: this.nextId++, send: sendFn, joined: false, name: '', brawler: 'blaze', team: 0 };
    this.clients.set(c.id, c);
    this.sendTo(c, { t: 'hello', id: c.id, ...this.info });
    return {
      id: c.id,
      message: (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch { return; }
        try { this.handle(c, m); } catch (e) { console.error(e); }
      },
      close: () => this.disconnect(c),
    };
  }

  sendTo(c, obj) { try { c.send(JSON.stringify(obj)); } catch {} }
  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const c of this.clients.values()) if (c.joined) { try { c.send(s); } catch {} }
  }
  lobbyMsg() {
    const g = this.game;
    return {
      t: 'lobby', settings: this.settings, hostId: this.hostId, inGame: !!g, gameMode: g ? g.mode : null,
      players: [...this.clients.values()].filter((c) => c.joined).map((c) => ({ id: c.id, name: c.name, brawler: c.brawler, team: c.team })),
    };
  }
  broadcastLobby() { this.broadcast(this.lobbyMsg()); }

  startGame() {
    const humans = [...this.clients.values()].filter((c) => c.joined);
    if (!humans.length) return;
    this.game = new Game(this.settings, humans, this);
    for (const c of humans) this.sendTo(c, this.game.startMsg(c.id));
    this.broadcastLobby();
  }

  disconnect(c) {
    if (!this.clients.has(c.id)) return;
    this.clients.delete(c.id);
    const g = this.game;
    if (g) {
      g.removePlayer(c.id);
      this.broadcast({ t: 'roster', roster: g.roster() });
      if (!g.hasHumans()) this.game = null;
    }
    if (this.hostId === c.id && !this.info.fixedHost) {
      const first = [...this.clients.values()].find((x) => x.joined);
      this.hostId = first ? first.id : null;
    }
    this.broadcastLobby();
  }

  handle(c, m) {
    const g = this.game;
    switch (m.t) {
      case 'join': {
        c.name = String(m.name || 'Player').replace(/[<>]/g, '').trim().slice(0, 14) || 'Player';
        if (S.BRAWLERS[m.brawler]) c.brawler = m.brawler;
        const cnt = [0, 0];
        for (const o of this.clients.values()) if (o.joined) cnt[o.team]++;
        c.team = cnt[0] <= cnt[1] ? 0 : 1;
        c.joined = true;
        if (!this.hostId || !this.clients.get(this.hostId)?.joined) this.hostId = c.id;
        this.broadcastLobby();
        if (g && !g.ended && g.mode !== 'showdown') {
          g.addPlayer(c, false);
          this.sendTo(c, g.startMsg(c.id));
          this.broadcast({ t: 'roster', roster: g.roster() });
        }
        break;
      }
      case 'pick':
        if (S.BRAWLERS[m.brawler]) { c.brawler = m.brawler; this.broadcastLobby(); }
        break;
      case 'team':
        if (m.team === 0 || m.team === 1) { c.team = m.team; this.broadcastLobby(); }
        break;
      case 'settings':
        if (c.id !== this.hostId) return;
        if (S.MODES[m.mode]) this.settings.mode = m.mode;
        if (typeof m.bots === 'boolean') this.settings.bots = m.bots;
        this.broadcastLobby();
        break;
      case 'start':
        if (c.id === this.hostId && !g) this.startGame();
        break;
      case 'pos': case 'atk': {
        const p = g && g.players.get(c.id);
        if (!p || g.ended) return;
        if (m.t === 'pos') g.onPos(p, m); else g.onAttack(p, m);
        break;
      }
    }
  }

  // call S.TICK times per second
  tick() {
    const g = this.game;
    if (!g) return;
    try {
      g.update(1 / S.TICK);
      for (const c of this.clients.values()) {
        if (c.joined && g.players.has(c.id)) { try { c.send(JSON.stringify(g.snapshot(c.id))); } catch {} }
      }
      g.fx = []; g.tc = [];
      if (g.ended && g.t >= g.endAt) { this.game = null; this.broadcastLobby(); }
    } catch (e) {
      console.error('game error', e);
    }
  }
}
