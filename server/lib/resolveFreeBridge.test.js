import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildJob,
  buildScript,
  installScript,
  luaString,
  parseResult,
  parseTriggerOutput,
  resolveScriptsFolder,
  stampedName,
  waitForResult,
} from './resolveFreeBridge.js';

/** Reads a Lua string literal back the way Lua 5.1 would (\ddd decimal bytes, no other escapes used). */
const unLua = (literal) => {
  assert.match(literal, /^".*"$/s);
  const bytes = [];
  const body = literal.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') {
      const m = /^\d{1,3}/.exec(body.slice(i + 1));
      bytes.push(Number(m[0]));
      i += m[0].length;
    } else bytes.push(body.charCodeAt(i));
  }
  return Buffer.from(bytes).toString('utf8');
};

test('luaString keeps any text, quotes, backslashes and Bangla included', () => {
  for (const s of ['C:\\Users\\a b\\x.fcpxml', 'say "hi"', 'Tamannaah#sadhguru dub', 'শিবাজি ডাব', 'line\nbreak', ']]==]', 'scratch\\77e9\\0', '\n1']) {
    const lit = luaString(s);
    assert.ok(/^"[\x20-\x7e]*"$/.test(lit), `only printable ASCII in ${lit}`);
    assert.equal(unLua(lit), s);
  }
});

test('luaString escapes are always three digits, so a digit after one is not swallowed', () => {
  assert.equal(luaString('a\\77'), '"a\\09277"');
  assert.equal(luaString('\n1'), '"\\0101"');
});

test('buildJob writes a data-only table and drops empty fields', () => {
  const job = buildJob({ id: 'abc', timeline: 'C:\\t.fcpxml', srt: null, fps: '25', width: 1280, project: 'x dub' });
  assert.match(job, /^return \{\n/);
  assert.match(job, /id = "abc",/);
  assert.match(job, /timeline = "C:\\092t.fcpxml",/);
  assert.match(job, /width = 1280,/);
  assert.match(job, /fps = "25",/);
  assert.doesNotMatch(job, /srt/);
});

test('parseResult reads key=value lines and knows when the file is whole', () => {
  assert.deepEqual(parseResult('id=1\nstatus=running\nEND\n'), { complete: true, id: '1', status: 'running' });
  assert.equal(parseResult('id=1\nstatus=ok').complete, false);
  assert.equal(parseResult('message=a=b\r\nEND').message, 'a=b');
  assert.deepEqual(parseResult(''), { complete: false });
});

test('the script carries the job and result paths and no JavaScript leftovers', () => {
  const script = buildScript({ jobPath: 'C:\\Users\\a\\job.lua', resultPath: 'C:\\Users\\a\\result.txt' });
  assert.ok(script.includes(`local JOB = ${luaString('C:\\Users\\a\\job.lua')}`));
  assert.ok(script.includes(`local RESULT = ${luaString('C:\\Users\\a\\result.txt')}`));
  assert.doesNotMatch(script, /\$\{|undefined/);
  assert.match(script, /ImportTimelineFromFile/);
  assert.match(script, /CreateProject/);
});

test('installScript writes DHVANI.lua once and leaves an unchanged one alone', async () => {
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dhvani-scripts-'));
  try {
    const file = await installScript({ folder: path.join(folder, 'Utility'), jobPath: 'j', resultPath: 'r' });
    assert.equal(path.basename(file), 'DHVANI.lua');
    const first = (await fs.promises.stat(file)).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    await installScript({ folder: path.join(folder, 'Utility'), jobPath: 'j', resultPath: 'r' });
    assert.equal((await fs.promises.stat(file)).mtimeMs, first);
  } finally {
    await fs.promises.rm(folder, { recursive: true, force: true });
  }
});

test("resolveScriptsFolder points at Resolve's per-user Utility scripts", () => {
  assert.equal(
    resolveScriptsFolder('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a'),
    path.join('C:\\Users\\a\\AppData\\Roaming', 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Scripts', 'Utility')
  );
  assert.match(resolveScriptsFolder('darwin', {}, '/Users/a'), /Library[\\/]Application Support[\\/]Blackmagic Design[\\/]DaVinci Resolve[\\/]Fusion[\\/]Scripts[\\/]Utility$/);
});

test('stampedName adds the date and minute', () => {
  assert.equal(stampedName('x dub', new Date(2026, 10, 26, 9, 5)), 'x dub 2026-11-26 09.05');
});

test("parseTriggerOutput takes the helper's last JSON line, or stderr's first line", () => {
  assert.deepEqual(parseTriggerOutput('noise\n{"ok":true,"code":"pressed"}'), { ok: true, code: 'pressed' });
  assert.deepEqual(parseTriggerOutput('', 'boom\nmore'), { ok: false, code: 'helper_output', message: 'boom' });
});

test('waitForResult waits for this job to finish, and gives up when the script never starts', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dhvani-result-'));
  const file = path.join(dir, 'result.txt');
  try {
    assert.deepEqual(await waitForResult(file, 'a', { ms: 400, startMs: 100, every: 20 }), { started: false });
    await fs.promises.writeFile(file, 'id=old\nstatus=ok\nEND\n');
    setTimeout(() => fs.promises.writeFile(file, 'id=a\nstatus=running\nEND\n'), 60);
    setTimeout(() => fs.promises.writeFile(file, 'id=a\nstatus=ok\nproject=p\nEND\n'), 160);
    const done = await waitForResult(file, 'a', { ms: 2000, startMs: 1000, every: 20 });
    assert.equal(done.status, 'ok');
    assert.equal(done.project, 'p');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
