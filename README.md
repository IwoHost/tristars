# ★ TriStars

A little 3D brawler party game (Brawl Stars style) that you play with friends over your local Wi-Fi.
No store, no accounts, no grinding — just pick a brawler and fight. Made mainly for phones.

## Play with room codes (no computer needed)

1. Open the game page (the GitHub Pages link, e.g. `https://<you>.github.io/tristars/`).
2. One person taps **HOST GAME** and gets a 4-letter room code (plus a link to share).
3. Friends open the page, type the code and tap **JOIN** (or just open the shared link).

The host's phone runs the match, and the other phones connect straight to it (peer-to-peer over WebRTC).
Internet is only needed for the first few seconds to find each other (via the free PeerJS server).
The host should keep the screen on and the game open, because if the host leaves, the match ends.

### Putting it on GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and deploys `public/` on every push to `main`.
In the repo settings go to **Pages → Source: GitHub Actions**, then push to `main` (or run the workflow manually).

To host it anywhere else: `npm install && npm run build`, then upload the `public/` folder to any static host (it must be **https** for wake-lock/fullscreen to work well).

Want your own signaling server instead of the PeerJS cloud? Run a [PeerServer](https://github.com/peers/peerjs-server) and open the page with `?peer=yourhost:9000`.

## Or run a Wi-Fi server on a computer

You need [Node.js](https://nodejs.org) 18+ on one computer.

```bash
npm install
npm start
```

It prints an address like `http://192.168.1.23:3000`. Everyone on the same Wi-Fi opens it and taps **PLAY ON THIS WI-FI SERVER**.
The first player to join is the host 👑, who picks the mode and presses **START**.
If phones can't connect, allow Node through the computer's firewall. This mode works fully offline.

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

- `public/room.js` — the whole game simulation + lobby (30 ticks/sec: projectiles, damage, bots, modes). Runs either inside the host's browser (room codes) or in Node (`server.js`). Enemies hiding in bushes are not sent to you.
- `server.js` — optional Node HTTP + WebSocket server for the Wi-Fi mode.
- `public/main.js` — three.js client: rendering, touch controls, interpolation, sounds.
- `public/shared.js` — brawler stats, maps and collision code used by both sides. Tweak numbers here to rebalance.
