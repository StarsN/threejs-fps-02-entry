// rounds.js — the match itself: phases, economy, the bomb, and who wins.
// A match is first to 7 round wins over at most 12 rounds, sides swapping after
// round 6. Each round runs buy (12 s) → live (100 s) → maybe planted (40 s) →
// end (5.5 s). This module owns the phase clock, pays the economy (win/loss
// awards, kill and objective bonuses), runs the plant/defuse channels for bots
// and the player alike, drops and recovers the bomb, and hands every bot its
// orders through bots.js. It never touches the DOM — hud.js reads state.

import { state, resetRoundState, attackingTeam, defendingTeam, TEAMS } from './state.js';
import { SPAWNS, SITES, siteAt } from './map.js';
import { input } from './input.js';
import { makeCombatant } from './fighters.js';
import { WEAPONS, makeGun, ARMOR_PRICE, GRENADE_PRICES } from './weapons.js';
import { makeBrain, botNames, botBuy, orderMove, orderHold } from './bots.js';
import { fxExplosion } from './fx.js';
import { sfxPlantBeep, sfxRoundWin } from './audio.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const BOMB_TIME = 40;
export const END_TIME = 5.5;
export const PLANT_TIME = 2.5;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 7;
export const MAX_ROUNDS = 12;

export const ECONOMY = {
  start: 800, winElim: 2400, winObjective: 2700,
  lossBase: 1400, lossStep: 250, lossCap: 1000,
  kill: 300, plant: 300, defuse: 300, plantedLossBonus: 600,
};

export function createMatch() {
  state.combatants.length = 0;
  const player = makeCombatant(TEAMS.EMBER, true, 'YOU');
  player.sidearm = makeGun('sparrow');
  state.combatants.push(player);
  state.player = player;
  for (const team of [TEAMS.EMBER, TEAMS.WARDEN]) {
    const names = botNames(team, team === TEAMS.EMBER ? 3 : 4);
    for (const name of names) {
      const bot = makeCombatant(team, false, name);
      bot.sidearm = makeGun('sparrow');
      bot.brain = makeBrain(bot);
      state.combatants.push(bot);
    }
  }
  state.scores = [0, 0];
  state.lossStreak = [0, 0];
  state.round = 0;
  state.half = 1;
  state.matchWinner = -1;
  for (const c of state.combatants) c.money = ECONOMY.start;
  return state.combatants;
}

function teamMembers(team) {
  return state.combatants.filter((c) => c.team === team);
}
function aliveCount(team) {
  return state.combatants.reduce((n, c) => n + (c.team === team && c.alive ? 1 : 0), 0);
}

// --- round setup ------------------------------------------------------------------

export function startRound() {
  resetRoundState();
  state.round++;
  const atk = attackingTeam();
  const def = defendingTeam();
  const attackers = teamMembers(atk);
  const defenders = teamMembers(def);

  const setup = (c, spawn) => {
    c.x = spawn.x;
    c.z = spawn.z;
    c.y = 0;
    c.vy = 0;
    c.vx = 0;
    c.vz = 0;
    c.yaw = spawn.yaw;
    c.pitch = 0;
    c.hp = 100;
    c.alive = true;
    c.crouch = 0;
    c.bloom = 0;
    c.recoilPitch = 0;
    c.reloadUntil = 0;
    c.switchUntil = 0;
    c.blindUntil = 0;
    c.justDied = false;
    if (!c.sidearm) c.sidearm = makeGun('sparrow');
    c.slot = c.primary ? 'primary' : 'sidearm';
    if (c.brain) {
      c.brain.target = null;
      c.brain.mode = 'advance';
      c.brain.path = [];
    }
  };
  attackers.forEach((c, i) => setup(c, SPAWNS.attack[i % SPAWNS.attack.length]));
  defenders.forEach((c, i) => setup(c, SPAWNS.defend[i % SPAWNS.defend.length]));
  // the dead start over: no rifle, no armour, no grenades carry over a death
  for (const c of state.combatants) {
    if (c.diedLastRound) {
      c.primary = null;
      c.armor = 0;
      c.grenades = { frag: 0, flash: 0, smoke: 0 };
      c.slot = 'sidearm';
      c.diedLastRound = false;
    }
  }

  // the bomb: the player carries it when attacking (their objective to run),
  // otherwise a random attacking bot does
  const player = state.player;
  let carrier;
  if (player.team === atk) carrier = player;
  else {
    const bots = attackers.filter((c) => !c.isPlayer);
    carrier = bots[Math.floor(state.rng() * bots.length)];
  }
  state.bomb.carrier = carrier;

  planRound(atk, def, carrier);
  for (const c of state.combatants) if (c.brain) botBuy(c);

  state.phase = 'buy';
  state.phaseTime = BUY_TIME;
  state.banner = {
    title: `ROUND ${state.round}`,
    sub: player.team === atk ? 'Attack — plant the charge at A or B' : 'Defend — hold the sites',
    until: state.time + 3.2,
  };
}

