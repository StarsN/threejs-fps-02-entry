// bots.js — the other seven fighters.
// Each bot runs a small brain on a staggered think tick: perceive (sight through
// the same raycasts the bullets use, plus hearing gunfire), then act — follow
// the waypoint graph to a plan, hold a site, engage what it sees with burst
// fire and strafing, plant or defuse when the round asks for it. Bots buy their
// own guns from the same economy as the player, and they miss: aim error and
// reaction time are rolled per bot, so some are simply better than others.

import { state, attackingTeam } from './state.js';
import { NODES, nearestNode, findPath, losClear, collideCircle } from './map.js';
import { eyeHeight } from './fighters.js';
import { WEAPONS, makeGun, tryShoot, startReload, switchSlot, ARMOR_PRICE } from './weapons.js';
import { throwGrenade, smokeBlocks } from './grenades.js';

const BOT_NAMES = [
  ['Vex', 'Ondo', 'Rill'], // EMBER teammates (the player is the fourth)
  ['Hale', 'Mira', 'Tonn', 'Sef'], // WARDEN
];

export function makeBrain(c) {
  const rng = state.rng;
  const skill = 0.55 + rng() * 0.45; // 0.55..1 — reaction and aim scale off this
  return {
    skill,
    reactTime: 0.55 - skill * 0.3, // 0.385..0.25 s to first shot on a fresh target
    aimErr: 0.034 - skill * 0.018,
    thinkAt: 0, burstLeft: 0, burstPauseUntil: 0, reactAt: 0,
    target: null, lastSeenAt: -9, lastSeenX: 0, lastSeenZ: 0,
    path: [], pathI: 0, objective: null, // {x, z} the bot is walking to
    mode: 'advance', // advance | hold | engage | plant | defuse | fetch
    holdX: 0, holdZ: 0, holdYaw: 0, holdUntil: 0,
    strafeDir: 1, strafeFlipAt: 0, crouchWanted: false,
    site: 'A', grenadeCheckedAt: 0, stuckX: 0, stuckZ: 0, stuckAt: 0,
  };
}

export function botNames(team, count) {
  return BOT_NAMES[team].slice(0, count);
}

// --- perception -----------------------------------------------------------------

function canSee(c, other) {
  if (state.time < c.blindUntil) return false;
  const dx = other.x - c.x;
  const dz = other.z - c.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 48) return false;
  if (dist > 2.6) {
    // field of view: 115 degrees around the facing direction
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    if ((dx * fx + dz * fz) / dist < 0.42) return false;
  }
  const eye = eyeHeight(c);
  const chestY = other.y + 1.05;
  if (!losClear(c.x, eye, c.z, other.x, chestY, other.z)) return false;
  if (smokeBlocks(c.x, eye, c.z, other.x, chestY, other.z)) return false;
  return true;
}

function perceive(c) {
  const b = c.brain;
  let best = null;
  let bestD = Infinity;
  for (const other of state.combatants) {
    if (other === c || !other.alive || other.team === c.team) continue;
    if (canSee(c, other)) {
      const d = Math.hypot(other.x - c.x, other.z - c.z);
      if (d < bestD) { bestD = d; best = other; }
    }
  }
  if (best) {
    if (b.target !== best) b.reactAt = state.time + b.reactTime;
    b.target = best;
    b.lastSeenAt = state.time;
    b.lastSeenX = best.x;
    b.lastSeenZ = best.z;
  } else {
    // hearing: the freshest enemy gunshot within earshot becomes a suspicion
    for (let i = state.lastShots.length - 1; i >= 0; i--) {
      const s = state.lastShots[i];
      if (s.team === c.team || state.time - s.at > 1.4) continue;
      const range = s.kind === 'step' ? 9 : 21;
      if (Math.hypot(s.x - c.x, s.z - c.z) < range) {
        b.lastSeenAt = state.time;
        b.lastSeenX = s.x;
        b.lastSeenZ = s.z;
      }
      break;
    }
    if (state.time - b.lastSeenAt > 2.2) b.target = null;
  }
}

// --- movement -------------------------------------------------------------------

function moveToward(c, tx, tz, speed, dt) {
  const dx = tx - c.x;
  const dz = tz - c.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) {
    c.vx *= 0.6;
    c.vz *= 0.6;
    c.speed = Math.hypot(c.vx, c.vz);
    return true;
  }
  const cap = Math.min(speed, dist / dt * 0.9 + 0.4);
  const accel = 30;
  c.vx += (dx / dist) * accel * dt;
  c.vz += (dz / dist) * accel * dt;
  const spd = Math.hypot(c.vx, c.vz);
  if (spd > cap) {
    c.vx = (c.vx / spd) * cap;
    c.vz = (c.vz / spd) * cap;
  }
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  collideCircle(c, 0.35);
  c.speed = Math.hypot(c.vx, c.vz);
  return dist < 0.9;
}

