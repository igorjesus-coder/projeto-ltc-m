import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeP012PersistencePlanHash,
  type P012PersistencePlan,
} from '../src/item-persistence.js';
import { parseP012LoopbackDatabaseUrlForTestHarness } from './support/postgres-item-persistence.js';

const HASH = 'a'.repeat(64);

function manualPlan(): P012PersistencePlan {
  const preimage: Omit<P012PersistencePlan, 'plan_hash'> = {
    contract: 'ltcm.p012.persistence-plan.v1',
    payload_schema_version: 1,
    logical_environment: 'test',
    batch: {
      id: '00000000-0000-4000-8000-000000000284',
      idempotency_key: `ltcm-p011:${HASH}`,
      source_hash: HASH,
    },
    p010_manifest_hash: HASH,
    input_hash: HASH,
    workbook_hash: HASH,
    p011_artifacts_hash: HASH,
    p012_candidate_set_hash: HASH,
    snapshot_hash: HASH,
    project_targets: [
      {
        project_candidate_id: 'project-000000000000000000000001',
        project_id: '00000000-0000-4000-8000-000000000281',
      },
    ],
    operations: [
      {
        order: 1,
        action: 'insert',
        candidate_id: 'item-000000000000000000000001',
        candidate_hash: HASH,
        project_candidate_id: 'project-000000000000000000000001',
        project_id: '00000000-0000-4000-8000-000000000281',
        source_line_key: `p012-item-v1:${HASH}`,
        line_number: 1,
        item_code: 'MANUAL',
        description: 'Operação manual sem provenance',
        quantity: '1.0000',
        unit_code: 'UN',
        currency_code: 'BRL',
        unit_price: '1.0000',
        total_amount: '1.00',
        expected_target_id: null,
        expected_row_version: null,
        staging: {
          sheet_key: 'monthly_revenue',
          source_row_number: 4,
          row_hash: HASH,
        },
      },
    ],
    expected_counts: {
      attempted: 1,
      insert: 1,
      no_op: 0,
      conflict: 0,
      rejected: 0,
      pending: 0,
    },
  };
  return { ...preimage, plan_hash: computeP012PersistencePlanHash(preimage) };
}

test('D13A restringe URL test-only a loopback literal e banco sintético', () => {
  for (const [value, expectedHost] of [
    ['postgresql://user:p%40ss@127.0.0.1:5432/ltcm_test', '127.0.0.1'],
    ['postgres://user:password@LOCALHOST/ltcm_test', 'localhost'],
    ['postgresql://user:password@[::1]:5432/ltcm_test', '[::1]'],
  ] as const) {
    assert.deepEqual(parseP012LoopbackDatabaseUrlForTestHarness(value), {
      databaseName: 'ltcm_test',
      hostname: expectedHost,
      port: 5432,
    });
  }

  for (const value of [
    'postgresql://user:password@10.0.0.1:5432/ltcm_test',
    'postgresql://user:password@172.16.0.1:5432/ltcm_test',
    'postgresql://user:password@192.168.0.1:5432/ltcm_test',
    'postgresql://user:password@[fc00::1]:5432/ltcm_test',
    'postgresql://user:password@localhost.evil:5432/ltcm_test',
    'postgresql://user:password@127.0.0.1.evil:5432/ltcm_test',
    'postgresql://user:password@localhost.:5432/ltcm_test',
    'postgresql://user:password@%6cocalhost:5432/ltcm_test',
    'postgresql://user:password@127.0.0.1:5433/ltcm_test',
    'postgresql://user:password@127.0.0.1:5432/production',
    'postgresql://user:password@127.0.0.1:5432/ltcm_test?sslmode=disable',
    'postgresql://user:password@127.0.0.1:5432/ltcm_test?application_name=p012',
    'postgresql://user:password@127.0.0.1:5432/ltcm_test#fragment',
  ]) {
    assert.throws(
      () => parseP012LoopbackDatabaseUrlForTestHarness(value),
      /P012_PERSISTENCE_NOT_AUTHORIZED/u,
      value,
    );
  }
});

test('D13A remove helper, adapter e writer da superfície ESM de produção', async () => {
  const productModule: Record<string, unknown> =
    await import('../src/postgres-item-persistence.js');
  assert.deepEqual(Object.keys(productModule), []);
  assert.equal(productModule['authorizeP012LocalWritesForTestHarness'], undefined);
  assert.equal(productModule['PostgresP012PersistenceAdapter'], undefined);
  assert.equal(productModule['serializableTransaction'], undefined);

  const forbiddenPackageSubpath = '@ltcm/normalizer/test/support/postgres-item-persistence.js';
  await assert.rejects(
    import(forbiddenPackageSubpath),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      (error as Error & { code?: string }).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  );
});

test('D13A plan e operação manuais rehashados não encontram writer público', async () => {
  const plan = manualPlan();
  assert.equal(plan.plan_hash, computeP012PersistencePlanHash(plan));
  plan.operations[0]!.description = 'Operação manual semanticamente alterada';
  plan.operations[0]!.candidate_hash = 'b'.repeat(64);
  plan.plan_hash = computeP012PersistencePlanHash(plan);
  assert.equal(plan.plan_hash, computeP012PersistencePlanHash(plan));

  const productModule: Record<string, unknown> =
    await import('../src/postgres-item-persistence.js');
  assert.deepEqual(Object.keys(productModule), []);
});