// Give every bot its orders for the round: attackers converge on one site
// (a lurker shows the other), defenders split across the sites and mid.
function planRound(atk, def, carrier) {
  const siteKey = state.rng() < 0.55 ? 'A' : 'B';
  const otherKey = siteKey === 'A' ? 'B' : 'A';
  const site = SITES[siteKey];
  const other = SITES[otherKey];
  const atkBots = teamMembers(atk).filter((c) => c.brain);
  let escorts = 0;
  for (const bot of atkBots) {
    if (bot === carrier) {
      orderMove(bot, site.cx, site.cz);
    } else if (escorts < 2) {
      escorts++;
      orderMove(bot, site.cx + (escorts === 1 ? 4.5 : -4.5), site.cz + 3.5);
    } else {
      orderMove(bot, other.cx, other.cz); // the lurker
    }
  }
  const holds = [
    { x: -17, z: -16, wx: -12, wz: -11.5 }, // A hall, watching the east door
    { x: -21, z: -5.5, wx: -19.5, wz: -1 }, // A main door
    { x: 16, z: -18, wx: 11.5, wz: -15.5 }, // B yard, watching the west door
    { x: 4, z: -8, wx: -1, wz: -14 }, // mid conveyor
  ];
  const defBots = teamMembers(def).filter((c) => c.brain);
  defBots.forEach((bot, i) => {
    const h = holds[i % holds.length];
    orderHold(bot, h.x, h.z, h.wx, h.wz);
  });
}

// After the plant: attackers dig in around the site, defenders retake —
// the closest defender works the defuse, the rest come with them.
function planPostPlant() {
  const bomb = state.bomb.plantedAt;
  if (!bomb) return;
  const site = SITES[state.bomb.plantSite];
  const atk = attackingTeam();
  const def = defendingTeam();
  const holds = [
    { x: site.cx - 4, z: site.cz + 3.5 },
    { x: site.cx + 4.5, z: site.cz + 2.5 },
    { x: site.cx, z: site.cz + 7 },
    { x: site.cx - 6.5, z: site.cz - 2.5 },
  ];
  teamMembers(atk).filter((c) => c.brain && c.alive).forEach((bot, i) => {
    const h = holds[i % holds.length];
    orderHold(bot, h.x, h.z, bomb.x, bomb.z);
  });
  let closest = null;
  let closestD = Infinity;
  for (const bot of teamMembers(def)) {
    if (!bot.brain || !bot.alive) continue;
    const d = Math.hypot(bot.x - bomb.x, bot.z - bomb.z);
    if (d < closestD) { closestD = d; closest = bot; }
  }
  for (const bot of teamMembers(def)) {
    if (!bot.brain || !bot.alive) continue;
    if (bot === closest) orderMove(bot, bomb.x, bomb.z, 'defuse');
    else orderMove(bot, site.cx + (state.rng() * 6 - 3), site.cz + 4);
  }
}

// --- shopping (player) --------------------------------------------------------------

export function buyForPlayer(item) {
  const p = state.player;
  if (!p || !p.alive || state.phase !== 'buy') return false;
  const pay = (price) => {
    if (p.money < price) return false;
    p.money -= price;
    return true;
  };
  if (item === 'armor') {
    if (p.armor >= 100 || !pay(ARMOR_PRICE)) return false;
    p.armor = 100;
    return true;
  }
  if (item === 'frag' || item === 'flash' || item === 'smoke') {
    if (p.grenades[item] >= 2 || !pay(GRENADE_PRICES[item])) return false;
    p.grenades[item]++;
    return true;
  }
  const def = WEAPONS[item];
  if (!def || def.slot !== 'primary') return false;
  if (p.primary && p.primary.key === item) return false;
  if (!pay(def.price)) return false;
  p.primary = makeGun(item);
  p.slot = 'primary';
  return true;
}

// --- the phase machine ---------------------------------------------------------------

function feed(text) {
  state.feed.push({ text, at: state.time });
  if (state.feed.length > 6) state.feed.shift();
}

