import assert from 'node:assert/strict';
import test from 'node:test';

import { checkP028, P028_PROJECT_ITEMS_LIFECYCLE_CONTRACT } from './check-p028-tests.mjs';

test('P028 contract and local implementation are complete', () => {
  assert.deepEqual(checkP028(), []);
  assert.equal(P028_PROJECT_ITEMS_LIFECYCLE_CONTRACT, 'ltcm.p028.project-items-lifecycle.v1');
});
