import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openClipStore, closeClipStore, storeClip, readStoredClip, pruneClipStore } from './clipStore.js';

const key = (c) => c.repeat(64);

test('a stored clip reads back byte for byte, and an unknown or malformed key reads as null', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhvani-clips-'));
  try {
    assert.equal(openClipStore(dir), true);
    const bytes = Buffer.from([1, 2, 3, 250, 0, 7]);
    await storeClip(key('a'), bytes);
    assert.deepEqual(await readStoredClip(key('a')), bytes);
    assert.equal(await readStoredClip(key('b')), null);
    assert.equal(await readStoredClip('../config'), null);
    await storeClip('../escape', bytes);
    assert.deepEqual(fs.readdirSync(dir), [`${key('a')}.clip`]);
  } finally {
    closeClipStore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a closed store keeps nothing', async () => {
  closeClipStore();
  await storeClip(key('c'), Buffer.from([1]));
  assert.equal(await readStoredClip(key('c')), null);
});

test('pruning drops the clips used longest ago first', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhvani-clips-'));
  try {
    openClipStore(dir);
    await storeClip(key('a'), Buffer.alloc(10, 1));
    await storeClip(key('b'), Buffer.alloc(10, 2));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(dir, `${key('a')}.clip`), old, old);
    await pruneClipStore(15);
    assert.equal(await readStoredClip(key('a')), null);
    assert.ok(await readStoredClip(key('b')));
  } finally {
    closeClipStore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