function processDeaths() {
  for (const c of state.combatants) {
    if (!c.justDied) continue;
    c.justDied = false;
    c.diedLastRound = true;
    const killer = c.killedBy;
    if (killer && killer.team !== c.team) {
      killer.money += ECONOMY.kill;
      feed(`${killer.name}  ▸  ${c.name}`);
    } else {
      feed(`${c.name}  ▸  down`);
    }
    if (state.bomb.carrier === c) {
      state.bomb.carrier = null;
      state.bomb.droppedAt = { x: c.x, z: c.z };
      // the nearest attacking bot goes to fetch it
      let best = null;
      let bestD = Infinity;
      for (const mate of teamMembers(attackingTeam())) {
        if (!mate.brain || !mate.alive) continue;
        const d = Math.hypot(mate.x - c.x, mate.z - c.z);
        if (d < bestD) { bestD = d; best = mate; }
      }
      if (best) orderMove(best, c.x, c.z, 'fetch');
    }
    if (state.bomb.channel && state.bomb.channel.who === c) state.bomb.channel = null;
  }
}

function processChannels(dt) {
  const bomb = state.bomb;
  const atk = attackingTeam();
  // plant: the carrier, standing in a site — bots commit on arrival, the
  // player holds E so a stray walk-through never plants by accident
  if (!bomb.plantedAt && bomb.carrier && bomb.carrier.alive) {
    const carrier = bomb.carrier;
    const siteKey = siteAt(carrier.x, carrier.z);
    const wants = carrier.isPlayer ? input.keys.has('KeyE') : carrier.brain.mode === 'plant';
    if (siteKey && wants) {
      if (!bomb.channel || bomb.channel.who !== carrier || bomb.channel.kind !== 'plant') {
        bomb.channel = { who: carrier, kind: 'plant', progress: 0, need: PLANT_TIME, site: siteKey };
      }
      bomb.channel.progress += dt;
      if (bomb.channel.progress >= PLANT_TIME) {
        bomb.plantedAt = { x: carrier.x, z: carrier.z };
        bomb.plantSite = siteKey;
        bomb.carrier = null;
        bomb.channel = null;
        carrier.money += ECONOMY.plant;
        state.phase = 'planted';
        state.phaseTime = BOMB_TIME;
        state.banner = { title: 'CHARGE PLANTED', sub: `Site ${siteKey} — ${BOMB_TIME} seconds`, until: state.time + 2.6 };
        sfxPlantBeep(true);
        planPostPlant();
      }
      return;
    }
    if (bomb.channel && bomb.channel.kind === 'plant') bomb.channel = null;
  }
  // defuse: a defender at the device — the player holds E, the bot ordered to
  // defuse commits by standing on it
  if (bomb.plantedAt) {
    let worker = null;
    for (const c of state.combatants) {
      if (!c.alive || c.team === atk) continue;
      if (Math.hypot(c.x - bomb.plantedAt.x, c.z - bomb.plantedAt.z) > 1.8) continue;
      if (c.isPlayer ? input.keys.has('KeyE') : c.brain.mode === 'defuse') { worker = c; break; }
    }
    if (worker) {
      if (!bomb.channel || bomb.channel.who !== worker || bomb.channel.kind !== 'defuse') {
        bomb.channel = { who: worker, kind: 'defuse', progress: 0, need: DEFUSE_TIME };
      }
      bomb.channel.progress += dt;
      if (bomb.channel.progress >= DEFUSE_TIME) {
        worker.money += ECONOMY.defuse;
        endRound(defendingTeam(), 'defuse');
      }
    } else if (bomb.channel && bomb.channel.kind === 'defuse') {
      bomb.channel = null;
    }
  }
}

function processBombPickup() {
  const bomb = state.bomb;
  if (!bomb.droppedAt || bomb.plantedAt) return;
  for (const c of state.combatants) {
    if (!c.alive || c.team !== attackingTeam()) continue;
    if (Math.hypot(c.x - bomb.droppedAt.x, c.z - bomb.droppedAt.z) < 1.15) {
      bomb.carrier = c;
      bomb.droppedAt = null;
      if (c.brain) {
        const site = SITES[state.rng() < 0.5 ? 'A' : 'B'];
        orderMove(c, site.cx, site.cz);
      }
      return;
    }
  }
}

