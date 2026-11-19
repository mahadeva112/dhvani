import test from 'node:test';
import assert from 'node:assert/strict';
import { diskSpace, LOW_DISK_BYTES } from './diskSpace.js';

const GB = 1024 ** 3;
const fakeStatfs = (freeBytes, totalBytes) => async () => ({ bsize: 4096, bavail: freeBytes / 4096, blocks: totalBytes / 4096 });

test('a nearly full drive is low', async () => {
  const disk = await diskSpace(process.cwd(), { statfs: fakeStatfs(0.5 * GB, 256 * GB) });
  assert.equal(disk.freeBytes, 0.5 * GB);
  assert.equal(disk.totalBytes, 256 * GB);
  assert.equal(disk.low, true);
});

test('a drive with room is not low', async () => {
  const disk = await diskSpace(process.cwd(), { statfs: fakeStatfs(40 * GB, 256 * GB) });
  assert.equal(disk.low, false);
  assert.ok(LOW_DISK_BYTES < 40 * GB);
});

test('names the drive: C: on Windows, / elsewhere', async () => {
  const disk = await diskSpace(process.cwd(), { statfs: fakeStatfs(40 * GB, 256 * GB) });
  assert.match(disk.drive, process.platform === 'win32' ? /^[A-Z]:$/ : /^\/$/);
});

test('null when the drive cannot be read', async () => {
  const failing = async () => {
    throw new Error('EPERM');
  };
  assert.equal(await diskSpace(process.cwd(), { statfs: failing }), null);
  assert.equal(await diskSpace(process.cwd(), { statfs: async () => ({ bsize: 4096, bavail: 1, blocks: 0 }) }), null);
});

test('reads the real drive this runs on', async () => {
  const disk = await diskSpace(process.cwd());
  assert.ok(disk && disk.totalBytes > 0 && disk.freeBytes >= 0);
});
