// main.js — boot and the loop.
// Owns the renderer, the scene and the camera; runs the simulation at a fixed
// 60 Hz step (player, bots, weapons, grenades, rounds) decoupled from the
// render rate, then poses bodies, the viewmodel and the camera from the
// resulting state. Also owns the three non-game entries: the menu backdrop,
// ?demo=1 (a bot drives the player, for soak tests) and ?shot=<scene> (the
// deterministic screenshot scenes listed in shots.json).

import * as THREE from 'three';
import { state, makeRng, attackingTeam } from './state.js';
import { PALETTE } from './palette.js';
import { buildWorld, SITES } from './map.js';
import { initFx, updateFx } from './fx.js';
import { initGrenades, stepGrenades } from './grenades.js';
import { initInput, input, requestLock, clearEdges } from './input.js';
import { initAudio } from './audio.js';
import { buildBody, poseBody, eyeHeight } from './fighters.js';
import { stepPlayer } from './player.js';
import { makeBrain, stepBot } from './bots.js';
import { stepWeapons, buildViewmodel, poseViewmodel, gunOf, makeGun } from './weapons.js';
import { createMatch, startRound, stepRounds } from './rounds.js';
import { initHud, updateHud, setBuyOpen, isBuyOpen, setScoreboard } from './hud.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const DEMO = params.has('demo');
const SEED = Number(params.get('seed') || (DEMO || SHOT ? 7 : (Date.now() % 100000)));

const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 42, 115);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 260);
camera.rotation.order = 'YXZ';
scene.add(camera);

buildWorld(scene);
initFx(scene);
initGrenades(scene);
initInput(renderer.domElement);
initHud();

state.rng = makeRng(SEED);

// --- fighters and their bodies ---------------------------------------------------

let viewmodel = null;
let viewmodelKey = '';
function setupFighters() {
  for (const c of state.combatants) if (c.body) scene.remove(c.body);
  createMatch();
  if (DEMO) state.player.brain = makeBrain(state.player);
  for (const c of state.combatants) scene.add(buildBody(c));
  viewmodelKey = '';
}
setupFighters();
startRound();
if (!SHOT && !DEMO) state.phase = 'menu'; // the menu idles over a staged round

// the bomb prop: a charge box with a blinking light, shown dropped or planted
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.16, 0.24),
  new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.6 }),
);
const bombLightMat = new THREE.MeshStandardMaterial({ color: 0x110b06, emissive: 0xff2a1a, emissiveIntensity: 0 });
bombMesh.add(bombBox, new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), bombLightMat));
bombMesh.children[1].position.y = 0.1;
bombMesh.visible = false;
scene.add(bombMesh);

// --- match flow --------------------------------------------------------------------

let matchStarted = false;
const startOverlay = document.getElementById('start-overlay');
const playBtn = document.getElementById('play-btn');

function startNewMatch() {
  initAudio();
  setupFighters();
  startRound();
  matchStarted = true;
  startOverlay.hidden = true;
  playBtn.textContent = 'Resume';
  requestLock(renderer.domElement);
}
playBtn.addEventListener('click', () => {
  if (matchStarted && state.phase !== 'matchend') {
    initAudio();
    startOverlay.hidden = true;
    requestLock(renderer.domElement);
  } else startNewMatch();
});
renderer.domElement.addEventListener('click', () => {
  if (!matchStarted) return;
  if (!state.player.alive && state.spectating) {
    // cycle the spectate target
    const mates = state.combatants.filter((c) => c.team === state.player.team && c.alive && !c.isPlayer);
    if (mates.length) {
      const i = mates.indexOf(state.spectating);
      state.spectating = mates[(i + 1) % mates.length];
    }
    return;
  }
  if (!input.locked && !isBuyOpen()) requestLock(renderer.domElement);
});
document.addEventListener('pointerlockchange', () => {
  if (!input.locked && matchStarted && !isBuyOpen() && state.phase !== 'menu' && !SHOT) {
    startOverlay.hidden = false; // paused: click Resume to re-engage
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && state.phase === 'matchend') startNewMatch();
  if (e.code === 'KeyB' && state.phase === 'buy') {
    const open = !isBuyOpen();
    setBuyOpen(open);
    if (!open) requestLock(renderer.domElement);
  }
  if (e.code === 'Tab') setScoreboard(true);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') setScoreboard(false);
});

