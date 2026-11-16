// SLAGLINE — handover program for the make.fun threejs-fps-02 bounty (Node 22, standard library only).
//
// The game itself is the static site in game/: plain ES modules, no build step, three.js 0.187.0
// vendored under game/vendor/three/ and reached through the import map in game/index.html.
// This program's only job is to hand that site in exactly as the bounty asks: copy game/ and
// screenshots/ into the output directory, then write dossier.json with the kit's own
// buildDossier() so the sealed scorer can rebuild it byte for byte and compare.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts     (locally)
//   node main.ts                                            (in the grader, /output is implied)
//
// The copy is a plain recursive copy of regular files, so two runs over the same tree write
// the same bytes; buildDossier reads only file paths and contents, never timestamps.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const gameSource = join(repoRoot, 'game');
if (!existsSync(join(gameSource, 'index.html'))) {
  throw new Error('game/index.html is missing: there is no game to hand in');
}

mkdirSync(outputDir, { recursive: true });
cpSync(gameSource, join(outputDir, 'game'), { recursive: true });

const shotsSource = join(repoRoot, 'screenshots');
const shotsTarget = join(outputDir, 'screenshots');
mkdirSync(shotsTarget, { recursive: true });
if (existsSync(shotsSource)) {
  cpSync(shotsSource, shotsTarget, { recursive: true });
}

// The caps below are the scorer's own (see the kit's gate description): they refuse nothing a
// valid entry would carry, they only keep this program from writing an output the scorer
// would refuse anyway — at most 4 screenshots of 256 KiB, at most 993 game files / 48 MiB,
// and the judge's source text capped at 160 KiB inside a dossier of at most 1.5 MiB.
const dossierText = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outputDir, 'dossier.json'), dossierText);

const shotCount = existsSync(shotsTarget) ? readdirSync(shotsTarget).length : 0;
console.log(`slagline: handed in game/ and ${shotCount} screenshot(s); dossier.json is ${dossierText.length} bytes`);