// A bot carrier that has reached its site commits to the plant, keeping the
// facing it arrived with so it watches the way it came in.
function processCarrierArrival() {
  const carrier = state.bomb.carrier;
  if (!carrier || !carrier.brain || state.bomb.plantedAt) return;
  if (siteAt(carrier.x, carrier.z) && carrier.brain.mode !== 'plant') {
    carrier.brain.mode = 'plant';
    carrier.brain.holdX = carrier.x - Math.sin(carrier.yaw) * 5;
    carrier.brain.holdZ = carrier.z - Math.cos(carrier.yaw) * 5;
  }
}

function endRound(winner, reason) {
  state.winner = winner;
  state.winReason = reason;
  state.scores[winner]++;
  const loser = 1 - winner;
  state.lossStreak[winner] = 0;
  state.lossStreak[loser]++;
  const winAward = reason === 'elimination' ? ECONOMY.winElim : ECONOMY.winObjective;
  const lossAward = ECONOMY.lossBase + Math.min(ECONOMY.lossCap, (state.lossStreak[loser] - 1) * ECONOMY.lossStep)
    + (state.bomb.plantedAt && loser === attackingTeam() ? ECONOMY.plantedLossBonus : 0);
  for (const c of state.combatants) c.money += c.team === winner ? winAward : lossAward;
  if (reason === 'detonation' && state.bomb.plantedAt) {
    fxExplosion(state.bomb.plantedAt.x, 1, state.bomb.plantedAt.z, performance.now() / 1000);
    state.shake = 0.8;
  }
  const reasonText = {
    elimination: 'by elimination', detonation: 'by detonation',
    defuse: 'by defuse', time: 'on time',
  }[reason];
  state.banner = {
    title: `${winner === TEAMS.EMBER ? 'EMBER' : 'WARDEN'} TAKE THE ROUND`,
    sub: `${reasonText} — score ${state.scores[0]} : ${state.scores[1]}`,
    until: state.time + END_TIME - 0.4,
  };
  sfxRoundWin(state.player && winner === state.player.team);
  state.phase = 'end';
  state.phaseTime = END_TIME;
  state.bomb.channel = null;
}

export function stepRounds(dt) {
  processDeaths();
  if (state.phase === 'buy' || state.phase === 'live' || state.phase === 'planted') {
    state.phaseTime -= dt;
    processChannels(dt);
    processBombPickup();
    processCarrierArrival();
    const atkAlive = aliveCount(attackingTeam());
    const defAlive = aliveCount(defendingTeam());
    if (state.phase === 'live') {
      if (atkAlive === 0) endRound(defendingTeam(), 'elimination');
      else if (defAlive === 0) endRound(attackingTeam(), 'elimination');
      else if (state.phaseTime <= 0) endRound(defendingTeam(), 'time');
    } else if (state.phase === 'planted') {
      // with the charge live, wiping the defenders ends it at once; wiping
      // the attackers does not — the defenders still have to defuse, and if
      // they never do, the clock gives the attackers the detonation
      if (defAlive === 0) endRound(attackingTeam(), 'elimination');
      else if (state.phaseTime <= 0) endRound(attackingTeam(), 'detonation');
    } else if (state.phase === 'buy' && state.phaseTime <= 0) {
      state.phase = 'live';
      state.phaseTime = ROUND_TIME;
      state.banner = null;
    }
  } else if (state.phase === 'end') {
    state.phaseTime -= dt;
    if (state.phaseTime <= 0) {
      const [a, b] = state.scores;
      if (a >= WIN_ROUNDS || b >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
        state.matchWinner = a === b ? -1 : (a > b ? TEAMS.EMBER : TEAMS.WARDEN);
        state.phase = 'matchend';
        state.banner = {
          title: state.matchWinner === -1 ? 'DEADLOCK' : `${state.matchWinner === TEAMS.EMBER ? 'EMBER' : 'WARDEN'} WIN THE FOUNDRY`,
          sub: `Final score ${a} : ${b} — press Enter for a new match`,
          until: state.time + 9999,
        };
      } else {
        if (state.round === 6) {
          state.half = 2;
          state.banner = { title: 'SIDES SWAP', sub: 'Second half — roles reversed', until: state.time + 2.5 };
        }
        startRound();
      }
    }
  }
  // the planted charge ticks faster as it nears detonation (audio flavour)
  if (state.phase === 'planted' && state.bomb.plantedAt) {
    const left = state.phaseTime;
    const interval = left < 5 ? 0.25 : left < 15 ? 0.5 : 1;
    if (Math.abs(left / interval - Math.round(left / interval)) < dt / interval) sfxPlantBeep(false);
  }
}
