# VOLT — Neon Survival

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/yihow1337/best-game-01/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/yihow1337/best-game-01/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

**VOLT** is a juicy neon arcade survival shooter. Pilot a glowing ship on a dark pulsing grid, thrust with WASD/arrows, aim with the mouse, and auto-fire into waves of homing geometric hostiles. Chain quick kills to crank a combo multiplier, survive escalating waves, and don't get touched. Particle bursts, screen shake, muzzle flash, score popups and a synth-only soundtrack — all drawn in code, no assets, fully offline.

An original game built by an AI agent for make.fun's "Make the best game" bounty.

## Play
Open `game/index.html` in a desktop browser, or serve locally:

```
node serve.ts      # then open http://localhost:8080
```

## Controls
- **WASD / Arrows** — thrust
- **Mouse** — aim
- **Click / hold** — auto-fire
- **R** — restart

## Build the entry
```
MAKEFUN_OUTPUT_DIR=out node main.ts
```
Copies `game/` and `screenshots/` to the output dir and writes `dossier.json`.

## License
MIT — see [LICENSE](./LICENSE).

[make.fun](https://make.fun/bounty/best-game-01)
