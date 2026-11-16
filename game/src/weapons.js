// weapons.js — the arsenal and the gunplay maths.
// Five purchasable guns plus a melee tool, each a row of numbers: damage by body
// part (head ×4, legs ×0.75), distance falloff, and a spread model where moving,
// jumping and sustained fire all cost accuracy while crouching and aiming pay it
// back — stopping to shoot is the skill this genre is about. Firing is hitscan:
// a ray against the map's boxes and three spheres per enemy body, resolved here
// so the human and the bots play by identical rules.

import * as THREE from 'three';
import { state } from './state.js';
import { rayHitWalls } from './map.js';
import { eyeHeight } from './fighters.js';
import { fxTracer, fxSparks, fxMuzzle } from './fx.js';
import { sfxShot, sfxDryFire, sfxReload, sfxHit, sfxHurt } from './audio.js';

export const WEAPONS = {
  sparrow: {
    name: 'P9 Sparrow', slot: 'sidearm', price: 0, sound: 'pistol',
    damage: 26, rpm: 320, auto: false, mag: 12, reserve: 96, reload: 1.5,
    spread: 0.010, moveSpread: 0.030, recoil: 0.011, range: 18, minScale: 0.45,
    pellets: 1, zoom: 1.25, speedFactor: 1.0, len: 0.34,
  },
  wasp: {
    name: 'VK-7 Wasp', slot: 'primary', price: 1200, sound: 'smg',
    damage: 19, rpm: 760, auto: true, mag: 32, reserve: 128, reload: 2.1,
    spread: 0.020, moveSpread: 0.034, recoil: 0.0075, range: 12, minScale: 0.5,
    pellets: 1, zoom: 1.2, speedFactor: 0.98, len: 0.52,
  },
  longshot: {
    name: 'AR-9 Longshot', slot: 'primary', price: 2700, sound: 'rifle',
    damage: 34, rpm: 600, auto: true, mag: 30, reserve: 120, reload: 2.4,
    spread: 0.008, moveSpread: 0.036, recoil: 0.013, range: 25, minScale: 0.6,
    pellets: 1, zoom: 1.3, speedFactor: 0.95, len: 0.72,
  },
  jackhammer: {
    name: 'BR-4 Jackhammer', slot: 'primary', price: 1500, sound: 'shotgun',
    damage: 9, rpm: 68, auto: false, mag: 6, reserve: 32, reload: 3.0,
    spread: 0.052, moveSpread: 0.03, recoil: 0.05, range: 8, minScale: 0.25,
    pellets: 8, zoom: 1.15, speedFactor: 0.94, len: 0.62,
  },
  osprey: {
    name: 'DMR-12 Osprey', slot: 'primary', price: 3500, sound: 'dmr',
    damage: 68, rpm: 150, auto: false, mag: 10, reserve: 50, reload: 2.6,
    spread: 0.0022, moveSpread: 0.05, recoil: 0.034, range: 40, minScale: 0.75,
    pellets: 1, zoom: 2.4, speedFactor: 0.92, len: 0.86,
  },
};
export const MELEE = { name: 'Trench Tool', damage: 55, range: 1.7, rate: 0.48 };
export const ARMOR_PRICE = 650;
export const GRENADE_PRICES = { frag: 300, flash: 250, smoke: 300 };

export function makeGun(key) {
  const def = WEAPONS[key];
  return { key, def, mag: def.mag, reserve: def.reserve };
}
export function gunOf(c) {
  return c.slot === 'primary' ? c.primary : c.slot === 'sidearm' ? c.sidearm : null;
}

// Body-part spheres, matching the proportions fighters.js builds: returns the
// nearest hit distance along the ray and which part, or null.
const PARTS = [
  { part: 'head', dy: 1.5, crouchDy: 1.04, r: 0.215, mult: 4 },
  { part: 'torso', dy: 1.02, crouchDy: 0.72, r: 0.36, mult: 1 },
  { part: 'legs', dy: 0.42, crouchDy: 0.3, r: 0.3, mult: 0.75 },
];
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  return tca - Math.sqrt(r2 - d2);
}

function falloff(def, dist) {
  if (dist <= def.range) return 1;
  const t = Math.min(1, (dist - def.range) / (def.range * 1.6));
  return 1 - t * (1 - def.minScale);
}

// Apply damage with armour soak; on death, record the kill for rounds.js to
// settle (money, feed, bomb drop, round-end checks all live there).
export function applyDamage(victim, amount, attacker, part) {
  if (!victim.alive || state.phase === 'buy' || state.phase === 'end' || state.phase === 'matchend') return;
  let dmg = amount;
  if (victim.armor > 0) {
    const soaked = dmg * 0.45;
    victim.armor = Math.max(0, victim.armor - soaked);
    dmg -= soaked;
  }
  victim.hp -= dmg;
  victim.lastHurtAt = state.time;
  victim.lastHurtBy = attacker;
  if (victim.isPlayer) sfxHurt();
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.diedAt = state.time;
    victim.deaths++;
    victim.justDied = true;
    victim.killedBy = attacker;
    if (attacker) attacker.kills++;
  }
}

