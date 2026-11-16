// hud.js — everything drawn in DOM over the canvas.
// The simulation writes state; this module reads it once per rendered frame and
// paints health, money, ammunition, the round clock, the kill feed, banners,
// channel progress and the buy menu. It owns no game rules: buying goes through
// rounds.buyForPlayer, which validates money and phase itself.

import { state, attackingTeam, TEAM_NAMES } from './state.js';
import { SITES } from './map.js';
import { WEAPONS, ARMOR_PRICE, GRENADE_PRICES, gunOf } from './weapons.js';
import { buyForPlayer } from './rounds.js';
import { drawMinimap } from './minimap.js';
import { sfxBuy, sfxDeny } from './audio.js';

const el = {};
let buyOpen = false;
let sbOpen = false;
let lastPhase = '';
let feedRendered = -1;

const BUY_ITEMS = [
  { item: 'wasp', label: 'VK-7 Wasp', desc: 'SMG — fast, light damage', price: () => WEAPONS.wasp.price },
  { item: 'jackhammer', label: 'BR-4 Jackhammer', desc: 'Shotgun — 8 pellets, close range', price: () => WEAPONS.jackhammer.price },
  { item: 'longshot', label: 'AR-9 Longshot', desc: 'Rifle — the all-rounder', price: () => WEAPONS.longshot.price },
  { item: 'osprey', label: 'DMR-12 Osprey', desc: 'Marksman — huge damage, scoped', price: () => WEAPONS.osprey.price },
  { item: 'armor', label: 'Kevlar Vest', desc: 'Armour — soaks 45% of damage', price: () => ARMOR_PRICE },
  { item: 'frag', label: 'M-3 Ember Frag', desc: 'Grenade — blast damage [4]', price: () => GRENADE_PRICES.frag },
  { item: 'flash', label: 'Lumen Flash', desc: 'Grenade — blinds [5]', price: () => GRENADE_PRICES.flash },
  { item: 'smoke', label: 'Veil Smoke', desc: 'Grenade — blocks sight [6]', price: () => GRENADE_PRICES.smoke },
];

export function initHud() {
  for (const id of ['timer', 'round-label', 'score-0', 'score-1', 'feed', 'hp-num', 'hp-fill', 'armor-fill',
    'money', 'weapon-name', 'ammo-mag', 'ammo-reserve', 'slots', 'grenades', 'banner', 'banner-title',
    'banner-sub', 'channel', 'channel-label', 'channel-fill', 'spectate', 'damage-vignette', 'blind-overlay',
    'hurt-dir', 'hitmarker', 'crosshair', 'bomb-status', 'buy-overlay', 'buy-grid', 'buy-money', 'buy-timer',
    'scoreboard', 'sb-body', 'minimap', 'team-left', 'team-right']) {
    el[id] = document.getElementById(id);
  }
  el['buy-grid'].innerHTML = '';
  for (const entry of BUY_ITEMS) {
    const btn = document.createElement('button');
    btn.className = 'buy-item';
    btn.type = 'button';
    btn.innerHTML = `<span><span class="nm">${entry.label}</span><span class="ds">${entry.desc}</span></span><span class="pr">$${entry.price()}</span>`;
    btn.addEventListener('click', () => {
      if (buyForPlayer(entry.item)) {
        sfxBuy();
        refreshBuy();
      } else sfxDeny();
    });
    btn.dataset.item = entry.item;
    el['buy-grid'].appendChild(btn);
  }
}

export function setBuyOpen(open) {
  buyOpen = open;
  el['buy-overlay'].hidden = !open;
  if (open) refreshBuy();
}
export function isBuyOpen() { return buyOpen; }
export function setScoreboard(open) {
  sbOpen = open;
  el.scoreboard.hidden = !open;
  if (open) refreshScoreboard();
}

function ownedLabel(p, item) {
  if (item === 'armor') return p.armor > 0 ? `ARMOUR ${Math.round(p.armor)}` : '';
  if (item === 'frag' || item === 'flash' || item === 'smoke') return p.grenades[item] > 0 ? `× ${p.grenades[item]}` : '';
  return p.primary && p.primary.key === item ? 'EQUIPPED' : '';
}

