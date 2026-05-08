#!/usr/bin/env node
/**
 * Postinstall banner. Runs after `npm install` (and `npm postinstall`)
 * to point a fresh user at the next step. Tone: short, ASCII-only, no
 * emoji, adapts based on whether `.env.local` already exists.
 *
 * Suppressed when CI=true or NPM_CONFIG_LOGLEVEL=silent so server installs
 * stay quiet. To always silence, set CMS_VERCEL_NO_BANNER=1.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (
  process.env.CI === 'true' ||
  process.env.NPM_CONFIG_LOGLEVEL === 'silent' ||
  process.env.CMS_VERCEL_NO_BANNER === '1'
) {
  process.exit(0);
}

const cwd = process.env.INIT_CWD ?? process.cwd();
const hasEnvLocal = existsSync(join(cwd, '.env.local'));
const hasEnvExample = existsSync(join(cwd, '.env.example'));

// ANSI color helpers. Use only when stdout is a TTY; otherwise plain text.
const tty = process.stdout.isTTY;
const c = {
  bold:  (s) => tty ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:   (s) => tty ? `\x1b[2m${s}\x1b[0m`  : s,
  green: (s) => tty ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:  (s) => tty ? `\x1b[36m${s}\x1b[0m` : s,
  yellow:(s) => tty ? `\x1b[33m${s}\x1b[0m` : s,
};

const line = '─'.repeat(60);

console.log('');
console.log(c.dim(line));
console.log(`  ${c.bold('cms-vercel')} ${c.dim('— installed and built.')}`);
console.log(c.dim(line));
console.log('');
console.log(`  ${c.bold('Next steps:')}`);

let n = 1;
if (!hasEnvLocal && hasEnvExample) {
  console.log(`    ${c.cyan(`${n}.`)} cp .env.example .env.local`);
  console.log(`       ${c.dim('then paste your DATABASE_URL into .env.local')}`);
  n++;
} else if (!hasEnvLocal && !hasEnvExample) {
  console.log(`    ${c.cyan(`${n}.`)} create ${c.bold('.env.local')} with ${c.bold('DATABASE_URL=...')}`);
  n++;
} else {
  console.log(`    ${c.green('OK')} ${c.dim('.env.local already exists — skipping.')}`);
}

console.log(`    ${c.cyan(`${n++}.`)} ${c.bold('npx vercel dev')}                 ${c.dim('# http://localhost:3000')}`);
console.log(`    ${c.cyan(`${n++}.`)} edit files in ${c.bold('app/')}             ${c.dim('# runtime hot-reloads on save')}`);
console.log('');
console.log(`  ${c.bold('Where to put your code:')}  ${c.green('app/')}`);
console.log(`  ${c.bold('Where NOT to edit:')}       ${c.yellow('packages/runtime/')}  ${c.dim('(framework, git pull updates)')}`);
console.log('');
console.log(`  ${c.bold('Guides:')}  HOWTOLAUNCH.md  ·  BUILDING.md  ·  CONVERTING.md`);
console.log(c.dim(line));
console.log('');