function faceToward(c, tx, tz, dt, rate = 9) {
  const want = Math.atan2(-(tx - c.x), -(tz - c.z));
  let diff = want - c.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
  return Math.abs(diff);
}

function setPathTo(c, tx, tz) {
  const b = c.brain;
  const from = nearestNode(c.x, c.z);
  const to = nearestNode(tx, tz);
  b.path = findPath(from, to);
  b.pathI = 0;
  b.objective = { x: tx, z: tz };
}

function followPath(c, dt, speed) {
  const b = c.brain;
  if (!b.objective) return true;
  if (b.pathI < b.path.length) {
    const node = NODES[b.path[b.pathI]];
    const arrived = moveToward(c, node.x, node.z, speed, dt);
    faceToward(c, node.x, node.z, dt, 6);
    if (arrived) b.pathI++;
    return false;
  }
  return moveToward(c, b.objective.x, b.objective.z, speed, dt);
}

// --- combat ---------------------------------------------------------------------

function engage(c, dt) {
  const b = c.brain;
  const t = b.target;
  if (!t || !t.alive) { b.mode = 'advance'; return; }
  const dx = t.x - c.x;
  const dz = t.z - c.z;
  const dist = Math.hypot(dx, dz);
  // aim at the chest, or the head up close where a bot can hold it steady;
  // error grows with both fighters' movement, per the gunplay rules
  const aimY = t.y + (dist < 11 && b.skill > 0.75 ? 1.5 : 1.05);
  const eye = eyeHeight(c);
  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.atan2(aimY - eye, dist);
  let dyaw = wantYaw - c.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const turnRate = 6.5 * b.skill;
  c.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, dyaw));
  c.pitch += Math.max(-turnRate * dt, Math.min(turnRate * dt, wantPitch - c.pitch));

  // movement: close in from range, back off point-blank, strafe between
  if (state.time > b.strafeFlipAt) {
    b.strafeDir = state.rng() < 0.5 ? -1 : 1;
    b.strafeFlipAt = state.time + 0.7 + state.rng() * 0.8;
  }
  const rx = Math.cos(c.yaw) * b.strafeDir;
  const rz = -Math.sin(c.yaw) * b.strafeDir;
  let mx = rx;
  let mz = rz;
  if (dist > 24) { mx += dx / dist * 0.9; mz += dz / dist * 0.9; }
  if (dist < 6) { mx -= dx / dist * 0.7; mz -= dz / dist * 0.7; }
  const ml = Math.hypot(mx, mz) || 1;
  c.vx += (mx / ml) * 26 * dt;
  c.vz += (mz / ml) * 26 * dt;
  const spd = Math.hypot(c.vx, c.vz);
  const cap = 2.1;
  if (spd > cap) { c.vx = (c.vx / spd) * cap; c.vz = (c.vz / spd) * cap; }
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  collideCircle(c, 0.35);
  c.speed = Math.hypot(c.vx, c.vz);
  b.crouchWanted = dist > 13 && spd < 0.6;

  // fire control: bursts with pauses, only once the aim has settled and the
  // reaction time on a fresh target has elapsed
  const gun = c.slot === 'melee' ? null : (c.slot === 'primary' ? c.primary : c.sidearm);
  if (gun && gun.mag === 0) startReload(c);
  const aimOff = Math.abs(dyaw) + Math.abs(wantPitch - c.pitch);
  if (state.time >= b.reactAt && aimOff < 0.09 + b.aimErr * 2) {
    if (b.burstLeft > 0) {
      // wobble the point of aim by the bot's error before the shared shot code runs
      const err = b.aimErr * (1 + t.speed * 0.22 + c.speed * 0.3);
      c.pitch += (state.rng() - 0.5) * 2 * err * 0.4;
      if (tryShoot(c, true)) b.burstLeft--;
    } else if (state.time >= b.burstPauseUntil) {
      b.burstLeft = 3 + Math.floor(state.rng() * 3);
      b.burstPauseUntil = state.time + 0.38 + state.rng() * 0.4 + b.burstLeft * 0.12;
    }
  }
  // a frag for a target holding still behind cover, once in a while
  if (c.grenades.frag > 0 && dist > 9 && dist < 23 && state.time > b.grenadeCheckedAt) {
    b.grenadeCheckedAt = state.time + 4;
    if (state.rng() < 0.3) {
      c.pitch += 0.24;
      throwGrenade(c, 'frag');
    }
  }
}

