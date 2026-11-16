// player.js — the human's body and hands.
// Movement is the genre's contract: ground acceleration with friction so a
// strafe-stop is a real stop, a slower crouch that tightens spread, a quiet
// walk on Shift, and a jump that ruins your aim until you land. Look comes from
// pointer-lock deltas; firing, reloading, slots and grenades are polled here
// and handed to weapons.js / grenades.js, which own the consequences.

import { state } from './state.js';
import { input, consumePressed, consumeClick } from './input.js';
import { collideCircle } from './map.js';
import { gunOf, tryShoot, tryMelee, startReload, switchSlot } from './weapons.js';
import { throwGrenade } from './grenades.js';
import { sfxStep } from './audio.js';

const RUN_SPEED = 4.6;
const WALK_SPEED = 2.3;
const CROUCH_SPEED = 2.1;
const GRAVITY = 13.5;
const JUMP_VEL = 4.9;

export function stepPlayer(c, dt) {
  // look first: even frozen in the buy phase you may turn
  const adsScale = c.aiming ? 0.55 : 1;
  c.yaw -= input.lookDX * 0.0021 * adsScale;
  c.pitch -= input.lookDY * 0.0021 * adsScale;
  c.pitch = Math.max(-1.45, Math.min(1.45, c.pitch));
  input.lookDX = 0;
  input.lookDY = 0;
  c.aiming = input.aiming && c.alive && c.slot !== 'melee';

  if (!c.alive) return;
  const frozen = state.phase === 'buy' || state.phase === 'menu' || state.phase === 'matchend';

  // crouch blend
  const wantCrouch = input.keys.has('ControlLeft') || input.keys.has('ControlRight') || input.keys.has('KeyC');
  c.crouch = Math.max(0, Math.min(1, c.crouch + (wantCrouch ? dt * 7 : -dt * 7)));

  // wish direction in world space
  let wx = 0;
  let wz = 0;
  if (!frozen) {
    const f = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
    const r = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
    const sy = Math.sin(c.yaw);
    const cy = Math.cos(c.yaw);
    wx = (-sy * f + cy * r);
    wz = (-cy * f - sy * r);
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }
  }
  const gun = gunOf(c);
  const speedCap = (wantCrouch ? CROUCH_SPEED : input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? WALK_SPEED : RUN_SPEED)
    * (gun ? gun.def.speedFactor : 1) * (c.aiming ? 0.55 : 1);

  // accelerate: snappy on the ground, weak in the air (no air-strafing tricks)
  const accel = c.grounded ? 42 : 5;
  c.vx += wx * accel * dt;
  c.vz += wz * accel * dt;
  if (c.grounded && wx === 0 && wz === 0) {
    const fr = Math.max(0, 1 - dt * 11);
    c.vx *= fr;
    c.vz *= fr;
  }
  const spd = Math.hypot(c.vx, c.vz);
  if (spd > speedCap) {
    c.vx = (c.vx / spd) * speedCap;
    c.vz = (c.vz / spd) * speedCap;
  }
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  collideCircle(c, 0.35);
  c.speed = Math.hypot(c.vx, c.vz);

  // vertical: jump and gravity; the ground is everywhere y=0
  if (!frozen && c.grounded && input.keys.has('Space')) {
    c.vy = JUMP_VEL;
    c.grounded = false;
  }
  if (!c.grounded) {
    c.vy -= GRAVITY * dt;
    c.y += c.vy * dt;
    if (c.y <= 0) {
      c.y = 0;
      c.vy = 0;
      c.grounded = true;
    }
  }

  // footsteps: running is loud, walking and crouching are not
  if (c.grounded && c.speed > 1) {
    if (state.time >= c.stepAt) {
      const loud = c.speed > 3 && c.crouch < 0.5;
      c.stepAt = state.time + (loud ? 0.34 : 0.5);
      if (loud) {
        sfxStep(true);
        state.lastShots.push({ x: c.x, z: c.z, team: c.team, at: state.time, kind: 'step' });
      }
    }
  }

  if (frozen) return;

  // hands: fire, reload, slots, grenades
  const wantFire = gunOf(c) ? (gunOf(c).def.auto ? input.firing : consumeClick()) : input.firing;
  if (c.slot === 'melee') {
    if (consumeClick()) tryMelee(c);
  } else if (wantFire) {
    tryShoot(c, true);
  }
  if (consumePressed('KeyR')) startReload(c);
  if (consumePressed('Digit1')) switchSlot(c, 'primary');
  if (consumePressed('Digit2')) switchSlot(c, 'sidearm');
  if (consumePressed('Digit3')) switchSlot(c, 'melee');
  if (consumePressed('Digit4')) throwGrenade(c, 'frag');
  if (consumePressed('Digit5')) throwGrenade(c, 'flash');
  if (consumePressed('Digit6')) throwGrenade(c, 'smoke');
}
