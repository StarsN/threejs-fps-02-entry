# threejs-fps-02-entry

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/StarsN/threejs-fps-02-entry/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/StarsN/threejs-fps-02-entry/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**SLAGLINE** — a round-based tactical first-person shooter for the browser, in the
style Counter-Strike made famous and built entirely from scratch: an original
dusk-foundry map with two bomb sites, two teams of four, a money economy with a
buy phase, five purchasable weapons plus frag/flash/smoke grenades, and bots
that path a waypoint graph, hold sites, hear your gunfire and retake after a
plant. Accuracy beats speed: spread blooms while you move, crouching and aiming
pay it back, and headshots multiply damage fourfold.

Single-player against bots, from static files — no build step, no network.
three.js 0.187.0 is vendored under `game/vendor/three/` and loaded through the
import map in `game/index.html`. All art is procedural (canvas textures,
box-built guns and fighters) and all sound is synthesised with WebAudio, so the
game ships zero asset files.

## Run it

```sh
node serve.ts
# then open http://localhost:8124 in desktop Chrome (WebGL 2)
```

Any static file server pointed at `game/` works just as well.

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to the output directory and writes `dossier.json` with the kit's
`buildDossier` from `vendor/makefun-threejs.ts`.

## How a match plays

- First to 7 round wins, at most 12 rounds; sides swap after round 6.
- Rounds: 12 s buy phase → 100 s live → if the charge is planted, 40 s to defuse.
- Attackers win by elimination or detonation; defenders by elimination, defuse,
  or running out the clock.
- Money: $800 start, kill $300, plant/defuse $300, round wins $2,400/$2,700,
  losses $1,400 plus a loss-streak bonus. Buy rifles, armour and grenades with B.
- Controls: WASD + mouse, RMB aim, R reload, 1/2/3 weapons, 4/5/6 grenades,
  E (hold) plant/defuse, Ctrl crouch, Shift walk, Space jump, Tab scoreboard.

## Code map

`game/src/` is one module per job: `state.js` (the world's single state
object), `map.js` (the Foundry as data — colliders, sites, waypoint graph —
plus the world built from it), `fighters.js`, `weapons.js` (arsenal and
gunplay maths), `grenades.js`, `bots.js` (perception, pathing, engagements),
`player.js`, `rounds.js` (phases, economy, the bomb), `hud.js`, `minimap.js`,
`fx.js`, `audio.js`, `textures.js`, `palette.js`, `input.js`, and `main.js`
(boot + fixed-step loop). The simulation advances at a fixed 60 Hz, apart from
rendering; effects are pooled so a firefight allocates nothing per frame.

---
<sub>Entered on [make.fun](https://make.fun/?ref=vvry49c9&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
