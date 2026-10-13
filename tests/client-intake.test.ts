import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withIntakeTimeout } from '../lib/client-intake-utils.ts';

test('a stalled PDF operation becomes a bounded, visible intake error', async () => {
  await assert.rejects(() => withIntakeTimeout(new Promise(() => {}), 10, 'PDF page timed out'), /PDF page timed out/);
});
test('successful PDF operations preserve their result', async () => {
  assert.equal(await withIntakeTimeout(Promise.resolve('page text'), 1000, 'timeout'), 'page text');
});
