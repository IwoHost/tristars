# ★ TriStars

A little 3D brawler party game (Brawl Stars style) that you play with friends over your local Wi-Fi.
No store, no accounts, no grinding — just pick a brawler and fight. Made mainly for phones.

## Run it

You need [Node.js](https://nodejs.org) 18+ on one computer (the "host").

```bash
npm install
npm start
```

The server prints addresses like:

```
On phones (same Wi-Fi):  http://192.168.1.23:3000
```

Everyone opens that address in their phone browser (must be on the same Wi-Fi as the host computer).
The first player to join is the host 👑 and picks the mode and presses **START**.
If it doesn't connect, allow Node through the computer's firewall.

Tip: on Android tap ⛶ for fullscreen and play in landscape. On iPhone use "Add to Home Screen" for a fuller screen.

## Modes

- **💎 Gem Grab** — gems spawn in the middle. Hold 10+ gems as a team for 15 seconds to win. Dying drops your gems!
- **⭐ Bounty** — first team to 10 knockouts.
- **💀 Showdown** — free-for-all on a random map. Break boxes for power cubes (more HP & damage). Poison gas closes in.

"Fill with bots" adds bots so even 1–2 players get full 3v3 / 8-player matches.

## Brawlers

| | Brawler | Attack | Super |
|---|---|---|---|
| 🤠 | Blaze | Long burst of bullets | Bullet storm that breaks walls |
| 💥 | Bruno | Shotgun spread | Big blast with knockback |
| 💣 | Pip | Lobs 2 bombs over walls | Huge barrel bomb |
| 🥊 | Tank | Fast punches, 6000 HP | Jump and smash |
| 🌵 | Cactus | Needle ball that splits into spikes | Slowing cactus field |
| 🎸 | Melody | Wide piercing sound wave | Heals the whole team |

## Controls

**Phone:** left side = move joystick. Attack button: **tap** to auto-aim, **drag** to aim and release to fire.
Same for the ⚡ super button once it's charged (charge it by hitting enemies). Hide in bushes!

**Keyboard:** WASD to move, mouse to aim, left click attack, right click / E super, Space auto-attack.

## How it works

- `server.js` — Node HTTP + WebSocket server. Runs the game at 30 ticks/sec (projectiles, damage, bots, modes) and sends each player a snapshot. Enemies hiding in bushes are not sent to you.
- `public/main.js` — three.js client: rendering, touch controls, interpolation, sounds.
- `public/shared.js` — brawler stats, maps and collision code used by both sides. Tweak numbers here to rebalance.
