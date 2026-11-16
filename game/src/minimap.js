// minimap.js — the tactical read: walls, sites, teammates, the charge.
// Drawn on a 2D canvas from the same collider list the simulation uses, so the
// map on the HUD is the map in the world. Enemies appear only as gunshot blips
// (a shot heard is information; a silent enemy is not given away), teammates
// always show, and the player's arrow carries their facing.

import { state, attackingTeam } from './state.js';
import { COLLIDERS, SITES, BOUNDS } from './map.js';
import { TEAM_COLORS } from './palette.js';

const W = 204;
const H = 144;
function sx(x) { return ((x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX)) * W; }
function sz(z) { return ((z - BOUNDS.minZ) / (BOUNDS.maxZ - BOUNDS.minZ)) * H; }

function hex(n) { return `#${n.toString(16).padStart(6, '0')}`; }

export function drawMinimap(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#191c20';
  ctx.fillRect(0, 0, W, H);

  // sites first, under the walls
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    ctx.fillStyle = key === 'A' ? 'rgba(255,122,38,0.16)' : 'rgba(55,208,196,0.14)';
    ctx.fillRect(sx(s.minX), sz(s.minZ), sx(s.maxX) - sx(s.minX), sz(s.maxZ) - sz(s.minZ));
    ctx.fillStyle = key === 'A' ? '#ff7a26' : '#37d0c4';
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.fillText(key, sx(s.cx) - 3, sz(s.cz) + 4);
  }
  // walls and tall props
  ctx.fillStyle = '#4c545e';
  for (const c of COLLIDERS) {
    if (c.h < 1.0) continue;
    ctx.fillRect(sx(c.minX), sz(c.minZ), Math.max(1.5, sx(c.maxX) - sx(c.minX)), Math.max(1.5, sz(c.maxZ) - sz(c.minZ)));
  }

  const p = state.player;
  if (!p) return;
  const now = state.time;

  // enemy gunfire blips, fading over two seconds
  for (const s of state.lastShots) {
    if (s.team === p.team) continue;
    const age = now - s.at;
    if (age > 2) continue;
    ctx.fillStyle = `rgba(255,90,60,${0.9 * (1 - age / 2)})`;
    ctx.beginPath();
    ctx.arc(sx(s.x), sz(s.z), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // the charge
  const bomb = state.bomb;
  ctx.fillStyle = '#ffb03a';
  if (bomb.plantedAt) {
    const x = sx(bomb.plantedAt.x);
    const y = sz(bomb.plantedAt.z);
    ctx.fillRect(x - 3, y - 3, 6, 6);
  } else if (bomb.droppedAt) {
    if (Math.floor(now * 2.4) % 2 === 0) ctx.fillRect(sx(bomb.droppedAt.x) - 2.5, sz(bomb.droppedAt.z) - 2.5, 5, 5);
  } else if (bomb.carrier && bomb.carrier.team !== p.team) {
    // an enemy carrier is not given away; a teammate's charge is
  } else if (bomb.carrier) {
    ctx.fillRect(sx(bomb.carrier.x) - 2.5, sz(bomb.carrier.z) - 2.5, 5, 5);
  }

  // teammates (and the spectated view when dead)
  for (const c of state.combatants) {
    if (!c.alive || c.isPlayer) continue;
    if (c.team !== p.team) continue;
    ctx.fillStyle = hex(TEAM_COLORS[c.team]);
    ctx.beginPath();
    ctx.arc(sx(c.x), sz(c.z), 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // the player's arrow (or the spectated teammate's)
  const view = p.alive ? p : state.spectating;
  if (view) {
    const x = sx(view.x);
    const y = sz(view.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-view.yaw); // world forward (-sin yaw, -cos yaw) -> canvas up, rotated
    ctx.fillStyle = '#e8e3d8';
    ctx.beginPath();
    ctx.moveTo(0, -5.5);
    ctx.lineTo(3.6, 4.2);
    ctx.lineTo(-3.6, 4.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // attacking cue: a small arrow tag in the corner
  ctx.fillStyle = 'rgba(232,227,216,0.5)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText(attackingTeam() === p.team ? 'ATTACK' : 'DEFEND', 6, H - 5);
}
