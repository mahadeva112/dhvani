import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientLogLine } from './health.js';

test("the app's log lines are plain, one line and short", () => {
  assert.equal(clientLogLine({ message: 'POST /api/sync lost its connection\nafter 300 s' }), 'App: POST /api/sync lost its connection after 300 s');
  assert.equal(clientLogLine({ message: 'x'.repeat(2000) }).length, 'App: '.length + 500);
  assert.equal(clientLogLine({ message: '   ' }), null);
  assert.equal(clientLogLine({ message: 42 }), null);
  assert.equal(clientLogLine(undefined), null);
});
