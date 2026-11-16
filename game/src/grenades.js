// grenades.js — the three throwables: Ember frag, Lumen flash, Veil smoke.
// One projectile simulation (gravity, wall bounces off the map boxes) and three
// very different payoffs: radial damage checked against cover, a facing-based
// blind, and a smoke cloud that genuinely blocks the bots' line of sight —
// perception tests rays against active smoke spheres, so a Veil is a wall
// that lasts fourteen seconds.

import * as THREE from 'three';
import { state } from './state.js';
import { COLLIDERS, rayHitWalls } from './map.js';
import { eyeHeight } from './fighters.js';
import { applyDamage } from './weapons.js';
import { fxExplosion, fxSparks } from './fx.js';
import { glowTexture } from './textures.js';
import { sfxExplosion, sfxFlash, sfxThrow } from './audio.js';

export const GRENADE_INFO = {
  frag: { name: 'M-3 Ember Frag', fuse: 1.7 },
  flash: { name: 'Lumen Flash', fuse: 1.5 },
  smoke: { name: 'Veil Smoke', fuse: 1.1 },
};

let scene = null;
let smokeTexture = null;
const grenadeMeshGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMats = {
  frag: new THREE.MeshStandardMaterial({ color: 0xb34d12, roughness: 0.6 }),
  flash: new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.4 }),
  smoke: new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.6 }),
};

export function initGrenades(s) {
  scene = s;
  smokeTexture = glowTexture('rgba(200,204,208,0.85)', 'rgba(150,155,160,0)');
}

export function throwGrenade(c, kind) {
  if (!c.alive || c.grenades[kind] <= 0) return false;
  if (state.time < (c.grenadeAt || 0)) return false;
  c.grenades[kind]--;
  c.grenadeAt = state.time + 0.55;
  const cp = Math.cos(c.pitch + 0.18);
  const dir = {
    x: -Math.sin(c.yaw) * cp,
    y: Math.sin(c.pitch + 0.18),
    z: -Math.cos(c.yaw) * cp,
  };
  const mesh = new THREE.Mesh(grenadeMeshGeo, grenadeMats[kind]);
  scene.add(mesh);
  state.projectiles.push({
    kind,
    owner: c,
    x: c.x + dir.x * 0.4, y: eyeHeight(c) - 0.1, z: c.z + dir.z * 0.4,
    vx: dir.x * 16, vy: dir.y * 16 + 2.2, vz: dir.z * 16,
    fuseAt: state.time + GRENADE_INFO[kind].fuse,
    mesh,
  });
  if (c.isPlayer) sfxThrow();
  return true;
}

function explodeFrag(p) {
  fxExplosion(p.x, p.y, p.z, performance.now() / 1000);
  const distToPlayer = state.player ? Math.hypot(state.player.x - p.x, state.player.z - p.z) : 99;
  sfxExplosion(Math.max(0.1, 1 - distToPlayer / 46));
  if (distToPlayer < 9) state.shake = Math.max(state.shake, 0.5 * (1 - distToPlayer / 9));
  for (const v of state.combatants) {
    if (!v.alive) continue;
    if (v.team === p.owner.team && v !== p.owner) continue; // no team damage; self damage counts
    const dx = v.x - p.x;
    const dz = v.z - p.z;
    const dy = (v.y + 1.0) - p.y;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 5.5) continue;
    // cover eats the blast: a wall between the grenade and the chest negates it
    const wall = rayHitWalls(p.x, p.y, p.z, dx / (dist || 1), dy / (dist || 1), dz / (dist || 1), dist);
    if (wall < dist - 0.4) continue;
    const dmg = 95 * (1 - dist / 5.5) + 8;
    applyDamage(v, dmg, p.owner, 'torso');
  }
}

