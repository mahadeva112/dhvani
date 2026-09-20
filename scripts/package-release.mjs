import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * Builds the "plain zip" distribution: a self-contained folder a user unzips
 * and runs with `npm start`, with no Docker and no installer.
 *
 * Deliberately excludes node_modules — shipping them would triple the archive
 * size and break native binaries across platforms. The bundled START scripts
 * run `npm install --omit=dev` on first launch instead.
 *
 *   node scripts/package-release.mjs
 */

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = require(path.join(ROOT, 'package.json'));

const RELEASE_DIR = path.join(ROOT, 'release');
const STAGE_NAME = `dhvani-${version}`;
const STAGE = path.join(RELEASE_DIR, STAGE_NAME);

/** Files and folders that make up a runnable install. */
const INCLUDE = [
  'dist',
  'server',
  'scripts/generate-icon.mjs',
  'package.json',
  'package-lock.json',
  '.env.example',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'SECURITY.md',
  'docs',
  'Dockerfile',
  'docker-compose.yml',
  '.dockerignore',
];

const log = (message) => console.log(`  ${message}`);

const copyInto = (source, destination) => {
  const from = path.join(ROOT, source);
  if (!fs.existsSync(from)) {
    log(`skipped ${source} (not found)`);
    return false;
  }
  const to = path.join(destination, source);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  return true;
};

/** Measures a directory tree so the summary can report a real size. */
const directorySize = (target) => {
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
  }
  return total;
};

/* ------------------------------------------------------------------ */

console.log(`\nPackaging DHVANI ${version}\n`);

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('  No build found. Run "npm run build" first.\n');
  process.exit(1);
}

/**
 * Clears the staging directory, tolerating a transient lock.
 *
 * On Windows an antivirus scan, the file indexer or an editor watching the
 * folder can hold a handle for a second or two after the previous run. Failing
 * the whole release for that is not useful, so retry briefly before giving up
 * with an explanation rather than a raw stack trace.
 */
const clearStagingDir = () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(STAGE, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch (err) {
      if (attempt === 4) {
        console.error(`\n  Could not clear ${STAGE}`);
        console.error(`  ${err.code || 'Error'}: something is holding that folder open.`);
        console.error('  Close any editor or file browser pointed at it, then run this again.\n');
        process.exit(1);
      }
      // Busy-wait briefly; this runs a handful of times at most.
      const until = Date.now() + 400;
      while (Date.now() < until) {
        /* wait for the handle to be released */
      }
    }
  }
};

clearStagingDir();
fs.mkdirSync(STAGE, { recursive: true });

log('Staging files...');
for (const entry of INCLUDE) copyInto(entry, STAGE);

/*
 * Guard against ever shipping a real key: `.env` is excluded from INCLUDE, but
 * a stray copy inside another folder would be silently archived.
 */
const leaked = [];
const scanForSecrets = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanForSecrets(full);
    else if (/^\.env(\.|$)/.test(entry.name) && entry.name !== '.env.example') {
      leaked.push(path.relative(STAGE, full));
    }
  }
};
scanForSecrets(STAGE);

if (leaked.length > 0) {
  console.error(`\n  Refusing to package: found environment files that may contain keys:`);
  for (const file of leaked) console.error(`    ${file}`);
  console.error('');
  process.exit(1);
}

// Convenience launchers so a non-technical user never has to know the commands.
fs.writeFileSync(
  path.join(STAGE, 'START-WINDOWS.bat'),
  [
    '@echo off',
    'title DHVANI',
    'cd /d "%~dp0"',
    '',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo Node.js 20 or newer is required. Download it from https://nodejs.org',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    'if not exist node_modules (',
    '  echo Installing dependencies. This happens once and takes a minute...',
    '  call npm install --omit=dev',
    ')',
    '',
    'echo Starting DHVANI...',
    'start "" http://localhost:8787',
    'node server/index.js',
    'pause',
    '',
  ].join('\r\n')
);

fs.writeFileSync(
  path.join(STAGE, 'start-macos-linux.sh'),
  [
    '#!/usr/bin/env bash',
    'set -e',
    'cd "$(dirname "$0")"',
    '',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "Node.js 20 or newer is required. Download it from https://nodejs.org"',
    '  exit 1',
    'fi',
    '',
    'if [ ! -d node_modules ]; then',
    '  echo "Installing dependencies. This happens once and takes a minute..."',
    '  npm install --omit=dev',
    'fi',
    '',
    'echo "Starting DHVANI on http://localhost:8787"',
    '(sleep 2 && (open http://localhost:8787 2>/dev/null || xdg-open http://localhost:8787 2>/dev/null || true)) &',
    'exec node server/index.js',
    '',
  ].join('\n'),
  { mode: 0o755 }
);

fs.writeFileSync(
  path.join(STAGE, 'FIRST-RUN.txt'),
  [
    `DHVANI ${version}`,
    '='.repeat(40),
    '',
    'WHAT YOU NEED',
    '  1. Node.js 20 or newer      https://nodejs.org',
    '  2. An ElevenLabs API key    https://elevenlabs.io/app/settings/api-keys',
    '  3. A Gemini API key         https://aistudio.google.com/apikey',
    '',
    'HOW TO START',
    '  Windows        double-click START-WINDOWS.bat',
    '  macOS / Linux  run ./start-macos-linux.sh in a terminal',
    '',
    '  Your browser opens at http://localhost:8787 and asks for the two API',
    '  keys. That is the whole setup — they are saved on this computer only.',
    '',
    'PREFER A FILE INSTEAD?',
    '  Copy .env.example to .env, paste your keys into it, then start as above.',
    '',
    'WHAT IT DOES',
    '  Audio or video in, accurately timed subtitles out. ElevenLabs measures',
    '  every timestamp from the audio itself; Gemini translates the text and',
    '  never touches the timing.',
    '',
    'MORE',
    '  README.md              full documentation',
    '  docs/ARCHITECTURE.md   how it works',
    '  SECURITY.md            how your keys are handled',
    '',
  ].join('\n')
);

log('Wrote launcher scripts');

/* ------------------------------------------------------------------ */

const archiveName = `${STAGE_NAME}.zip`;
const archivePath = path.join(RELEASE_DIR, archiveName);
fs.rmSync(archivePath, { force: true });

log('Creating archive...');

let archived = false;
try {
  if (os.platform() === 'win32') {
    // Compress-Archive ships with Windows PowerShell; no extra tooling needed.
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path '${STAGE}' -DestinationPath '${archivePath}' -Force`,
      ],
      { stdio: 'inherit' }
    );
  } else {
    execFileSync('zip', ['-rq', archivePath, STAGE_NAME], { cwd: RELEASE_DIR, stdio: 'inherit' });
  }
  archived = true;
} catch (err) {
  console.warn(`\n  Could not create the archive automatically (${err.message}).`);
  console.warn(`  The unpacked folder is ready at: ${STAGE}\n`);
}

const stagedSize = directorySize(STAGE);

console.log('');
console.log(`  Folder   ${STAGE}`);
console.log(`  Contents ${(stagedSize / 1024 / 1024).toFixed(1)} MB`);
if (archived) {
  console.log(`  Archive  ${archivePath} (${(fs.statSync(archivePath).size / 1024 / 1024).toFixed(1)} MB)`);
}
console.log('');