function spreadFor(c, def) {
  let s = def.spread + (c.speed / 4.6) * def.moveSpread + c.bloom * 0.0035;
  if (!c.grounded) s += 0.055;
  if (c.crouch > 0.5) s *= 0.72;
  if (c.aiming) s *= 0.5;
  return s;
}

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

// One trigger pull (or one tick of automatic fire). Returns true if a shot left
// the barrel. Bots call this with their brain's aim already on yaw/pitch.
export function tryShoot(c, wantFire) {
  const now = state.time;
  if (!c.alive || now < c.switchUntil || now < c.nextShotAt) return false;
  if (state.phase === 'buy' || state.phase === 'menu' || state.phase === 'matchend') return false;
  if (c.slot === 'melee') return false;
  const gun = gunOf(c);
  if (!gun) return false;
  if (now < c.reloadUntil) return false;
  if (!wantFire) return false;
  const def = gun.def;
  if (gun.mag <= 0) {
    if (c.isPlayer) {
      sfxDryFire();
      startReload(c);
    }
    c.nextShotAt = now + 0.3;
    return false;
  }
  gun.mag--;
  c.nextShotAt = now + 60 / def.rpm;
  c.bloom = Math.min(6, c.bloom + 1);
  c.recoilPitch += def.recoil;

  const spread = spreadFor(c, def);
  const eye = eyeHeight(c);
  const rng = state.rng;
  // muzzle origin: a little ahead of the eye so tracers leave the gun, not the face
  const fx = -Math.sin(c.yaw);
  const fz = -Math.cos(c.yaw);
  const mx = c.x + fx * 0.45 + Math.cos(c.yaw) * 0.16;
  const mz = c.z + fz * 0.45 - Math.sin(c.yaw) * 0.16;
  const my = eye - 0.14;
  fxMuzzle(mx, my, mz, performance.now() / 1000);

  let anyHit = false;
  for (let p = 0; p < def.pellets; p++) {
    const gx = (rng() + rng() + rng()) / 1.5 - 1;
    const gy = (rng() + rng() + rng()) / 1.5 - 1;
    // build the shot direction from yaw/pitch (plus the recoil the gun has
    // already kicked into the view), then cone-offset it along the view's
    // right and up axes by the (roughly gaussian) g-rolls
    const aimPitch = c.pitch + c.recoilPitch;
    const cp = Math.cos(aimPitch);
    _dir.set(-Math.sin(c.yaw) * cp, Math.sin(aimPitch), -Math.cos(c.yaw) * cp);
    _right.set(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    _up.crossVectors(_right, _dir);
    _dir.addScaledVector(_right, gx * spread).addScaledVector(_up, gy * spread);
    _dir.normalize();
    const wallDist = rayHitWalls(c.x, eye, c.z, _dir.x, _dir.y, _dir.z, 120);
    let bestT = wallDist;
    let victim = null;
    let hitPart = null;
    for (const other of state.combatants) {
      if (other === c || !other.alive || other.team === c.team) continue;
      for (const part of PARTS) {
        const cy = other.y + (other.crouch > 0.5 ? part.crouchDy : part.dy);
        const t = raySphere(c.x, eye, c.z, _dir.x, _dir.y, _dir.z, other.x, cy, other.z, part.r);
        if (t > 0 && t < bestT) {
          bestT = t;
          victim = other;
          hitPart = part;
        }
      }
    }
    const hx = c.x + _dir.x * bestT;
    const hy = eye + _dir.y * bestT;
    const hz = c.z + _dir.z * bestT;
    fxTracer(mx, my, mz, hx, hy, hz, performance.now() / 1000);
    if (victim) {
      anyHit = true;
      const dmg = def.damage * hitPart.mult * falloff(def, bestT);
      applyDamage(victim, dmg, c, hitPart.part);
      fxSparks(hx, hy, hz, hitPart.part === 'head' ? 10 : 6, 2.4, performance.now() / 1000);
      if (c.isPlayer) {
        state.hitmarkAt = performance.now() / 1000;
        if (!victim.alive) state.killmarkAt = performance.now() / 1000;
        sfxHit(hitPart.part === 'head');
      }
    } else if (bestT < 120) {
      fxSparks(hx, hy, hz, 3, 1.6, performance.now() / 1000);
    }
  }
  // gunfire is information: bots hear it, the minimap blips it
  state.lastShots.push({ x: c.x, z: c.z, team: c.team, at: now });
  if (state.lastShots.length > 24) state.lastShots.shift();
  const distToPlayer = state.player ? Math.hypot(state.player.x - c.x, state.player.z - c.z) : 0;
  sfxShot(def.sound, c.isPlayer ? 1 : Math.max(0.08, 1 - distToPlayer / 42));
  return true;
}

export function startReload(c) {
  const gun = gunOf(c);
  if (!gun || gun.mag >= gun.def.mag || gun.reserve <= 0) return false;
  if (state.time < c.reloadUntil) return false;
  c.reloadUntil = state.time + gun.def.reload;
  if (c.isPlayer) sfxReload();
  return true;
}

export function tryMelee(c) {
  const now = state.time;
  if (!c.alive || c.slot !== 'melee' || now < c.swingAt) return false;
  c.swingAt = now + MELEE.rate;
  const fx = -Math.sin(c.yaw);
  const fz = -Math.cos(c.yaw);
  for (const other of state.combatants) {
    if (other === c || !other.alive || other.team === c.team) continue;
    const dx = other.x - c.x;
    const dz = other.z - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist > MELEE.range) continue;
    if ((dx * fx + dz * fz) / (dist || 1) < 0.4) continue; // must be facing them
    applyDamage(other, MELEE.damage, c, 'torso');
    if (c.isPlayer) state.hitmarkAt = performance.now() / 1000;
    return true;
  }
  return false;
}

