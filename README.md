# Breakwater Nine

A round-based tactical first-person shooter for the browser, built on
three.js 0.187.0. Two teams of four fight over a dusk container port: the
**Wardens** hold two sites — the Crane Pad and Fuel Row — while the
**Runners** push the lanes to plant a breach charge. Win rounds by
eliminating the other team, running the clock down, defusing the charge, or
detonating it. Money earned each round is spent in the buy phase on better
weapons and grenades. Single-player against bots, fully offline: static
files, no build step, no network requests.

## Play

```sh
node serve.ts          # then open http://localhost:8080
```

Any static file server pointed at `game/` works the same way.

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the game to lock the pointer) |
| Click / hold | Fire |
| R | Reload |
| 1 / 2 / 3 | Sidearm / SMG or rifle slot / grenade in hand |
| G | Throw grenade |
| E (hold) | Defuse the charge |
| Ctrl or C | Crouch |
| Shift | Walk (quiet, tighter spread) |
| Space | Jump |
| B | Buy menu (during the buy phase) |
| Tab | Scoreboard |

## Layout

- `main.ts` — the hand-in program: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json` with the vendored library.
- `game/` — the playable game. `index.html` holds the one import map;
  `game/src/` is one module per job (world, player, weapons, grenades, bots,
  rounds, hud, audio, input); `game/vendor/three/` is three.js 0.187.0,
  vendored byte for byte.
- `vendor/makefun-threejs.ts` — the make.fun dossier library, unchanged.
- `screenshots/` — real renders of the game, taken from its own shot modes
  (`?shot=start|buy|play|end&seed=N`, see `shots.json`).

## License

MIT — see `LICENSE`. three.js is MIT-licensed by its authors; its license
ships at `game/vendor/three/LICENSE`.
