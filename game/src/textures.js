// textures.js — every surface in SLAGLINE is painted here, on canvases, at boot.
// No image files ship with the game: concrete, plate steel, crate timber, hazard
// striping and the painted site letters are all procedural, drawn once into
// THREE.CanvasTexture and reused. Deterministic (seeded) so renders are stable.

import * as THREE from 'three';
import { makeRng } from './state.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, repeat) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Speckle a base colour with seeded noise and a few darker stains.
function grain(ctx, w, h, rng, base, fleck, n, alpha) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = fleck;
    ctx.globalAlpha = alpha * (0.4 + rng() * 0.6);
    const s = 1 + rng() * 3;
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

export function concreteTexture() {
  const [c, ctx] = canvas(256, 256);
  const rng = makeRng(41);
  grain(ctx, 256, 256, rng, '#55524c', '#3f3d38', 2600, 0.25);
  grain(ctx, 256, 256, rng, '#55524c', '#6a675f', 1200, 0.18);
  ctx.strokeStyle = 'rgba(30,29,27,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254); // expansion joint around each slab
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.stroke();
  return finish(c, 6);
}

export function plateTexture() {
  const [c, ctx] = canvas(256, 256);
  const rng = makeRng(97);
  grain(ctx, 256, 256, rng, '#5b626b', '#454b53', 1500, 0.22);
  ctx.strokeStyle = 'rgba(24,26,30,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 252, 252);
  ctx.fillStyle = 'rgba(20,22,26,0.85)';
  for (const [x, y] of [[14, 14], [242, 14], [14, 242], [242, 242]]) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, 0, 256, 26); // a worn sheen along the top edge
  return finish(c, 2);
}

export function crateTexture() {
  const [c, ctx] = canvas(256, 256);
  const rng = makeRng(7);
  grain(ctx, 256, 256, rng, '#77684f', '#5b4f3a', 1400, 0.25);
  ctx.strokeStyle = '#4a3f2b';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 246);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(256, 256);
  ctx.moveTo(256, 0);
  ctx.lineTo(0, 256);
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.fillStyle = 'rgba(30,25,16,0.5)';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SLAGLINE', 128, 118);
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('FOUNDRY SUPPLY', 128, 150);
  return finish(c, 1);
}

export function hazardTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#c9932c';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#23252a';
  for (let i = -2; i < 6; i++) {
    ctx.save();
    ctx.translate(i * 32, 0);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-8, -40, 16, 220);
    ctx.restore();
  }
  return finish(c, 3);
}

// A big painted letter for a bomb site, worn into the concrete.
export function siteLetterTexture(letter, color) {
  const [c, ctx] = canvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.globalAlpha = 0.85;
  ctx.strokeRect(18, 18, 220, 220);
  ctx.fillStyle = color;
  ctx.font = 'bold 170px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Radial gradient sprite for smoke puffs, muzzle glow and the explosion flash.
export function glowTexture(inner, outer) {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