// --- simulation step -----------------------------------------------------------------

const STEP = 1 / 60;
function step() {
  state.time += STEP;
  const p = state.player;
  if (DEMO && p.brain) stepBot(p, STEP);
  else stepPlayer(p, STEP);
  for (const c of state.combatants) if (!c.isPlayer && c.brain) stepBot(c, STEP);
  for (const c of state.combatants) stepWeapons(c, STEP);
  stepGrenades(STEP);
  stepRounds(STEP);
  clearEdges();
}

// --- camera and viewmodel --------------------------------------------------------------

let adsBlend = 0;
function updateCamera(now) {
  const p = state.player;
  let view = p;
  if (state.phase === 'menu' && !SHOT) {
    // a slow orbit over the foundry behind the menu
    const t = now * 0.05;
    camera.position.set(Math.cos(t) * 30, 13 + Math.sin(now * 0.13) * 2, Math.sin(t) * 30);
    camera.lookAt(0, 0, -4);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    if (viewmodel) viewmodel.visible = false;
    return;
  }
  if (!p.alive) {
    const mates = state.combatants.filter((c) => c.team === p.team && c.alive && !c.isPlayer);
    if (!state.spectating || !state.spectating.alive) state.spectating = mates[0] || null;
    if (state.spectating) view = state.spectating;
  } else state.spectating = null;

  camera.position.set(view.x, eyeHeight(view) + (view === p ? 0 : 0.1), view.z);
  const shakeAmp = state.shake;
  const shX = shakeAmp ? (Math.random() - 0.5) * shakeAmp * 0.05 : 0;
  const shY = shakeAmp ? (Math.random() - 0.5) * shakeAmp * 0.05 : 0;
  camera.rotation.set(view.pitch + view.recoilPitch * 0.55 + shX, view.yaw, shY);
  state.shake = Math.max(0, state.shake - 0.03);

  // viewmodel: swap on weapon change, pose every frame
  const gun = gunOf(p);
  const wantKey = p.slot === 'melee' ? 'melee' : (gun ? gun.key : '');
  if (wantKey !== viewmodelKey) {
    if (viewmodel) camera.remove(viewmodel);
    viewmodelKey = wantKey;
    viewmodel = wantKey ? buildViewmodel(wantKey === 'melee' ? { key: 'melee', len: 0.42 } : gun.def) : null;
    if (viewmodel) camera.add(viewmodel);
  }
  const adsTarget = p.aiming && gun ? 1 : 0;
  adsBlend += (adsTarget - adsBlend) * 0.22;
  if (viewmodel) {
    viewmodel.visible = view === p && p.alive;
    if (viewmodel.visible) {
      if (p.slot === 'melee') {
        const sinceSwing = state.time - (p.swingAt - 0.48);
        const swing = p.swingAt && sinceSwing < 0.48 ? Math.sin((sinceSwing / 0.48) * Math.PI) : 0;
        viewmodel.position.set(0.24, -0.24 - swing * 0.05, -0.4);
        viewmodel.rotation.x = -swing * 1.1;
      } else poseViewmodel(viewmodel, p, adsBlend, now);
    }
  }
  const targetFov = gun && adsBlend > 0.02 ? 75 / (1 + (gun.def.zoom - 1) * adsBlend) : 75;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.3;
    camera.updateProjectionMatrix();
  }
}

// --- screenshot scenes ---------------------------------------------------------------------

