import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeP013MonthlyMoney,
  createP013MonthlyBaselineIdempotencyKey,
  createP013MonthlyBaselineSemanticIdentity,
  type P013MonthlyCellInput,
} from '../src/monthly-baseline.js';

const ITEM_A = '00000000-0000-4000-8000-000000013001';
const ITEM_B = '00000000-0000-4000-8000-000000013002';
const PLAN = '00000000-0000-4000-8000-000000013003';
const SOURCE_KEY_A = `p012-item-v1:${'a'.repeat(64)}`;
const SOURCE_KEY_B = `p012-item-v1:${'b'.repeat(64)}`;

function cells(): P013MonthlyCellInput[] {
  return [
    {
      project_item_id: ITEM_A,
      source_line_key: SOURCE_KEY_A,
      competence_month: '2026-07-01',
      declaration_state: 'blank',
      raw_decimal: null,
    },
    {
      project_item_id: ITEM_A,
      source_line_key: SOURCE_KEY_A,
      competence_month: '2026-08-01',
      declaration_state: 'explicit_zero',
      raw_decimal: '0',
    },
    {
      project_item_id: ITEM_B,
      source_line_key: SOURCE_KEY_B,
      competence_month: '2026-07-01',
      declaration_state: 'value',
      raw_decimal: '866.59999999999991',
    },
  ];
}

test('canonicaliza dinheiro P013 com decimal exato e rounding por célula', () => {
  assert.equal(canonicalizeP013MonthlyMoney('0'), '0.00');
  assert.equal(canonicalizeP013MonthlyMoney('0.00'), '0.00');
  assert.equal(canonicalizeP013MonthlyMoney('-0'), '0.00');
  assert.equal(canonicalizeP013MonthlyMoney('+0.00000000000000'), '0.00');
  assert.equal(canonicalizeP013MonthlyMoney('0.01'), '0.01');
  assert.equal(canonicalizeP013MonthlyMoney('0.004'), '0.00');
  assert.equal(canonicalizeP013MonthlyMoney('0.005'), '0.01');
  assert.equal(canonicalizeP013MonthlyMoney('0.006'), '0.01');
  assert.equal(canonicalizeP013MonthlyMoney('0.00499999999999'), '0.00');
  assert.equal(canonicalizeP013MonthlyMoney('0.00500000000000'), '0.01');
  assert.equal(canonicalizeP013MonthlyMoney('999.99999999999999'), '1000.00');
  assert.equal(canonicalizeP013MonthlyMoney('866.59999999999991'), '866.60');
  assert.equal(canonicalizeP013MonthlyMoney('999999999999999999.994'), '999999999999999999.99');
  assert.throws(() => canonicalizeP013MonthlyMoney('999999999999999999.995'), /overflow/u);
});

test('rejeita negativos, expoente, escala acima de 14 e overflow', () => {
  for (const value of [
    '-0.01',
    '+1',
    '1e2',
    '1,00',
    '01.00',
    '0.000000000000001',
    '9999999999999999999',
    ' 1.00',
    '1.00 ',
    '１.00',
    '1.00\u200b',
    '1.00\u0000',
    '.',
  ]) {
    assert.throws(() => canonicalizeP013MonthlyMoney(value), /P013_MONTHLY_CONTRACT_INVALID/u);
  }
});

test('fingerprint é determinístico, ordenado e ignora representação decimal incidental', () => {
  const original = createP013MonthlyBaselineSemanticIdentity(cells());
  const reordered = createP013MonthlyBaselineSemanticIdentity([...cells()].reverse());
  const equivalent = createP013MonthlyBaselineSemanticIdentity(
    cells().map((cell) =>
      cell.declaration_state === 'explicit_zero' ? { ...cell, raw_decimal: '0.00' } : cell,
    ),
  );
  assert.equal(reordered.semantic_fingerprint, original.semantic_fingerprint);
  assert.equal(equivalent.semantic_fingerprint, original.semantic_fingerprint);
  assert.equal(original.cells[1]?.canonical_amount, '0.00');
  assert.equal(original.cells[2]?.canonical_amount, '866.60');
  assert.equal(
    createP013MonthlyBaselineIdempotencyKey(PLAN, original.semantic_fingerprint),
    createP013MonthlyBaselineIdempotencyKey(PLAN, reordered.semantic_fingerprint),
  );
});

test('fingerprint distingue blank, zero, valor, competência e project_item', () => {
  const original = createP013MonthlyBaselineSemanticIdentity(cells()).semantic_fingerprint;
  const mutations: P013MonthlyCellInput[][] = [
    cells().map((cell, index) =>
      index === 0 ? { ...cell, declaration_state: 'explicit_zero', raw_decimal: '0' } : cell,
    ),
    cells().map((cell, index) => (index === 2 ? { ...cell, raw_decimal: '866.61' } : cell)),
    cells().map((cell, index) =>
      index === 2 ? { ...cell, competence_month: '2026-09-01' } : cell,
    ),
    cells().map((cell, index) =>
      index === 2 ? { ...cell, project_item_id: ITEM_A, competence_month: '2026-09-01' } : cell,
    ),
  ];
  for (const mutation of mutations) {
    assert.notEqual(
      createP013MonthlyBaselineSemanticIdentity(mutation).semantic_fingerprint,
      original,
    );
  }
});

test('falha fechado em estados incoerentes, identidade inválida e duplicidade', () => {
  assert.throws(
    () =>
      createP013MonthlyBaselineSemanticIdentity([
        { ...cells()[0]!, declaration_state: 'blank', raw_decimal: '0' },
      ]),
    /blank-has-value/u,
  );
  assert.throws(
    () =>
      createP013MonthlyBaselineSemanticIdentity([{ ...cells()[1]!, declaration_state: 'value' }]),
    /value-is-zero/u,
  );
  assert.throws(
    () => createP013MonthlyBaselineSemanticIdentity([cells()[0]!, cells()[0]!]),
    /duplicate-item-month/u,
  );
});

test('D04A accepts only the three exact canonical declaration states', () => {
  for (const declarationState of ['invented', 'Blank', ' value', 'value ', '', null, undefined]) {
    assert.throws(
      () =>
        createP013MonthlyBaselineSemanticIdentity([
          {
            ...cells()[2]!,
            declaration_state: declarationState,
          } as unknown as P013MonthlyCellInput,
        ]),
      /P013_MONTHLY_CONTRACT_INVALID: declaration-state/u,
    );
  }
});
