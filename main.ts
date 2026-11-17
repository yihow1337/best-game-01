// Hand-in program for VOLT, a neon arcade survival shooter that lives in game/ as plain static
// files: game/index.html plus a handful of ES modules, no build step, no library, no network call.
//
// What this does, in order: check the entry is actually complete and within the scorer's limits,
// copy game/ and screenshots/ into the output directory, write the dossier.json the judge reads,
// and print one line saying what was handed in.
//
// The validation up front is the point. buildDossier will happily describe a broken entry -- an
// entry with no index.html, or with five screenshots, or with one screenshot too large to accept --
// and the failure then surfaces late, in the grader, as a low score rather than as an error here.
// Checking first turns those into a loud message on this machine, while they are still fixable.
//
// In the grader's container the output directory is /output. Elsewhere, MAKEFUN_OUTPUT_DIR stands
// in for it:
//   rm -rf out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

// The scorer's own caps, from reference/gate.json. Only text_max_bytes shapes the bytes that end up
// in the dossier; the rest describe an entry the scorer would refuse outright (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game files in all; a
// path under game/ longer than 1000 bytes -- game/ counts against /output's own 1000-entry cap,
// alongside its screenshots/ and dossier.json).
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// The judge reads the first screenshot by name as the cover, so there must be a few of them, and
// they have to be formats a browser and the scorer both accept.
const MIN_SCREENSHOTS = 3;
const SCREENSHOT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

/** Abort with a message that says what is wrong and, where it helps, what to do about it. */
function refuse(problem: string): never {
  throw new Error(`VOLT is not ready to hand in: ${problem}`);
}

/** Every file at or below `dir`, as paths relative to it, using forward slashes like the dossier. */
function walk(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) found.push(...walk(join(dir, entry.name), rel));
    else if (entry.isFile()) found.push(rel);
  }
  return found;
}

const totalBytes = (dir: string, files: string[]): number =>
  files.reduce((sum, rel) => sum + statSync(join(dir, ...rel.split('/'))).size, 0);

const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`;

// ---------------------------------------------------------------- preflight

if (!existsSync(gameDir) || !statSync(gameDir).isDirectory()) refuse('there is no game/ directory beside main.ts');

// index.html is the entry point the judge opens; without it nothing else matters.
const indexHtml = join(gameDir, 'index.html');
if (!existsSync(indexHtml) || !statSync(indexHtml).isFile()) {
  refuse('game/index.html is missing -- that file is the entry point the judge opens');
}
if (statSync(indexHtml).size === 0) refuse('game/index.html is empty');

const gameFiles = walk(gameDir);
const gameBytes = totalBytes(gameDir, gameFiles);
if (gameFiles.length > CAPS.game_max_files) {
  refuse(`game/ holds ${gameFiles.length} files, over the ${CAPS.game_max_files} the scorer accepts`);
}
if (gameBytes > CAPS.game_max_bytes) {
  refuse(`game/ is ${kib(gameBytes)}, over the ${kib(CAPS.game_max_bytes)} the scorer accepts`);
}
// Paths are measured in bytes, not characters, so a non-ASCII filename can be longer than it looks.
for (const rel of gameFiles) {
  const pathBytes = Buffer.byteLength(`game/${rel}`, 'utf8');
  if (pathBytes > CAPS.game_path_max_bytes) refuse(`the path game/${rel} is ${pathBytes} bytes, over the ${CAPS.game_path_max_bytes} byte limit`);
}

if (!existsSync(shotsDir) || !statSync(shotsDir).isDirectory()) {
  refuse(`there is no screenshots/ directory -- ${MIN_SCREENSHOTS} PNG or JPEG captures of the game belong there`);
}
const screenshots = walk(shotsDir).filter((rel) => SCREENSHOT_EXTENSIONS.has(extname(rel).toLowerCase()));
if (screenshots.length < MIN_SCREENSHOTS) {
  refuse(`screenshots/ has ${screenshots.length} PNG or JPEG file(s); at least ${MIN_SCREENSHOTS} are needed (the first by name is the cover)`);
}
if (screenshots.length > CAPS.screenshots.max) {
  refuse(`screenshots/ has ${screenshots.length} images, over the ${CAPS.screenshots.max} the scorer accepts`);
}
for (const rel of screenshots) {
  const size = statSync(join(shotsDir, ...rel.split('/'))).size;
  if (size > CAPS.screenshots.max_bytes) {
    refuse(`screenshots/${rel} is ${kib(size)}, over the ${kib(CAPS.screenshots.max_bytes)} per-image limit`);
  }
}
const screenshotBytes = totalBytes(shotsDir, screenshots);

// -------------------------------------------------------------------- build

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
// Keep screenshots/ present even in the odd case where the copy below brings nothing new, so the
// output layout is the same shape every run.
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

const dossier = buildDossier(out, CAPS);
const dossierPath = join(out, 'dossier.json');
writeFileSync(dossierPath, dossier);

// One line, so a run that went fine is readable at a glance and the numbers are checkable.
console.log(
  `VOLT -> ${out}${sep}: ${gameFiles.length} game files (${kib(gameBytes)}), ` +
    `${screenshots.length} screenshots (${kib(screenshotBytes)}), cover ${screenshots[0]}, ` +
    `dossier.json ${kib(Buffer.byteLength(dossier, 'utf8'))}`,
);
