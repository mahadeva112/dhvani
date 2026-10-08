import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentStep, openSteps } from './steps.ts';
import type { BatchJob } from '../types.ts';

const job = (fields: Partial<BatchJob>) =>
  ({ segments: [{ id: 1, startTime: 0, endTime: 2, duration: 2, textSource: 'Hello' }], ...fields }) as unknown as BatchJob;

test('Dub opens once there is a script, before any dub is made', () => {
  assert.deepEqual(openSteps(job({ targetSource: 'translated' })), { upTo: 3, why: {} });
  // Projects from before the choice existed have a script and no targetSource.
  assert.equal(openSteps(job({})).upTo, 3);
});

test('Dub stays locked while the script is missing or still coming', () => {
  const pending = openSteps(job({ targetSource: 'pending' }));
  assert.equal(pending.upTo, 2);
  assert.match(pending.why[3], /Translate the transcript/);
  assert.equal(openSteps(job({}), { translating: true }).upTo, 2);
  assert.equal(openSteps(job({}), { transcribing: true }).upTo, 1);
  assert.equal(openSteps(null).upTo, 1);
  assert.equal(openSteps(null).why[4], undefined);
});

test('a project kept on Final dub or Sync opens on Dub', () => {
  assert.equal(currentStep(4), 3);
  assert.equal(currentStep(3), 3);
  assert.equal(currentStep(2), 2);
  assert.equal(currentStep(1), 1);
});
