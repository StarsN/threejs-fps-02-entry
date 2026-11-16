// map.js — "The Foundry", SLAGLINE's one map, as data plus the world built from it.
//
// The layout is a three-lane tactical map: a Furnace Hall (site A) to the west, a
// Cooling Yard (site B) to the east, a conveyor spine down the middle, and links
// between them. Everything solid is an axis-aligned box {minX..maxZ, h}: the same
// list drives rendering, bullet raycasts, line-of-sight, movement collision, bot
// pathing cover and the minimap, so what you see is exactly what the sim believes.

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { concreteTexture, plateTexture, crateTexture, hazardTexture, siteLetterTexture } from './textures.js';

export const BOUNDS = { minX: -34, maxX: 34, minZ: -24, maxZ: 24 };
export const COLLIDERS = [];

function addCollider(minX, minZ, maxX, maxZ, h) {
  const c = { minX, minZ, maxX, maxZ, h };
  COLLIDERS.push(c);
  return c;
}

// Walls: [x1, z1, x2, z2, height, material] — axis-aligned runs, 0.6 thick.
const WALL_T = 0.6;
const WALLS = [
  // perimeter
  [-34.6, -24.6, 34.6, -24, 4.2, 'iron'], [-34.6, 24, 34.6, 24.6, 4.2, 'iron'],
  [-34.6, -24, -34, 24, 4.2, 'iron'], [34, -24, 34.6, 24, 4.2, 'iron'],
  // west divider (mid | A complex), doors at z -13..-10 and z 3..6
  [-14.3, -24, -13.7, -13, 3.4, 'iron'], [-14.3, -10, -13.7, 3, 3.4, 'iron'], [-14.3, 6, -13.7, 16, 3.4, 'iron'],
  // east divider (mid | B complex), doors at z -17..-14 and z 0..3
  [9.7, -24, 10.3, -17, 3.4, 'iron'], [9.7, -14, 10.3, 0, 3.4, 'iron'], [9.7, 3, 10.3, 14, 3.4, 'iron'],
  // Furnace Hall south wall, main door at x -21..-18
  [-34, -2.3, -21, -1.7, 3.4, 'iron'], [-18, -2.3, -14, -1.7, 3.4, 'iron'],
  // Cooling Yard south wall, main door at x 19..22
  [10, -4.3, 19, -3.7, 3.4, 'iron'], [22, -4.3, 34, -3.7, 3.4, 'iron'],
  // A approach angle wall
  [-27.3, -2, -26.7, 5, 2.6, 'iron'],
];
for (const [x1, z1, x2, z2, h] of WALLS) addCollider(Math.min(x1, x2), Math.min(z1, z2), Math.max(x1, x2), Math.max(z1, z2), h);

// Props: [cx, cz, w, d, h, kind] — crates, barriers, furnace blocks, tower footprints.
const PROPS = [
  // conveyor spine: a long low belt with two raised machine blocks
  [0, -3, 2.4, 30, 1.05, 'belt'], [0, -11.25, 2.8, 3.5, 2.6, 'machine'], [0, 4, 2.8, 4, 2.6, 'machine'],
  // Furnace Hall: the furnace itself and a coolant block
  [-25, -16.5, 6, 5, 3.0, 'furnace'], [-18.5, -10, 3, 4, 1.2, 'crate'],
  // Cooling Yard towers (cylinder meshes, box colliders) and crates
  [24, -15.5, 4, 4, 6, 'tower'], [30, -9.5, 3.4, 3.4, 5, 'tower'],
  [17, -19, 2.2, 2.2, 1.2, 'crate'], [15.5, -10, 2.2, 2.2, 2.4, 'crate2'],
  // mid cover
  [-9, -6, 2.2, 2.2, 1.2, 'crate'], [-9.8, -6, 2.2, 2.2, 1.2, 'crate'], [6, 8, 2.4, 2.4, 2.4, 'crate2'], [-6, -16, 2.2, 2.2, 1.2, 'crate'],
  // approaches
  [-24, 3, 2.4, 2.4, 2.4, 'crate2'], [-30, 8, 2.2, 2.2, 1.2, 'crate'],
  [28, 2, 4, 2, 2.4, 'crate2'], [15, -2, 2, 2, 1.2, 'crate'], [26, 10, 2.2, 2.2, 1.2, 'crate'],
  // south yard spawn barriers (low)
  [-21, 12, 6, 0.8, 1.1, 'barrier'], [-1, 12, 6, 0.8, 1.1, 'barrier'], [19, 12, 6, 0.8, 1.1, 'barrier'],
  // north mid pillars
  [-6, -21, 1.6, 1.6, 3.4, 'machine'], [6, -21, 1.6, 1.6, 3.4, 'machine'],
];
for (const [cx, cz, w, d, h] of PROPS) addCollider(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, h);