function explodeFlash(p) {
  fxSparks(p.x, p.y, p.z, 16, 3, performance.now() / 1000);
  sfxFlash();
  for (const v of state.combatants) {
    if (!v.alive) continue;
    const dx = p.x - v.x;
    const dz = p.z - v.z;
    const dy = p.y - eyeHeight(v);
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 26) continue;
    const wall = rayHitWalls(v.x, eyeHeight(v), v.z, dx / dist, dy / dist, dz / dist, dist);
    if (wall < dist - 0.3) continue;
    // how directly are they looking at the pop?
    const lookX = -Math.sin(v.yaw) * Math.cos(v.pitch);
    const lookY = Math.sin(v.pitch);
    const lookZ = -Math.cos(v.yaw) * Math.cos(v.pitch);
    const facing = (lookX * dx + lookY * dy + lookZ * dz) / dist;
    const base = facing > 0.35 ? 2.9 : facing > -0.2 ? 1.4 : 0.45;
    const dur = base * Math.max(0.25, 1 - dist / 30);
    v.blindUntil = Math.max(v.blindUntil, state.time + dur);
  }
}

function popSmoke(p) {
  const group = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: 0.62, depthWrite: false });
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(mat);
    const a = (i / 6) * Math.PI * 2;
    s.position.set(Math.cos(a) * 1.1, 0.9 + (i % 3) * 0.55, Math.sin(a) * 1.1);
    s.scale.set(3.4, 2.6, 1);
    group.add(s);
  }
  group.position.set(p.x, 0, p.z);
  scene.add(group);
  state.smokes.push({ x: p.x, y: 1.2, z: p.z, r: 3.1, until: state.time + 14, mesh: group });
}

// Does a sight line pass through any live smoke cloud? Bots and the flash
// check use the same geometry the sprites draw.
export function smokeBlocks(ax, ay, az, bx, by, bz) {
  for (const s of state.smokes) {
    // distance from the segment to the cloud centre, in 3D
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const len2 = abx * abx + aby * aby + abz * abz || 1;
    let t = ((s.x - ax) * abx + (s.y - ay) * aby + (s.z - az) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const dx = ax + abx * t - s.x;
    const dy = ay + aby * t - s.y;
    const dz = az + abz * t - s.z;
    if (dx * dx + dy * dy + dz * dz < s.r * s.r) return true;
  }
  return false;
}

export function stepGrenades(dt) {
  const now = state.time;
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    p.vy -= 9.2 * dt;
    let nx = p.x + p.vx * dt;
    let ny = p.y + p.vy * dt;
    let nz = p.z + p.vz * dt;
    // bounce off box sides (point vs expanded footprints, tall boxes only)
    for (const c of COLLIDERS) {
      if (c.h < 0.9) continue;
      if (nx > c.minX - 0.09 && nx < c.maxX + 0.09 && nz > c.minZ - 0.09 && nz < c.maxZ + 0.09 && ny < c.h) {
        const pushX = Math.min(nx - (c.minX - 0.09), (c.maxX + 0.09) - nx);
        const pushZ = Math.min(nz - (c.minZ - 0.09), (c.maxZ + 0.09) - nz);
        if (pushX < pushZ) { p.vx *= -0.42; nx = p.x + p.vx * dt; }
        else { p.vz *= -0.42; nz = p.z + p.vz * dt; }
      }
    }
    if (ny < 0.09) {
      ny = 0.09;
      p.vy = Math.abs(p.vy) > 1.2 ? -p.vy * 0.38 : 0;
      p.vx *= 0.72;
      p.vz *= 0.72;
      if (p.kind === 'smoke') {
        popSmoke(p);
        scene.remove(p.mesh);
        state.projectiles.splice(i, 1);
        continue;
      }
    }
    p.x = nx;
    p.y = ny;
    p.z = nz;
    p.mesh.position.set(p.x, p.y, p.z);
    if (now >= p.fuseAt) {
      if (p.kind === 'frag') explodeFrag(p);
      else if (p.kind === 'flash') explodeFlash(p);
      else popSmoke(p);
      scene.remove(p.mesh);
      state.projectiles.splice(i, 1);
    }
  }
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    if (now > state.smokes[i].until) {
      scene.remove(state.smokes[i].mesh);
      state.smokes.splice(i, 1);
    }
  }
}