// Per-step upkeep for one fighter's arsenal: finish reloads, cool the bloom,
// recover recoil. Called from the fixed-step loop for every combatant.
export function stepWeapons(c, dt) {
  if (c.reloadUntil && state.time >= c.reloadUntil) {
    const gun = gunOf(c);
    if (gun) {
      const need = gun.def.mag - gun.mag;
      const take = Math.min(need, gun.reserve);
      gun.mag += take;
      gun.reserve -= take;
    }
    c.reloadUntil = 0;
  }
  c.bloom = Math.max(0, c.bloom - dt * 5.5);
  c.recoilPitch = Math.max(0, c.recoilPitch - dt * 0.09);
}

export function switchSlot(c, slot) {
  if (c.slot === slot) return;
  if (slot === 'primary' && !c.primary) return;
  c.slot = slot;
  c.reloadUntil = 0;
  c.switchUntil = state.time + 0.32;
  c.bloom = 0;
}

// --- first-person viewmodel -----------------------------------------------------

const gunMats = {
  body: new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.45, metalness: 0.7 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.8, metalness: 0.2 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x14161a, emissive: 0xff7a26, emissiveIntensity: 1.4 }),
};

// A low-poly gun built from boxes, proportioned by the weapon def. Rebuilt on
// weapon change (rare), posed every frame by poseViewmodel.
export function buildViewmodel(def) {
  const g = new THREE.Group();
  const L = def.len;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, L * 0.55), gunMats.body);
  receiver.position.z = -L * 0.28;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(def.key === 'jackhammer' ? 0.026 : 0.016, def.key === 'jackhammer' ? 0.026 : 0.016, L * 0.5, 10), gunMats.body);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.025, -L * 0.78);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.09), gunMats.grip);
  mag.position.set(0, -0.12, -L * 0.3);
  mag.rotation.x = 0.16;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, L * 0.3), gunMats.grip);
  stock.position.set(0, -0.01, L * 0.12);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), gunMats.body);
  sight.position.set(0, 0.085, -L * 0.42);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.008), gunMats.accent);
  dot.position.set(0, 0.095, -L * 0.42);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.02, L * 0.3), gunMats.accent);
  stripe.position.set(0, 0.045, -L * 0.25);
  g.add(receiver, barrel, mag, stock, sight, dot, stripe);
  if (def.key === 'osprey') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 10), gunMats.grip);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, -L * 0.3);
    g.add(scope);
  }
  if (def.key === 'sparrow') g.scale.setScalar(0.8);
  g.userData.mag = mag;
  return g;
}

// Pose the viewmodel for this frame: hip position, ADS blend, recoil kick,
// reload dip, walk bob. `vm` is the group from buildViewmodel.
const HIP = { x: 0.24, y: -0.22, z: -0.45 };
const ADS = { x: 0, y: -0.148, z: -0.35 };
export function poseViewmodel(vm, c, adsBlend, now) {
  const reloading = c.reloadUntil > state.time;
  const reloadDip = reloading ? Math.sin(Math.min(1, (c.reloadUntil - state.time) / 1.2) * Math.PI) * 0.14 : 0;
  const bob = c.speed > 0.4 && c.grounded ? Math.sin(now * 9) * 0.008 : 0;
  const kick = Math.min(0.06, c.recoilPitch * 1.4);
  vm.position.set(
    HIP.x + (ADS.x - HIP.x) * adsBlend,
    HIP.y + (ADS.y - HIP.y) * adsBlend + bob - reloadDip,
    HIP.z + (ADS.z - HIP.z) * adsBlend + kick,
  );
  vm.rotation.x = kick * 2.2 + reloadDip * 1.4;
  if (vm.userData.mag) vm.userData.mag.position.y = -0.12 - reloadDip * 0.55;
}
