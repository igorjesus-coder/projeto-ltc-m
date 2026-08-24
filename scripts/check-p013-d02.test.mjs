import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { checkP013D02, P013_MIGRATION, scanP013D02 } from './check-p013-d02.mjs';

const repositoryRoot = path.resolve('.');

test('rejeita export de tipos P013 dependente de dist mesmo com artefato residual', () => {
  const input = sources();
  input.extractorPackage = input.extractorPackage.replace(
    './types/p013.d.ts',
    './dist/src/p013-monthly-source.d.ts',
  );
  const issues = scanP013D02(input);

  assert.ok(issues.some((issue) => issue.includes('contrato TypeScript versionado')));
});

test('rejeita ausência do target versionado do export de tipos P013', () => {
  const input = sources();
  input.extractorTypesTargetExists = false;
  const issues = scanP013D02(input);

  assert.ok(issues.some((issue) => issue.includes('target versionado')));
});

function sources() {
  const read = (...segments) => fs.readFileSync(path.join(repositoryRoot, ...segments), 'utf8');
  return {
    migration: read('supabase', 'migrations', P013_MIGRATION),
    sourceGate: read('tools', 'ltcm-extractor', 'src', 'p013-source-gate.ts'),
    profileValidator: read('tools', 'ltcm-extractor', 'src', 'profile-validator.ts'),
    monthlyContract: read('tools', 'ltcm-normalizer', 'src', 'monthly-baseline.ts'),
    certifiedSource: read('tools', 'ltcm-extractor', 'src', 'p013-monthly-source.ts'),
    monthlyPlan: read('tools', 'ltcm-normalizer', 'src', 'monthly-baseline-plan.ts'),
    extractorPackage: read('tools', 'ltcm-extractor', 'package.json'),
    extractorTypesTargetExists: true,
  };
}

test('rejeita perda da autoridade opaca, do fail-closed SQL e introdução de writer D03', () => {
  const input = sources();
  input.certifiedSource = input.certifiedSource.replace(
    'certifiedSources = new WeakMap',
    'certifiedSources = new Map',
  );
  input.monthlyPlan = input.monthlyPlan
    .replace('snapshotStatementEvidence = new WeakMap', 'REMOVED')
    .concat('\nexport async function applyMonthlyPlan() {}\n');
  const issues = scanP013D02(input);
  assert.ok(issues.some((issue) => issue.includes('certifiedSources = new WeakMap')));
  assert.ok(issues.some((issue) => issue.includes('snapshotStatementEvidence = new WeakMap')));
  assert.ok(issues.some((issue) => issue.includes('apply/writer')));
});

test('aceita a fundação P013 D02 versionada', () => {
  assert.deepEqual(checkP013D02(repositoryRoot), []);
});

test('rejeita perda de FK de proveniência, FORCE RLS e zero explícito', () => {
  const input = sources();
  input.migration = input.migration
    .replace('fk_monthly_plan_cells_staging_row_p013', 'fk_removed')
    .replace('alter table ltc_m.monthly_plan_cells force row level security;', '-- removido')
    .replace('source_numeric_text::numeric = 0', 'source_numeric_text is not null');
  const issues = scanP013D02(input);

  assert.ok(issues.some((issue) => issue.includes('staging_row')));
  assert.ok(issues.some((issue) => issue.includes('FORCE RLS')));
  assert.ok(issues.some((issue) => issue.includes('numeric\\s*=\\s*0')));
});

test('rejeita fingerprint removido e regressão para contagem de fórmulas', () => {
  const input = sources();
  input.sourceGate = input.sourceGate.replace(
    'a02215599f1a4762e8dcfc747c13537bce76b3c3909f43fb92efe54e8ab3ffa0',
    '0'.repeat(64),
  );
  input.profileValidator = input.profileValidator.replace(
    'monthly_revenue: null',
    'monthly_revenue: 24',
  );
  const issues = scanP013D02(input);

  assert.ok(issues.some((issue) => issue.includes('fingerprint semântico')));
  assert.ok(issues.some((issue) => issue.includes('24 fórmulas')));
});
