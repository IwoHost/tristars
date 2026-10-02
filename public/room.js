// Game simulation + lobby. Runs on the Node server (LAN mode) or inside the host's browser (room-code mode).
import * as S from './shared.js';

// ---------------- helpers ----------------
const R = S.PLAYER_R;
const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = (v) => Math.round(v * 100) / 100;
const BOT_NAMES = ['Rusty', 'Ziggy', 'Bolt', 'Nova', 'Pico', 'Mango', 'Taco', 'Fizz', 'Dot', 'Bongo', 'Pixel', 'Noodle'];
const BRAWLER_KEYS = Object.keys(S.BRAWLERS);

function findFree(map, x, z) {
  if (!S.circleHits(map, x, z, R)) return [x, z];
  for (let rad = 0.5; rad < 6; rad += 0.5) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const nx = x + Math.cos(a) * rad, nz = z + Math.sin(a) * rad;
      if (!S.circleHits(map, nx, nz, R)) return [nx, nz];
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
    this.map.t.forEach((ch, i) => { if (ch === 'X') this.boxHp.set(i, S.BOX_HP); });
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
      x: 0, z: 0, a: 0, hp: st.hp, maxHp: st.hp, ammo: S.MAX_AMMO, superC: 0, gems: 0, cubes: 0,
      alive: false, respawnAt: 0, lastHurt: -9, lastAtk: -9, reveal: -9, tp: 0, forced: null, slowUntil: 0,
      queue: [], kills: 0, deaths: 0, lastShot: -9,
      ai: { timer: Math.random() * 0.3, mx: 0, mz: 0, strafe: Math.random() < 0.5 ? 1 : -1 },
    };
    this.players.set(p.id, p);
    this.spawn(p);
    return p;
  }

  spawn(p) {
    let pos;
    if (this.mode === 'showdown') {
      pos = this.sdSpawns[(this.players.size - 1 + this.out.length) % this.sdSpawns.length];
      const used = new Set([...this.players.values()].filter((q) => q !== p && q.alive).map((q) => `${q.x},${q.z}`));
      for (const s of this.sdSpawns) if (!used.has(`${s[0]},${s[1]}`)) { pos = s; break; }
    } else {
      const list = this.map.spawns[p.team];
      pos = list[this.spawnI[p.team]++ % list.length];
    }
    const st = this.stats(p);
    [p.x, p.z] = findFree(this.map, pos[0], pos[1]);
    p.a = this.mode !== 'showdown' && p.team === 0 ? Math.PI : 0;
    p.maxHp = st.hp + p.cubes * 400;
    p.hp = p.maxHp;
    p.alive = true; p.ammo = S.MAX_AMMO; p.forced = null; p.queue = []; p.tp++;
    p.lastHurt = this.t; p.slowUntil = 0;
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

  // ---- input from humans ----
  onPos(p, m) {
    if (!p.alive || p.forced || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    if (d < 1.6 && !S.circleHits(this.map, m.x, m.z, R * 0.85)) { p.x = m.x; p.z = m.z; }
    else if (d > 0.01) p.tp++; // force client to resync
    if (Number.isFinite(m.a) && this.t - p.lastShot > 0.35) p.a = m.a;
  }

  onAttack(p, m) {
    if (!p.alive || p.forced || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
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
      case 'lob': {
        const d = f * spec.range;
        for (let i = 0; i < spec.count; i++) {
          const off = (i - (spec.count - 1) / 2) * (spec.sep || 0);
          this.lobs.push({
            id: this.nid++, kind: p.brawler + (isSuper ? 'S' : ''), sx: p.x, sz: p.z,
            tx: p.x + dx * d + dz * off, tz: p.z + dz * d - dx * off, t: 0, dur: spec.dur * (0.6 + 0.4 * f),
            spec, owner: p.id, team: p.team, isSuper, mul,
          });
        }
        break;
      }
      case 'leap': {
        const d = f * spec.range;
        let tx = Math.max(0.6, Math.min(this.map.w - 0.6, p.x + dx * d));
        let tz = Math.max(0.6, Math.min(this.map.h - 0.6, p.z + dz * d));
        p.forced = { type: 'leap', sx: p.x, sz: p.z, tx, tz, t0: this.t, dur: spec.dur, spec, mul };
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
      x: ox, z: oz, vx: dx * spec.speed, vz: dz * spec.speed, dist: 0, range: spec.range,
      dmg: spec.dmg * mul, r: spec.r, owner: p.id, team: p.team, pierce: !!spec.pierce, hit: new Set(from ? from[2] : []),
      breakWalls: !!spec.breakWalls, knock: spec.knock || 0, split: spec.splitCount ? spec : null, isSuper, mul,
    });
  }

  // ---- damage ----
  damage(target, amount, attacker, isSuper) {
    if (!target.alive) return;
    amount = Math.round(amount);
    if (amount <= 0) return;
    target.hp -= amount; target.lastHurt = this.t; target.reveal = this.t + 0.8;
    this.fx.push(['hit', r2(target.x), r2(target.z), amount, target.id]);
    if (attacker && !isSuper && attacker !== target) {
      attacker.superC = Math.min(1, attacker.superC + amount / this.stats(attacker).superCost);
    }
    if (target.hp <= 0) this.kill(target, attacker);
  }

  knock(p, dx, dz, power) {
    if (!p.alive || (p.forced && p.forced.type === 'leap')) return;
    const l = Math.hypot(dx, dz) || 1;
    p.forced = { type: 'knock', vx: (dx / l) * power / 0.25, vz: (dz / l) * power / 0.25, until: this.t + 0.25 };
  }

  kill(p, killer) {
    p.alive = false; p.hp = 0; p.forced = null; p.queue = []; p.deaths++;
    this.fx.push(['die', r2(p.x), r2(p.z), p.id, killer ? killer.id : 0]);
    if (killer && killer !== p) killer.kills++;
    if (this.mode === 'showdown') {
      const n = Math.max(1, p.cubes);
      for (let i = 0; i < n; i++) this.dropItem('cube', p.x, p.z);
      this.out.push(p.id);
    } else {
      p.respawnAt = this.t + 3;
      this.dropGems(p);
      if (this.mode === 'bounty' && killer && killer.team !== p.team) this.kills[killer.team]++;
    }
  }

  dropGems(p) {
    for (let i = 0; i < p.gems; i++) this.dropItem('gem', p.x, p.z);
    p.gems = 0;
  }

  dropItem(type, x, z, minR = 0.4, maxR = 1.6) {
    let px = x, pz = z;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, d = rnd(minR, maxR);
      const nx = x + Math.cos(a) * d, nz = z + Math.sin(a) * d;
      if (!S.SOLID[S.tileAt(this.map, Math.floor(nx), Math.floor(nz))] && !S.circleHits(this.map, nx, nz, 0.2)) { px = nx; pz = nz; break; }
    }
    this.items.push({ id: this.nid++, type, x: px, z: pz, born: this.t });
  }

  destroyTile(c, r) {
    if (c < 0 || r < 0 || c >= this.map.w || r >= this.map.h) return;
    const ch = S.tileAt(this.map, c, r);
    if (ch !== '#' && ch !== 'B' && ch !== 'X') return;
    S.setTile(this.map, c, r, '.');
    this.tc.push([c, r, '.']);
    this.fx.push(['brk', c + 0.5, r + 0.5, ch]);
    if (ch === 'X') { this.boxHp.delete(r * this.map.w + c); this.dropItem('cube', c + 0.5, r + 0.5, 0, 0.3); }
  }

  hitBox(c, r, dmg) {
    const i = r * this.map.w + c;
    if (!this.boxHp.has(i)) return;
    const hp = this.boxHp.get(i) - dmg;
    this.fx.push(['bx', c + 0.5, r + 0.5, Math.round(dmg)]);
    if (hp <= 0) this.destroyTile(c, r); else this.boxHp.set(i, hp);
  }

  explode(x, z, rad, dmg, owner, team, isSuper, breakWalls, knock) {
    this.fx.push(['boom', r2(x), r2(z), rad]);
    if (dmg > 0) {
      for (const q of this.players.values()) {
        if (!q.alive || q.team === team) continue;
        const d = Math.hypot(q.x - x, q.z - z);
        if (d < rad + R * 0.5) {
          this.damage(q, dmg, owner, isSuper);
          if (knock) this.knock(q, q.x - x, q.z - z, knock);
        }
      }
    }
    const c0 = Math.floor(x - rad), c1 = Math.floor(x + rad), rr0 = Math.floor(z - rad), rr1 = Math.floor(z + rad);
    for (let r = rr0; r <= rr1; r++) for (let c = c0; c <= c1; c++) {
      if (Math.hypot(c + 0.5 - x, r + 0.5 - z) > rad + 0.3) continue;
      if (breakWalls) this.destroyTile(c, r);
      else if (dmg > 0 && S.tileAt(this.map, c, r) === 'X') this.hitBox(c, r, dmg);
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
      if (p.forced) this.updateForced(p, dt);
      if (p.bot && !this.ended) this.botThink(p, dt);
    }
    this.updateProjectiles(dt);
    for (let i = this.lobs.length - 1; i >= 0; i--) {
      const l = this.lobs[i];
      l.t += dt;
      if (l.t >= l.dur) {
        this.lobs.splice(i, 1);
        const owner = this.players.get(l.owner);
        this.explode(l.tx, l.tz, l.spec.splash, l.spec.dmg * l.mul, owner, l.team, l.isSuper, l.spec.breakWalls, l.spec.knock);
        if (l.spec.field) this.fields.push({ id: this.nid++, x: l.tx, z: l.tz, r: l.spec.field.r, until: t + l.spec.field.dur, next: t, dps: l.spec.field.dps * l.mul, team: l.team, owner: l.owner });
      }
    }
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i];
      if (t >= f.until) { this.fields.splice(i, 1); continue; }
      if (t >= f.next) {
        f.next += 0.5;
        for (const q of this.players.values()) {
          if (!q.alive || q.team === f.team || Math.hypot(q.x - f.x, q.z - f.z) > f.r) continue;
          q.slowUntil = t + 0.6;
          this.damage(q, f.dps * 0.5, this.players.get(f.owner), true);
        }
      }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (t - it.born < 0.4) continue;
      for (const p of this.players.values()) {
        if (!p.alive || Math.hypot(p.x - it.x, p.z - it.z) > 0.85) continue;
        if (it.type === 'gem') p.gems++;
        else { p.cubes++; p.maxHp += 400; p.hp += 400; }
        this.fx.push(['pick', p.id, it.type]);
        this.items.splice(i, 1);
        break;
      }
    }
    if (!this.ended) this.modeLogic(dt);
  }

  updateForced(p, dt) {
    const f = p.forced;
    if (f.type === 'leap') {
      const k = (this.t - f.t0) / f.dur;
      if (k >= 1) {
        [p.x, p.z] = [f.tx, f.tz];
        p.forced = null;
        this.explode(f.tx, f.tz, f.spec.splash, f.spec.dmg * f.mul, p, p.team, true, f.spec.breakWalls, f.spec.knock);
        [p.x, p.z] = findFree(this.map, p.x, p.z);
      } else {
        p.x = f.sx + (f.tx - f.sx) * k; p.z = f.sz + (f.tz - f.sz) * k;
      }
    } else {
      [p.x, p.z] = S.moveCircle(this.map, p.x, p.z, f.vx * dt, f.vz * dt);
      if (this.t >= f.until) p.forced = null;
    }
  }

  updateProjectiles(dt) {
    const map = this.map;
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const b = this.proj[i];
      const spd = Math.hypot(b.vx, b.vz) * dt;
      const n = Math.max(1, Math.ceil(spd / 0.2));
      const sx = (b.vx * dt) / n, sz = (b.vz * dt) / n;
      let dead = false, hitId = null;
      for (let k = 0; k < n && !dead; k++) {
        b.x += sx; b.z += sz; b.dist += spd / n;
        const c = Math.floor(b.x), r = Math.floor(b.z);
        if (c < 0 || r < 0 || c >= map.w || r >= map.h) { dead = true; break; }
        const ch = map.t[r * map.w + c];
        if (b.breakWalls && (ch === '#' || ch === 'B' || ch === 'X')) this.destroyTile(c, r);
        else if (ch === 'X') { this.hitBox(c, r, b.dmg); dead = true; break; }
        else if (ch === '#') { dead = true; break; }
        for (const p of this.players.values()) {
          if (!p.alive || p.team === b.team || b.hit.has(p.id)) continue;
          const rr = b.r + R;
          if ((p.x - b.x) ** 2 + (p.z - b.z) ** 2 < rr * rr) {
            b.hit.add(p.id);
            this.damage(p, b.dmg, this.players.get(b.owner), b.isSuper);
            if (b.knock) this.knock(p, b.vx, b.vz, b.knock);
            if (!b.pierce) { dead = true; hitId = p.id; break; }
          }
        }
        if (b.dist >= b.range) dead = true;
      }
      if (dead) {
        this.proj.splice(i, 1);
        if (b.split) {
          const owner = this.players.get(b.owner);
          const sp = { speed: 12, range: b.split.splitRange, dmg: b.split.splitDmg, r: 0.15 };
          const ox = b.x - sx, oz = b.z - sz;
          const base = Math.random() * Math.PI;
          for (let j = 0; j < b.split.splitCount; j++) {
            const a = base + (j / b.split.splitCount) * Math.PI * 2;
            this.bullet(owner || { id: b.owner, team: b.team }, sp, Math.sin(a), Math.cos(a), false, b.mul, [ox, oz, hitId ? [hitId] : []]);
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
    if (p.forced) return;
    const ai = p.ai;
    ai.timer -= dt;
    if (ai.timer <= 0) { ai.timer = 0.18 + Math.random() * 0.15; this.botDecide(p); }
    const st = this.stats(p);
    const spd = st.speed * (p.slowUntil > this.t ? 0.55 : 1);
    if (ai.mx || ai.mz) {
      [p.x, p.z] = S.moveCircle(this.map, p.x, p.z, ai.mx * spd * dt, ai.mz * spd * dt);
      if (this.t - p.lastShot > 0.4) p.a = Math.atan2(ai.mx, ai.mz);
    }
  }

  pathDir(p, gx, gz) {
    const map = this.map;
    if (Math.hypot(gx - p.x, gz - p.z) < 0.3) return [0, 0];
    if (S.walkClear(map, p.x, p.z, gx, gz)) {
      const l = Math.hypot(gx - p.x, gz - p.z);
      return [(gx - p.x) / l, (gz - p.z) / l];
    }
    const w = map.w, h = map.h;
    const sc = Math.floor(p.x), sr = Math.floor(p.z);
    let gc = Math.floor(gx), gr = Math.floor(gz);
    if (S.SOLID[S.tileAt(map, gc, gr)]) {
      // goal is inside something solid (a box): aim for a free neighbour instead
      for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (!S.SOLID[S.tileAt(map, gc + dc, gr + dr)]) { gc += dc; gr += dr; break; }
      }
    }
    const prev = new Int32Array(w * h).fill(-1);
    const start = sr * w + sc, goal = gr * w + gc;
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
        if (prev[ni] !== -1 || S.SOLID[map.t[ni]]) continue;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    if (!found) return [0, 0];
    const path = [];
    for (let cur = goal; cur !== start; cur = prev[cur]) path.push(cur);
    path.reverse();
    // pick the furthest of the next few tiles we can walk to directly
    let tx = null, tz = null;
    for (let i = Math.min(path.length - 1, 4); i >= 0; i--) {
      const cx = (path[i] % w) + 0.5, cz = ((path[i] / w) | 0) + 0.5;
      if (i === 0 || S.walkClear(map, p.x, p.z, cx, cz)) { tx = cx; tz = cz; break; }
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
    const lob = st.attack.type === 'lob';
    const g = this.gas;
    const inDanger = this.mode === 'showdown' && g > 0 &&
      (p.x < g + 1.5 || p.x > map.w - g - 1.5 || p.z < g + 1.5 || p.z > map.h - g - 1.5);
    const home = this.mode !== 'showdown' ? this.map.spawns[p.team][1] : null;

    if (inDanger) goal = [map.w / 2, map.h / 2];
    if (target) {
      const canHit = lob || S.shotClear(map, p.x, p.z, target.x, target.z);
      // aim with some lead and error
      let aimX = target.x - p.x, aimZ = target.z - p.z;
      const err = (Math.random() - 0.5) * 0.35;
      const ca = Math.cos(err), sa = Math.sin(err);
      [aimX, aimZ] = [aimX * ca - aimZ * sa, aimX * sa + aimZ * ca];
      if (p.superC >= 1 && bd < (st.super.range || 6) * 0.9 && (canHit || st.super.type === 'lob' || st.super.type === 'leap' || st.super.type === 'heal')) {
        if (st.super.type !== 'heal' || p.hp < p.maxHp * 0.6) {
          const f = st.super.range ? bd / st.super.range : 1;
          if (t > 3) this.attack(p, (aimX / bd) * f, (aimZ / bd) * f, true);
        }
      } else if (bd <= range * 1.02 && canHit && p.ammo >= 1 && !p.queue.length && t - p.lastShot > 0.45 && Math.random() < 0.6) {
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
            if (bdist < range * 0.9 && (lob || S.shotClear(map, p.x, p.z, bc[0], bc[1])) && p.ammo >= 1 && !p.queue.length && t - p.lastShot > 0.5 && st.attack.type !== 'heal') {
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
      const bush = S.inBush(this.map, q.x, q.z);
      if (q.team !== vt && q.alive && bush && this.t >= q.reveal && !allies.some((a) => dist(a, q) < 2.3)) continue;
      const flags = (q.alive ? 1 : 0) | (bush ? 2 : 0) | (q.forced ? 4 : 0) | (q.slowUntil > this.t ? 8 : 0);
      p.push([q.id, r2(q.x), r2(q.z), r2(q.a), Math.ceil(q.hp), q.maxHp, flags, this.mode === 'showdown' ? q.cubes : q.gems,
        Math.round(q.ammo * 100) / 100, Math.round(q.superC * 100) / 100, q.tp, q.alive ? 0 : Math.max(0, Math.ceil(q.respawnAt - this.t))]);
    }
    let sc;
    if (this.mode === 'gemgrab') sc = { s: this.score, cd: this.cdTeam >= 0 ? Math.max(0, Math.ceil(this.cdEnd - this.t)) : null, cdT: this.cdTeam, tl: Math.max(0, Math.ceil(this.timeLimit - this.t)) };
    else if (this.mode === 'bounty') sc = { s: this.kills, tl: Math.max(0, Math.ceil(this.timeLimit - this.t)) };
    else sc = { alive: [...this.players.values()].filter((q) => q.alive).length, gas: this.gas };
    return {
      t: 's', tm: r2(this.t), p,
      pr: this.proj.map((b) => [b.id, b.kind, r2(b.x), r2(b.z), r2(b.vx), r2(b.vz), b.owner]),
      lb: this.lobs.map((l) => [l.id, l.kind, r2(l.sx), r2(l.sz), r2(l.tx), r2(l.tz), r2(l.t), r2(l.dur), l.owner]),
      fd: this.fields.map((f) => [f.id, r2(f.x), r2(f.z), f.r, f.team]),
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