function refreshBuy() {
  const p = state.player;
  if (!p) return;
  el['buy-money'].textContent = `$${p.money}`;
  for (const btn of el['buy-grid'].children) {
    const item = btn.dataset.item;
    const entry = BUY_ITEMS.find((b) => b.item === item);
    const owned = ownedLabel(p, item);
    const price = entry.price();
    btn.disabled = p.money < price || owned === 'EQUIPPED' || (item === 'armor' && p.armor >= 100) || ((item === 'frag' || item === 'flash' || item === 'smoke') && p.grenades[item] >= 2);
    const tag = btn.querySelector('.pr');
    tag.textContent = owned || `$${price}`;
    tag.classList.toggle('owned', !!owned); // keep the .pr class: refresh looks it up
  }
}

function refreshScoreboard() {
  const rows = [...state.combatants].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  el['sb-body'].innerHTML = rows.map((c) => `
    <tr>
      <td>${c.name}${c.isPlayer ? ' (you)' : ''}</td>
      <td class="${c.team === 0 ? 'team-ember' : 'team-warden'}">${TEAM_NAMES[c.team]}</td>
      <td>${c.kills}</td><td>${c.deaths}</td><td>$${c.money}</td>
      <td>${c.alive ? 'alive' : 'down'}</td>
    </tr>`).join('');
}

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Called every rendered frame with render-time `now` (seconds, wall clock).
export function updateHud(now) {
  const p = state.player;
  if (!p) return;
  const phase = state.phase;

  // phase changes drive the buy menu's automatic open/close
  if (phase !== lastPhase) {
    if (phase === 'buy' && p.alive) setBuyOpen(true);
    if (phase !== 'buy' && buyOpen) setBuyOpen(false);
    if (phase === 'matchend') setScoreboard(true);
    lastPhase = phase;
  }
  if (buyOpen) {
    el['buy-timer'].textContent = String(Math.max(0, Math.ceil(state.phaseTime)));
    if ((updateHud._buyTick || 0) < now - 0.25) {
      updateHud._buyTick = now;
      refreshBuy();
    }
  }

  // top bar: scores, clock, labels (left team is always the attacking side's colour cue)
  el['score-0'].textContent = state.scores[0];
  el['score-1'].textContent = state.scores[1];
  const atk = attackingTeam();
  el['team-left'].querySelector('.nm').textContent = `${TEAM_NAMES[0]}${atk === 0 ? ' · ATK' : ''}`;
  el['team-right'].querySelector('.nm').textContent = `${TEAM_NAMES[1]}${atk === 1 ? ' · ATK' : ''}`;
  el.timer.textContent = state.phase === 'planted' ? fmtTime(state.phaseTime) : fmtTime(state.phaseTime);
  el.timer.classList.toggle('low', (phase === 'live' || phase === 'planted') && state.phaseTime < 11);
  el['round-label'].textContent = `ROUND ${state.round} · ${phase.toUpperCase()}${state.round > 6 ? ' · 2ND HALF' : ''}`;

  // vitals: when dead, the spectated teammate's numbers are more useful
  const shown = p.alive ? p : (state.spectating || p);
  el['hp-num'].textContent = Math.ceil(shown.hp);
  el['hp-num'].classList.toggle('low', shown.hp <= 30);
  el['hp-fill'].style.width = `${Math.max(0, shown.hp)}%`;
  el['armor-fill'].style.width = `${Math.max(0, shown.armor)}%`;
  el.money.textContent = `$${p.money}`;

  // weapon box
  const gun = gunOf(p);
  el['weapon-name'].textContent = p.slot === 'melee' ? 'Trench Tool' : (gun ? gun.def.name : '—');
  if (gun) {
    el['ammo-mag'].textContent = gun.mag;
    el['ammo-mag'].classList.toggle('empty', gun.mag === 0);
    el['ammo-reserve'].textContent = `/ ${gun.reserve}`;
  } else {
    el['ammo-mag'].textContent = '—';
    el['ammo-reserve'].textContent = '';
  }
  el.slots.innerHTML = [
    p.primary ? `<span class="${p.slot === 'primary' ? '' : ''}">1 <b>${p.primary.def.name.split(' ')[1] || 'Rifle'}</b></span>` : '',
    `<span>2 <b>Sparrow</b></span>`,
    `<span>3 <b>Tool</b></span>`,
  ].join('');
  el.grenades.textContent = `FRAG ×${p.grenades.frag} · FLASH ×${p.grenades.flash} · SMOKE ×${p.grenades.smoke}`;

  // bomb status line under the minimap
  const bomb = state.bomb;
  if (bomb.plantedAt) el['bomb-status'].innerHTML = `<b>CHARGE PLANTED — SITE ${bomb.plantSite}</b>`;
  else if (bomb.carrier === p) el['bomb-status'].innerHTML = `<b>YOU HAVE THE CHARGE</b> — hold E at A or B`;
  else if (bomb.carrier) el['bomb-status'].textContent = `${bomb.carrier.name} has the charge`;
  else if (bomb.droppedAt) el['bomb-status'].innerHTML = `<b>CHARGE DROPPED</b>`;
  else el['bomb-status'].textContent = '';

  // kill feed: re-render only when it changes; lines fade after 5 s
  const feedKey = state.feed.length ? state.feed[state.feed.length - 1].at : -1;
  if (feedKey !== feedRendered) {
    feedRendered = feedKey;
    el.feed.innerHTML = state.feed.map((f) => `<div>${f.text}</div>`).join('');
  }

  // banner
  if (state.banner && state.time < state.banner.until) {
    el.banner.hidden = false;
    el['banner-title'].textContent = state.banner.title;
    el['banner-sub'].textContent = state.banner.sub;
  } else el.banner.hidden = true;

  // plant/defuse channel progress
  const ch = state.bomb.channel;
  if (ch && (ch.who === p || ch.kind === 'defuse')) {
    el.channel.hidden = false;
    el['channel-label'].textContent = ch.kind === 'plant' ? `PLANTING AT ${ch.site || ''}` : 'DEFUSING';
    el['channel-fill'].style.width = `${Math.min(100, (ch.progress / ch.need) * 100)}%`;
  } else el.channel.hidden = true;

  // hitmarker, damage and blind feedback (wall-clock based, purely cosmetic)
  const sinceHit = now - state.hitmarkAt;
  el.hitmarker.style.opacity = sinceHit < 0.11 ? 1 : 0;
  el.hitmarker.classList.toggle('kill', now - state.killmarkAt < 0.25);
  const sinceHurt = state.time - p.lastHurtAt;
  el['damage-vignette'].style.opacity = p.alive ? Math.max(0, 0.85 - sinceHurt * 0.9) * (p.hp < 40 ? 1 : 0.75) : 0.4;
  if (p.lastHurtBy && sinceHurt < 1.1 && p.alive) {
    const a = Math.atan2(-(p.lastHurtBy.x - p.x), -(p.lastHurtBy.z - p.z));
    let rel = a - p.yaw;
    el['hurt-dir'].style.opacity = 0.9;
    el['hurt-dir'].style.transform = `translate(-50%,-50%) rotate(${-rel}rad)`;
  } else el['hurt-dir'].style.opacity = 0;
  const blindLeft = p.blindUntil - state.time;
  el['blind-overlay'].style.opacity = blindLeft > 0 ? Math.min(1, blindLeft / 1.2) : 0;
  el.crosshair.style.opacity = p.alive && !buyOpen ? 1 : 0;

  // spectate label
  if (!p.alive && state.spectating) {
    el.spectate.hidden = false;
    el.spectate.textContent = `SPECTATING ${state.spectating.name} — click to switch`;
  } else el.spectate.hidden = true;

  drawMinimap(el.minimap);
}
