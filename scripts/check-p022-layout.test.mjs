import test from 'node:test';
import assert from 'node:assert/strict';

import { checkP022Layout, P022_LAYOUT_CONTRACT } from './check-p022-layout.mjs';

test('P022 layout contract is valid', () => {
  assert.deepEqual(checkP022Layout(), []);
  assert.equal(P022_LAYOUT_CONTRACT, 'ltcm.p022.layout-design-system.v1');
});
