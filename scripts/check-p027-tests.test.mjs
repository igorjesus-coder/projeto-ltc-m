import assert from 'node:assert/strict';
import test from 'node:test';

import { checkP027, P027_PROJECT_ITEMS_CONTRACT } from './check-p027-tests.mjs';

test('P027 contract and local implementation are complete', () => {
  assert.deepEqual(checkP027(), []);
  assert.equal(P027_PROJECT_ITEMS_CONTRACT, 'ltcm.p027.project-items-crud.v1');
});