export const SITES = {
  A: { letter: 'A', minX: -32, maxX: -16, minZ: -22, maxZ: -6, cx: -25, cz: -14 },
  B: { letter: 'B', minX: 14, maxX: 32, minZ: -22, maxZ: -6, cx: 19.5, cz: -12.5 },
};
export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return key;
  }
  return '';
}

// yaw 0 faces north (-z): attackers spawn in the south and face the map,
// defenders spawn in the north and face south (yaw PI).
export const SPAWNS = {
  attack: [
    { x: -6, z: 20.5, yaw: 0 }, { x: -2, z: 21.2, yaw: 0 },
    { x: 3, z: 20.5, yaw: 0 }, { x: 8, z: 21.2, yaw: 0 },
  ],
  defend: [
    { x: -29, z: -21, yaw: Math.PI }, { x: -19, z: -21.5, yaw: Math.PI },
    { x: 1, z: -21.5, yaw: Math.PI }, { x: 26, z: -21, yaw: Math.PI },
  ],
};

// Waypoint graph for bot navigation. Nodes sit in open ground; every edge is a
// straight walk that clears the walls (checked against the layout above).
export const NODES = [
  { x: -6, z: 20 }, { x: 4, z: 20 }, { x: -6, z: 12 }, { x: 4, z: 12 }, // 0-3 south + mid-south
  { x: -24, z: 18 }, { x: 24, z: 18 }, // 4-5 yard corners
  { x: -24, z: 10 }, { x: -24, z: 3 }, { x: -19.5, z: 0.8 }, { x: -19.5, z: -4.5 }, // 6-9 A approach + door
  { x: -21, z: -10 }, { x: -25, z: -14 }, { x: -29, z: -19 }, { x: -17, z: -16 }, // 10-13 site A
  { x: -15.5, z: -11.5 }, { x: -12.5, z: -11.5 }, // 14-15 A hall east door
  { x: -16, z: 4.5 }, { x: -12, z: 4.5 }, // 16-17 A link door
  { x: -8, z: -2 }, { x: -8, z: -12 }, { x: 4, z: -8 }, { x: 4, z: 2 }, { x: -2, z: -19 }, // 18-22 mid
  { x: 8, z: 1.5 }, { x: 12, z: 1.5 }, { x: 7, z: -15.5 }, { x: 12, z: -15.5 }, // 23-26 B doors
  { x: 16, z: 6 }, { x: 24, z: 8 }, { x: 20.5, z: -2 }, { x: 20.5, z: -6 }, // 27-30 B approach + main door
  { x: 19, z: -13 }, { x: 16, z: -18 }, { x: 28, z: -19 }, // 31-33 site B
  { x: -30, z: -21 }, { x: 0, z: -21.5 }, { x: 24, z: -21.5 }, // 34-36 defender spawns
];
const EDGE_LIST = [
  [0, 1], [0, 2], [1, 3], [2, 3], [0, 4], [1, 5], [4, 6], [5, 28],
  [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [11, 13], [10, 13],
  [13, 14], [14, 15], [15, 19], [14, 11], [16, 17], [17, 18], [16, 7], [2, 17],
  [18, 19], [19, 22], [22, 35], [22, 20], [20, 21], [20, 25], [25, 26], [26, 32],
  [32, 31], [31, 33], [32, 33], [26, 31], [21, 23], [23, 24], [24, 27], [27, 28],
  [24, 29], [29, 30], [30, 31], [27, 29], [3, 21], [18, 8], [34, 12], [36, 33], [35, 20],
];
export const EDGES = NODES.map(() => []);
for (const [a, b] of EDGE_LIST) {
  EDGES[a].push(b);
  EDGES[b].push(a);
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const dx = NODES[i].x - x;
    const dz = NODES[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Breadth-first path over the waypoint graph; returns node indices including both ends.
export function findPath(fromIdx, toIdx) {
  if (fromIdx === toIdx) return [fromIdx];
  const prev = new Int16Array(NODES.length).fill(-1);
  const queue = [fromIdx];
  prev[fromIdx] = fromIdx;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === toIdx) break;
    for (const next of EDGES[cur]) {
      if (prev[next] === -1) {
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  if (prev[toIdx] === -1) return [fromIdx];
  const path = [];
  for (let cur = toIdx; ; cur = prev[cur]) {
    path.push(cur);
    if (cur === fromIdx) break;
  }
  return path.reverse();
}

// --- rays and collision -------------------------------------------------------

// Nearest distance at which the ray (o, d) meets any collider box, or Infinity.
// Boxes stand on the ground: y in [0, h]. Slab test per box, no allocation.
export function rayHitWalls(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (let i = 0; i < COLLIDERS.length; i++) {
    const c = COLLIDERS[i];
    let tmin = 0;
    let tmax = best;
    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (ox < c.minX || ox > c.maxX) continue;
    } else {
      let t1 = (c.minX - ox) / dx;
      let t2 = (c.maxX - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Y slab (box from ground to h)
    if (Math.abs(dy) < 1e-9) {
      if (oy < 0 || oy > c.h) continue;
    } else {
      let t1 = (0 - oy) / dy;
      let t2 = (c.h - oy) / dy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) {
      if (oz < c.minZ || oz > c.maxZ) continue;
    } else {
      let t1 = (c.minZ - oz) / dz;
      let t2 = (c.maxZ - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmin < best && tmin >= 0) best = tmin;
  }
  return best;
}

export function losClear(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return true;
  const hit = rayHitWalls(ax, ay, az, dx / dist, dy / dist, dz / dist, dist);
  return hit >= dist - 0.05;
}

// Push a circle (x, z, radius r) out of every collider footprint and the bounds.
// Mutates and returns the passed {x, z} object.
export function collideCircle(p, r) {
  for (let i = 0; i < COLLIDERS.length; i++) {
    const c = COLLIDERS[i];
    if (c.h < 0.5) continue; // knee-high scenery does not block walking
    const nx = Math.max(c.minX, Math.min(p.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
    const dx = p.x - nx;
    const dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      p.x = nx + (dx / d) * r;
      p.z = nz + (dz / d) * r;
    } else {
      // centre inside the box: push out along the smallest penetration axis
      const left = p.x - c.minX;
      const right = c.maxX - p.x;
      const top = p.z - c.minZ;
      const bottom = c.maxZ - p.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) p.x = c.minX - r;
      else if (m === right) p.x = c.maxX + r;
      else if (m === top) p.z = c.minZ - r;
      else p.z = c.maxZ + r;
    }
  }
  p.x = Math.max(BOUNDS.minX + r, Math.min(BOUNDS.maxX - r, p.x));
  p.z = Math.max(BOUNDS.minZ + r, Math.min(BOUNDS.maxZ - r, p.z));
  return p;
}

// --- world building -----------------------------------------------------------

export function buildWorld(scene) {
  const concrete = concreteTexture();
  const plate = plateTexture();
  const crateTex = crateTexture();
  const hazard = hazardTexture();

  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.94, metalness: 0.02 }),
    iron: new THREE.MeshStandardMaterial({ map: plate, roughness: 0.62, metalness: 0.45, color: 0xb9c0c9 }),
    ironDark: new THREE.MeshStandardMaterial({ color: PALETTE.ironDark, roughness: 0.7, metalness: 0.4 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85, metalness: 0.05 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.8 }),
    belt: new THREE.MeshStandardMaterial({ color: 0x2e3136, roughness: 0.5, metalness: 0.6 }),
    furnace: new THREE.MeshStandardMaterial({ color: 0x4c4238, roughness: 0.8, metalness: 0.3 }),
    furnaceGlow: new THREE.MeshStandardMaterial({ color: 0x1a0f08, emissive: PALETTE.ember, emissiveIntensity: 2.6 }),
    tower: new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.45, metalness: 0.65 }),
    towerGlow: new THREE.MeshStandardMaterial({ color: 0x0d2222, emissive: PALETTE.warden, emissiveIntensity: 1.6 }),
  };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 66), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const boxGeoCache = new Map();
  function box(w, h, d, mat) {
    const key = `${w}|${h}|${d}`;
    let geo = boxGeoCache.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(w, h, d);
      boxGeoCache.set(key, geo);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // walls from the same data that made the colliders
  for (const [x1, z1, x2, z2, h] of WALLS) {
    const w = Math.abs(x2 - x1) || WALL_T;
    const d = Math.abs(z2 - z1) || WALL_T;
    const mesh = box(w, h, d, mats.iron);
    mesh.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2);
    scene.add(mesh);
    // a hazard stripe along the foot of each interior wall
    if (h > 2) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w === WALL_T ? 0.66 : w, 0.28, d === WALL_T ? 0.66 : d), mats.hazard);
      stripe.position.set((x1 + x2) / 2, 0.14, (z1 + z2) / 2);
      scene.add(stripe);
    }
  }

  for (const [cx, cz, w, d, h, kind] of PROPS) {
    if (kind === 'tower') {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2 + 0.25, h, 18), mats.tower);
      cyl.position.set(cx, h / 2, cz);
      cyl.castShadow = true;
      cyl.receiveShadow = true;
      scene.add(cyl);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(w / 2 + 0.06, w / 2 + 0.06, 0.5, 18), mats.towerGlow);
      band.position.set(cx, h - 0.7, cz);
      scene.add(band);
      continue;
    }
    const mat = kind === 'crate' || kind === 'crate2' ? mats.crate
      : kind === 'furnace' ? mats.furnace
        : kind === 'belt' || kind === 'machine' ? mats.belt
          : mats.ironDark;
    const mesh = box(w, h, d, mat);
    mesh.position.set(cx, h / 2, cz);
    scene.add(mesh);
    if (kind === 'furnace') {
      // the furnace mouth: a glowing slit facing the site
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.1, 0.15), mats.furnaceGlow);
      mouth.position.set(cx, 1.15, cz + d / 2 + 0.03);
      scene.add(mouth);
      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 3.4, 12), mats.ironDark);
      chimney.position.set(cx - 1.6, h + 1.7, cz - 0.8);
      chimney.castShadow = true;
      scene.add(chimney);
    }
    if (kind === 'machine') {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), mats.towerGlow);
      lamp.position.set(cx, h + 0.06, cz);
      scene.add(lamp);
    }
  }

  // painted site letters on the ground
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const tex = siteLetterTexture(s.letter, key === 'A' ? '#ff7a26' : '#37d0c4');
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(s.cx, 0.02, s.cz);
    scene.add(decal);
  }

  // light: a low dusk sun, a cool sky fill, and warm/cool points on the two sites
  const sun = new THREE.DirectionalLight(0xffb37a, 3.0);
  sun.position.set(-38, 34, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -46;
  sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fa3bf, 0x3d3428, 1.05));

  const furnaceLight = new THREE.PointLight(PALETTE.ember, 60, 26, 1.8);
  furnaceLight.position.set(-25, 2.4, -12);
  scene.add(furnaceLight);
  const yardLight = new THREE.PointLight(PALETTE.warden, 44, 24, 1.8);
  yardLight.position.set(24, 4.5, -14);
  scene.add(yardLight);

  // skyline silhouettes beyond the walls, so the horizon is foundry, not void
  const skylineMat = new THREE.MeshBasicMaterial({ color: 0x232a35 });
  const rngPositions = [[-52, -30, 14, 22], [-30, -40, 18, 30], [8, -42, 22, 26], [44, -30, 12, 18], [52, 6, 14, 24], [-54, 10, 12, 16], [20, 40, 26, 20], [-24, 42, 18, 15]];
  for (const [x, z, w, h] of rngPositions) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), skylineMat);
    m.position.set(x, h / 2, z);
    scene.add(m);
  }
  return { sun };
}