// --- the brain's step -------------------------------------------------------------

export function stepBot(c, dt) {
  const b = c.brain;
  if (!c.alive) return;
  const now = state.time;
  if (now >= b.thinkAt) {
    b.thinkAt = now + 0.11 + (c.id % 4) * 0.017;
    perceive(c);
  }
  c.crouch = Math.max(0, Math.min(1, c.crouch + ((b.crouchWanted ? 1 : 0) - c.crouch) * dt * 6));
  b.crouchWanted = false;

  if (b.target && b.target.alive && now - b.lastSeenAt < 0.4) {
    b.mode = 'engage';
    engage(c, dt);
    return;
  }
  if (b.mode === 'engage') b.mode = 'advance';

  // round-driven intentions, set by rounds.js through brain fields
  if (b.mode === 'plant') {
    // stand on the spot and work; rounds.js runs the channel itself
    c.vx *= 0.5;
    c.vz *= 0.5;
    c.speed = Math.hypot(c.vx, c.vz);
    faceToward(c, b.holdX, b.holdZ, dt, 4);
    return;
  }
  if (b.mode === 'defuse') {
    // walk to the device first; only kneel and work once on top of it
    const d = b.objective ? Math.hypot(b.objective.x - c.x, b.objective.z - c.z) : 0;
    if (d > 1.6) {
      followPath(c, dt, 4.1);
    } else {
      c.vx *= 0.5;
      c.vz *= 0.5;
      c.speed = Math.hypot(c.vx, c.vz);
    }
    return;
  }
  if (b.mode === 'hold') {
    const arrived = followPath(c, dt, 3.9);
    if (arrived) {
      c.vx *= 0.6;
      c.vz *= 0.6;
      c.speed = Math.hypot(c.vx, c.vz);
      // watch the threat direction, sweeping a little
      const sweep = Math.sin(now * 0.55 + c.id * 2.1) * 0.45;
      let diff = (b.holdYaw + sweep) - c.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.yaw += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
      c.pitch *= 0.9;
    }
    return;
  }
  // advance / fetch: walk the path; face travel direction (followPath does)
  followPath(c, dt, 3.9);
}

// Tell a bot where its round is going. rounds.js calls this whenever plans
// change: round start, bomb dropped, bomb planted.
export function orderMove(c, tx, tz, mode = 'advance') {
  c.brain.mode = mode;
  setPathTo(c, tx, tz);
}
export function orderHold(c, tx, tz, watchX, watchZ) {
  const b = c.brain;
  b.mode = 'hold';
  b.holdX = watchX;
  b.holdZ = watchZ;
  b.holdYaw = Math.atan2(-(watchX - tx), -(watchZ - tz));
  setPathTo(c, tx, tz);
}

// --- shopping ---------------------------------------------------------------------

export function botBuy(c) {
  const rng = state.rng;
  const spend = (price) => { c.money -= price; };
  if (!c.primary) {
    if (c.money >= WEAPONS.osprey.price && rng() < 0.3) { c.primary = makeGun('osprey'); spend(WEAPONS.osprey.price); }
    else if (c.money >= WEAPONS.longshot.price) { c.primary = makeGun('longshot'); spend(WEAPONS.longshot.price); }
    else if (c.money >= WEAPONS.jackhammer.price && rng() < 0.4) { c.primary = makeGun('jackhammer'); spend(WEAPONS.jackhammer.price); }
    else if (c.money >= WEAPONS.wasp.price) { c.primary = makeGun('wasp'); spend(WEAPONS.wasp.price); }
  }
  if (c.primary) switchSlot(c, 'primary');
  if (c.armor < 60 && c.money >= ARMOR_PRICE && rng() < 0.75) { c.armor = 100; spend(ARMOR_PRICE); }
  if (c.money > 1000 && c.grenades.frag === 0 && rng() < 0.5) { c.grenades.frag = 1; spend(300); }
  if (c.money > 900 && c.grenades.smoke === 0 && rng() < 0.3) { c.grenades.smoke = 1; spend(300); }
  if (c.money > 900 && c.grenades.flash === 0 && rng() < 0.3) { c.grenades.flash = 1; spend(250); }
  // top up ammunition for whatever is carried
  for (const gun of [c.primary, c.sidearm]) {
    if (gun) gun.reserve = Math.max(gun.reserve, gun.def.reserve);
  }
}
