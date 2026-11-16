// state.js — the one place SLAGLINE keeps its mutable world.
//
// Every other module reads and writes through this object instead of growing its own
// globals, so a round reset is a single function here and the HUD never has to guess
// where a number lives. Rendering state (three.js objects) hangs off `view`; simulation
// state is plain data the fixed-step loop can advance without touching the scene graph.

// mulberry32: a tiny seeded RNG. The simulation never calls Math.random, so a seed plus
// the same inputs replays the same round — the screenshot scenes rely on that.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TEAMS = { EMBER: 0, WARDEN: 1 };
export const TEAM_NAMES = ['EMBER', 'WARDEN'];

export const state = {
  rng: makeRng(1),
  time: 0, // simulation seconds since the match started; only the fixed step advances it

  phase: 'menu', // menu | buy | live | planted | end | matchend
  phaseTime: 0, // seconds left in the current phase (round timer while live)
  round: 0,
  half: 1,
  scores: [0, 0], // rounds won, by team id
  lossStreak: [0, 0],
  winner: -1, // team that won the last round, -1 while undecided
  winReason: '', // elimination | detonation | defuse | time
  matchWinner: -1,

  player: null, // the human's combatant (also lives in combatants)
  spectating: null, // the teammate the dead player's camera rides, if any
  combatants: [], // every fighter, human and bots alike
  projectiles: [], // thrown grenades in flight
  smokes: [], // active smoke clouds {x,y,z,r,until}
  bomb: {
    carrier: null, // combatant holding the device, or null
    droppedAt: null, // {x,z} while it lies on the ground
    plantedAt: null, // {x,z} once planted
    plantSite: '', // 'A' | 'B'
    detonateAt: 0, // sim time of detonation while planted
    channel: null, // {who, kind: 'plant'|'defuse', until} while someone works the device
  },
  lastShots: [], // recent gunfire {x,z,team,at} — bots hear these, the minimap blips them
  feed: [], // kill feed lines {text, at}
  banner: null, // {title, sub, until} centre-screen announcement
  shake: 0, // camera shake amplitude, decays in the render loop
  hitmarkAt: 0, // last time the player landed a hit (HUD marker)
  killmarkAt: 0,
};

// The side each team plays this half: in half 1 EMBER attacks; the halves swap after
// round 6. Attackers plant, defenders defuse.
export function attackingTeam() {
  return state.half === 1 ? TEAMS.EMBER : TEAMS.WARDEN;
}
export function defendingTeam() {
  return 1 - attackingTeam();
}
export function teamOf(combatant) {
  return combatant.team;
}
export function isAttacker(combatant) {
  return combatant.team === attackingTeam();
}

// Wipe the per-round world back to a clean slate. Match-long facts (scores, money on
// each combatant) survive; positions, health and the bomb are the round modules' job.
export function resetRoundState() {
  state.projectiles.length = 0;
  state.smokes.length = 0;
  state.lastShots.length = 0;
  state.bomb.carrier = null;
  state.bomb.droppedAt = null;
  state.bomb.plantedAt = null;
  state.bomb.plantSite = '';
  state.bomb.detonateAt = 0;
  state.bomb.channel = null;
  state.winner = -1;
  state.winReason = '';
}
