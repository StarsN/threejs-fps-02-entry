// fighters.js — the combatant: one record for the human and every bot.
// Position, health, money, weapons and (for bots) a brain live here; the three.js
// body is built once per fighter and posed from the record each frame — walk bob,
// aim pitch, crouch squash and the fall when killed. Hit tests use the same
// proportions as the meshes (head sphere, torso and leg spheres in weapons.js).

import * as THREE from 'three';
import { TEAM_COLORS, TEAM_COLORS_DEEP } from './palette.js';

let nextId = 1;

export function makeCombatant(team, isPlayer, name) {
  return {
    id: nextId++,
    team,
    isPlayer,
    name,
    // kinematics (feet position; y is jump height above the ground)
    x: 0, z: 0, y: 0, vy: 0, yaw: 0, pitch: 0,
    vx: 0, vz: 0, speed: 0, grounded: true, crouch: 0, // crouch blends 0..1
    // vitals
    hp: 100, armor: 0, alive: true, diedAt: 0,
    // match ledger
    money: 800, kills: 0, deaths: 0,
    // arsenal: gun states are {def, mag, reserve}; see weapons.js
    primary: null, sidearm: null, melee: true,
    slot: 'sidearm', // 'primary' | 'sidearm' | 'melee'
    grenades: { frag: 0, flash: 0, smoke: 0 },
    nextShotAt: 0, reloadUntil: 0, switchUntil: 0, swingAt: 0,
    recoilPitch: 0, bloom: 0, blindUntil: 0, lastHurtAt: -9, lastHurtBy: null,
    stepAt: 0,
    brain: null, // bot AI state, bots.js fills this in; null for the human
    body: null, bodyParts: null,
    spectateYaw: 0,
  };
}

export function eyeHeight(c) {
  return c.y + 1.62 - c.crouch * 0.5;
}
export function currentGun(c) {
  if (c.slot === 'primary') return c.primary;
  if (c.slot === 'sidearm') return c.sidearm;
  return null; // melee has no gun state
}

// --- bodies -------------------------------------------------------------------

const sharedGeo = {
  torso: new THREE.BoxGeometry(0.52, 0.62, 0.28),
  head: new THREE.BoxGeometry(0.26, 0.28, 0.26),
  helmet: new THREE.BoxGeometry(0.3, 0.12, 0.3),
  legL: new THREE.BoxGeometry(0.17, 0.78, 0.2),
  armR: new THREE.BoxGeometry(0.13, 0.55, 0.15),
  gun: new THREE.BoxGeometry(0.07, 0.16, 0.78),
  pack: new THREE.BoxGeometry(0.4, 0.44, 0.16),
};

export function buildBody(c) {
  const teamMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[c.team], roughness: 0.7, metalness: 0.15 });
  const deepMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS_DEEP[c.team], roughness: 0.8, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.75 });

  const g = new THREE.Group();
  const torso = new THREE.Mesh(sharedGeo.torso, teamMat);
  torso.position.y = 1.06;
  torso.castShadow = true;
  const pack = new THREE.Mesh(sharedGeo.pack, deepMat);
  pack.position.set(0, 1.08, 0.21);
  const head = new THREE.Mesh(sharedGeo.head, skinMat);
  head.position.y = 1.52;
  head.castShadow = true;
  const helmet = new THREE.Mesh(sharedGeo.helmet, deepMat);
  helmet.position.y = 1.66;
  const legL = new THREE.Mesh(sharedGeo.legL, darkMat);
  legL.position.set(-0.14, 0.39, 0);
  const legR = new THREE.Mesh(sharedGeo.legL, darkMat);
  legR.position.set(0.14, 0.39, 0);
  const armR = new THREE.Mesh(sharedGeo.armR, teamMat);
  armR.position.set(0.33, 1.18, -0.1);
  armR.rotation.x = -1.25; // shoulder raised, holding the gun forward
  const gun = new THREE.Mesh(sharedGeo.gun, darkMat);
  gun.position.set(0.18, 1.32, -0.45);
  g.add(torso, pack, head, helmet, legL, legR, armR, gun);
  c.body = g;
  c.bodyParts = { torso, head, legL, legR, armR, gun };
  return g;
}

// Pose a body from its combatant record. `now` is render time; walk phase comes
// from distance travelled so feet roughly match the ground speed.
export function poseBody(c, now) {
  const g = c.body;
  if (!g) return;
  g.position.set(c.x, c.y, c.z);
  g.rotation.y = c.yaw;
  const parts = c.bodyParts;
  if (!c.alive) {
    // fall: tip backwards and settle; sink a little after a few seconds
    const t = Math.min(1, (now - c.diedAt) / 0.45);
    g.rotation.x = -t * Math.PI * 0.46;
    g.position.y = c.y - t * 0.12 - (now - c.diedAt > 4 ? Math.min(0.5, (now - c.diedAt - 4) * 0.1) : 0);
    return;
  }
  g.rotation.x = 0;
  const moving = c.speed > 0.4;
  const phase = now * (c.speed * 2.4);
  const swing = moving ? Math.sin(phase) * 0.5 : 0;
  parts.legL.rotation.x = swing;
  parts.legR.rotation.x = -swing;
  const bob = moving ? Math.abs(Math.sin(phase)) * 0.05 : Math.sin(now * 1.7 + c.id) * 0.012;
  const crouchDrop = c.crouch * 0.42;
  parts.torso.position.y = 1.06 + bob - crouchDrop;
  parts.head.position.y = 1.52 + bob - crouchDrop;
  parts.head.rotation.x = -c.pitch * 0.6;
  parts.gun.position.y = 1.32 + bob - crouchDrop;
  parts.gun.rotation.x = -c.pitch;
  g.scale.y = 1 - c.crouch * 0.12;
}