function place(c, x, z, yaw) {
  c.x = x;
  c.z = z;
  c.yaw = yaw;
  c.vx = 0;
  c.vz = 0;
}
function setupShot(name) {
  const p = state.player;
  const mates = state.combatants.filter((c) => c.team === 0 && !c.isPlayer);
  const foes = state.combatants.filter((c) => c.team === 1);
  startOverlay.hidden = true;
  document.getElementById('hud').style.display = '';
  state.banner = null; // scenes compose their own announcements (or none)
  if (name === 'buy') {
    state.phase = 'buy';
    state.phaseTime = 11;
    p.money = 4150;
    p.primary = makeGun('longshot');
    p.slot = 'primary';
    setBuyOpen(true);
    place(p, -2, 20.5, 0);
    state.frozen = true;
    return;
  }
  state.phase = 'live';
  state.phaseTime = 84;
  p.primary = makeGun('longshot');
  p.slot = 'primary';
  p.money = 2650;
  if (name === 'cover') {
    place(p, -3.5, 6.5, 0.1);
    p.aiming = true;
    place(mates[0], -7.6, 1.2, -0.2);
    mates[0].crouch = 1;
    place(foes[0], 1.8, -7.5, Math.PI - 0.3);
    foes[0].brain.mode = 'hold';
    place(foes[1], -9, -14, Math.PI + 0.4);
  } else if (name === 'plant') {
    state.phase = 'planted';
    state.phaseTime = 31;
    state.bomb.plantedAt = { x: -24.5, z: -9 };
    state.bomb.plantSite = 'A';
    place(p, -19.5, -6.4, 1.09); // covering the charge, furnace at his back-left
    place(mates[0], -24, -15.5, -1.43); // holding the furnace corner, watching east
    place(mates[1], -20.5, -4.9, Math.PI); // watching the main door
    place(foes[0], -29.5, -20, 2.6); // deep in the hall, out of the frame's focus
  } else if (name === 'end') {
    state.phase = 'end';
    state.phaseTime = 5;
    state.scores = [4, 2];
    state.winner = 0;
    state.banner = { title: 'EMBER TAKE THE ROUND', sub: 'by elimination — score 4 : 2', until: state.time + 999 };
    p.kills = 6;
    p.deaths = 2;
    mates[0].kills = 4;
    place(p, 0.5, -3, 0.05);
    place(mates[0], -3.4, -5.5, 0.4);
    for (let i = 0; i < 2; i++) {
      foes[i].alive = false;
      foes[i].hp = 0;
      foes[i].diedAt = state.time - 1.2;
      place(foes[i], 2.5 + i * 2.2, -9 - i * 1.5, 2.4);
    }
  }
  // settle the poses through the real step so bodies and HUD agree
  for (let i = 0; i < 24; i++) {
    for (const c of state.combatants) poseBody(c, i / 60);
  }
  state.frozen = true;
}

// --- the loop ---------------------------------------------------------------------------------

let last = performance.now();
let acc = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs / 1000;
  let dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  if (matchStarted || DEMO || SHOT) {
    if (!state.frozen) {
      acc += dt;
      while (acc >= STEP) {
        step();
        acc -= STEP;
      }
    }
  }
  for (const c of state.combatants) poseBody(c, now);
  // bomb prop follows the bomb state
  const bomb = state.bomb;
  const bombPos = bomb.plantedAt || bomb.droppedAt;
  bombMesh.visible = !!bombPos;
  if (bombPos) {
    bombMesh.position.set(bombPos.x, 0.09, bombPos.z);
    const rate = state.phase === 'planted' ? (state.phaseTime < 5 ? 9 : state.phaseTime < 15 ? 4.5 : 2) : 2;
    bombLightMat.emissiveIntensity = (now * rate) % 1 < 0.5 ? 3.2 : 0.1;
  }
  updateCamera(now);
  updateFx(dt, now);
  updateHud(now);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (SHOT) {
  setupShot(SHOT);
  // render a few frames so shaders compile and textures upload, then signal
  let frames = 0;
  const warm = () => {
    frames++;
    renderer.render(scene, camera);
    if (frames < 4) requestAnimationFrame(warm);
    else window.__shotReady = true;
  };
  requestAnimationFrame(warm);
}
if (DEMO) {
  matchStarted = true;
  startOverlay.hidden = true;
}
window.__game = state;
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
requestAnimationFrame(frame);
