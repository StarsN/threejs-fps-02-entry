// fx.js — transient visuals, all pooled.
// Tracers, impact sparks, muzzle flashes and explosions are recycled from fixed
// pools created at boot: the render loop allocates nothing per shot, which keeps
// frame times flat in a firefight. Effects are cosmetic only — the simulation
// never reads them back.

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { glowTexture } from './textures.js';

const TRACER_MAX = 40;
const SPARK_MAX = 320;

let scene = null;
let tracers = [];
let tracerIdx = 0;
let sparkGeo = null;
let sparkPos = null;
let sparkVel = null;
let sparkLife = null;
let sparkIdx = 0;
let flashLight = null;
let flashSprite = null;
let flashUntil = 0;
let boomSprite = null;
let boomUntil = 0;
let boomLight = null;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export function initFx(s) {
  scene = s;
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  for (let i = 0; i < TRACER_MAX; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, until: 0 });
  }
  sparkPos = new Float32Array(SPARK_MAX * 3);
  sparkVel = new Float32Array(SPARK_MAX * 3);
  sparkLife = new Float32Array(SPARK_MAX);
  sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: PALETTE.blood, size: 0.055, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  for (let i = 0; i < SPARK_MAX; i++) sparkPos[i * 3 + 1] = -10;

  flashLight = new THREE.PointLight(0xffc37a, 0, 11, 2);
  scene.add(flashLight);
  const glow = glowTexture('rgba(255,210,140,1)', 'rgba(255,120,30,0)');
  flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false }));
  flashSprite.scale.set(0.55, 0.55, 1);
  flashSprite.visible = false;
  scene.add(flashSprite);

  boomSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false }));
  boomSprite.visible = false;
  scene.add(boomSprite);
  boomLight = new THREE.PointLight(0xff8a3c, 0, 30, 1.6);
  scene.add(boomLight);
}

// A tracer: a short-lived stretched box from muzzle to impact point.
export function fxTracer(x1, y1, z1, x2, y2, z2, now) {
  const t = tracers[tracerIdx];
  tracerIdx = (tracerIdx + 1) % TRACER_MAX;
  _v1.set(x1, y1, z1);
  _v2.set(x2, y2, z2);
  const len = _v1.distanceTo(_v2);
  if (len < 0.5) return;
  t.mesh.position.copy(_v1).add(_v2).multiplyScalar(0.5);
  t.mesh.scale.set(1, 1, len);
  t.mesh.lookAt(_v2);
  t.mesh.visible = true;
  t.until = now + 0.055;
}

export function fxSparks(x, y, z, n, spread, now) {
  for (let k = 0; k < n; k++) {
    const i = sparkIdx;
    sparkIdx = (sparkIdx + 1) % SPARK_MAX;
    sparkPos[i * 3] = x;
    sparkPos[i * 3 + 1] = y;
    sparkPos[i * 3 + 2] = z;
    sparkVel[i * 3] = (Math.random() - 0.5) * spread;
    sparkVel[i * 3 + 1] = Math.random() * spread * 0.7;
    sparkVel[i * 3 + 2] = (Math.random() - 0.5) * spread;
    sparkLife[i] = 0.28 + Math.random() * 0.2;
  }
}

export function fxMuzzle(x, y, z, now) {
  flashSprite.position.set(x, y, z);
  flashSprite.visible = true;
  flashLight.position.set(x, y, z);
  flashLight.intensity = 26;
  flashUntil = now + 0.045;
}

export function fxExplosion(x, y, z, now) {
  boomSprite.position.set(x, y + 0.6, z);
  boomSprite.scale.set(7, 7, 1);
  boomSprite.visible = true;
  boomLight.position.set(x, y + 1, z);
  boomLight.intensity = 190;
  boomUntil = now + 0.28;
  fxSparks(x, y + 0.5, z, 42, 7, now);
}

// Advance every live effect by render dt; `now` is wall-clock seconds.
export function updateFx(dt, now) {
  for (const t of tracers) {
    if (t.mesh.visible && now > t.until) t.mesh.visible = false;
  }
  let anySpark = false;
  for (let i = 0; i < SPARK_MAX; i++) {
    if (sparkLife[i] <= 0) continue;
    anySpark = true;
    sparkLife[i] -= dt;
    sparkVel[i * 3 + 1] -= 9.8 * dt;
    sparkPos[i * 3] += sparkVel[i * 3] * dt;
    sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
    sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
    if (sparkLife[i] <= 0 || sparkPos[i * 3 + 1] < 0.02) {
      sparkLife[i] = 0;
      sparkPos[i * 3 + 1] = -10;
    }
  }
  if (anySpark) sparkGeo.attributes.position.needsUpdate = true;
  if (flashSprite.visible && now > flashUntil) {
    flashSprite.visible = false;
    flashLight.intensity = 0;
  }
  if (boomSprite.visible) {
    if (now > boomUntil) {
      boomSprite.visible = false;
      boomLight.intensity = 0;
    } else {
      const grow = 1 + dt * 14;
      boomSprite.scale.multiplyScalar(grow);
    }
  }
}
