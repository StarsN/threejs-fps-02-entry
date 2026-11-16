// audio.js — SLAGLINE's sound is synthesised, never sampled.
// Every effect is built from oscillators and filtered noise through one master
// gain, so the game ships zero audio files and plays offline. Sounds are cheap
// and fire-and-forget; distance attenuation is a plain gain the caller passes.

let ctx = null;
let master = null;
let noiseBuffer = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  // two seconds of white noise, reused by every noise-based effect
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function env(gain, t0, peak, decay) {
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
}

function noiseBurst({ at = 0, dur = 0.12, freq = 1800, q = 0.8, peak = 0.5, type = 'lowpass' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  env(gain, t0, peak, dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function tone({ at = 0, freq = 440, slide = 0, dur = 0.15, peak = 0.3, type = 'square' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  const gain = ctx.createGain();
  env(gain, t0, peak, dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// A gunshot: a crack of broadband noise over a low thump. `kind` shifts the body
// of the sound per weapon class; `vol` carries distance for other fighters' fire.
export function sfxShot(kind, vol = 1) {
  if (!ctx) return;
  const v = Math.min(1, vol);
  switch (kind) {
    case 'shotgun':
      noiseBurst({ dur: 0.28, freq: 900, peak: 0.85 * v });
      tone({ freq: 120, slide: -70, dur: 0.22, peak: 0.5 * v, type: 'triangle' });
      break;
    case 'dmr':
      noiseBurst({ dur: 0.2, freq: 2400, peak: 0.8 * v });
      tone({ freq: 160, slide: -110, dur: 0.2, peak: 0.55 * v, type: 'triangle' });
      break;
    case 'smg':
      noiseBurst({ dur: 0.09, freq: 2100, peak: 0.5 * v });
      tone({ freq: 210, slide: -120, dur: 0.08, peak: 0.3 * v, type: 'triangle' });
      break;
    case 'pistol':
      noiseBurst({ dur: 0.11, freq: 1900, peak: 0.55 * v });
      tone({ freq: 190, slide: -110, dur: 0.1, peak: 0.35 * v, type: 'triangle' });
      break;
    default: // rifle
      noiseBurst({ dur: 0.14, freq: 1600, peak: 0.7 * v });
      tone({ freq: 150, slide: -90, dur: 0.13, peak: 0.45 * v, type: 'triangle' });
  }
}

export function sfxDryFire() { tone({ freq: 1200, dur: 0.04, peak: 0.12 }); }
export function sfxReload() {
  noiseBurst({ dur: 0.05, freq: 2600, peak: 0.2, type: 'bandpass' });
  noiseBurst({ at: 0.16, dur: 0.05, freq: 1800, peak: 0.25, type: 'bandpass' });
  noiseBurst({ at: 0.34, dur: 0.06, freq: 3000, peak: 0.22, type: 'bandpass' });
}
export function sfxHit(head) {
  tone({ freq: head ? 1560 : 1180, dur: 0.06, peak: 0.22, type: 'sine' });
}
export function sfxKill() {
  tone({ freq: 880, dur: 0.09, peak: 0.25, type: 'sine' });
  tone({ at: 0.07, freq: 1320, dur: 0.12, peak: 0.25, type: 'sine' });
}
export function sfxHurt() { noiseBurst({ dur: 0.1, freq: 500, peak: 0.3 }); }
export function sfxBuy() { tone({ freq: 990, dur: 0.06, peak: 0.18, type: 'sine' }); tone({ at: 0.06, freq: 1480, dur: 0.08, peak: 0.18, type: 'sine' }); }
export function sfxDeny() { tone({ freq: 220, dur: 0.1, peak: 0.2 }); }
export function sfxPlantBeep(final) {
  tone({ freq: final ? 1760 : 1174, dur: final ? 0.3 : 0.07, peak: 0.22, type: 'sine' });
}
export function sfxExplosion(vol = 1) {
  noiseBurst({ dur: 0.9, freq: 300, peak: 1.0 * vol });
  tone({ freq: 70, slide: -40, dur: 0.8, peak: 0.8 * vol, type: 'sine' });
}
export function sfxFlash() {
  tone({ freq: 3400, slide: -1800, dur: 0.5, peak: 0.3, type: 'sine' });
}
export function sfxThrow() { noiseBurst({ dur: 0.08, freq: 900, peak: 0.12, type: 'bandpass' }); }
export function sfxRoundWin(won) {
  const base = won ? [523, 659, 784] : [392, 330, 262];
  base.forEach((f, i) => tone({ at: i * 0.11, freq: f, dur: 0.22, peak: 0.22, type: 'triangle' }));
}
export function sfxStep(run) {
  noiseBurst({ dur: 0.05, freq: run ? 700 : 500, peak: run ? 0.1 : 0.05 });
}
