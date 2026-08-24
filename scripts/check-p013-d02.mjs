import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { scanMigrationText, stripSqlNoise } from './check-migrations.mjs';

export const P013_MIGRATION = '20260820120000_add_p013_monthly_baseline_foundation.sql';
export const P013_SOURCE_FINGERPRINT =
  'a02215599f1a4762e8dcfc747c13537bce76b3c3909f43fb92efe54e8ab3ffa0';

const TABLES = [
  'monthly_source_artifacts',
  'monthly_plan_baselines',
  'monthly_plan_import_executions',
  'monthly_plan_cells',
];

function count(sql, pattern) {
  return (sql.match(pattern) ?? []).length;
}

export function scanP013D02({
  migration,
  sourceGate,
  profileValidator,
  monthlyContract,
  certifiedSource = '',
  monthlyPlan = '',
  extractorPackage = '',
  extractorTypesTargetExists = false,
}) {
  const issues = scanMigrationText(migration, { migrationName: P013_MIGRATION }).map(
    (issue) => `migration: ${issue}`,
  );
  const sql = stripSqlNoise(migration);

  for (const table of TABLES) {
    const triggerTable = table.replace('monthly_plan_import_executions', 'monthly_executions');
    if (!new RegExp(`\\bcreate\\s+table\\s+ltc_m\\.${table}\\b`, 'iu').test(sql)) {
      issues.push(`tabela P013 ausente: ${table}`);
    }
    if (!new RegExp(`\\balter\\s+table\\s+ltc_m\\.${table}\\s+enable\\s+row`, 'iu').test(sql)) {
      issues.push(`RLS ausente: ${table}`);
    }
    if (!new RegExp(`\\balter\\s+table\\s+ltc_m\\.${table}\\s+force\\s+row`, 'iu').test(sql)) {
      issues.push(`FORCE RLS ausente: ${table}`);
    }
    if (!new RegExp(`trg_00_${triggerTable}_(?:no_delete|append_only)`, 'iu').test(sql)) {
      issues.push(`imutabilidade ausente: ${table}`);
    }
    if (!new RegExp(`trg_90_${triggerTable}_audit`, 'iu').test(sql)) {
      issues.push(`auditoria ausente: ${table}`);
    }
  }

  const requiredMigrationContracts = [
    /uq_monthly_source_artifacts_sha_p013/iu,
    /uq_monthly_plan_baselines_business_p013/iu,
    /fk_monthly_executions_batch_hash_p013/iu,
    /fk_monthly_executions_artifact_p013/iu,
    /fk_monthly_executions_baseline_p013/iu,
    /fk_monthly_plan_cells_execution_p013/iu,
    /fk_monthly_plan_cells_sheet_p013/iu,
    /fk_monthly_plan_cells_staging_row_p013/iu,
    /fk_monthly_plan_cells_project_item_p013/iu,
    /fk_monthly_plan_cells_plan_line_p013/iu,
    /declaration_state\s+in\s*\(\s*'blank'\s*,\s*'explicit_zero'\s*,\s*'value'/iu,
    /canonical_amount\s+numeric\s*\(\s*20\s*,\s*2\s*\)/iu,
    /source_numeric_text::numeric\s*=\s*0/iu,
    /source_numeric_text::numeric\s*>\s*0/iu,
    /metric_type\s*=\s*'billing_planned'/iu,
    /planning_level\s*=\s*'item'/iu,
    /plan_versions\.status\s*=\s*'draft'/iu,
    /plan_versions\.is_baseline/iu,
  ];
  for (const pattern of requiredMigrationContracts) {
    if (!pattern.test(migration)) issues.push(`contrato SQL P013 ausente: ${pattern.source}`);
  }
  if (count(sql, /\bcreate\s+table\b/giu) !== 4) {
    issues.push('P013 deve criar exatamente quatro tabelas');
  }
  if (/\b(?:create|alter|drop)\s+(?:view|type|role|extension)\b/iu.test(sql)) {
    issues.push('objeto fora da fundação P013');
  }

  if (!sourceGate.includes(P013_SOURCE_FINGERPRINT)) {
    issues.push('fingerprint semântico D01A ausente do source gate');
  }
  for (const token of [
    'P013_MONTHLY_SOURCE_SEMANTIC_CONTRACT',
    'P013_SOURCE_EXTRA_MATERIAL_CELL',
    'P013_SOURCE_COMPETENCIES',
    'P013_SOURCE_ITEM_IDENTITY',
    'P013_SOURCE_INVALID_MONTHLY_VALUE',
    'P013_SOURCE_SEMANTIC_FINGERPRINT_MISMATCH',
  ]) {
    if (!sourceGate.includes(token)) issues.push(`proteção do source gate ausente: ${token}`);
  }
  if (!/monthly_revenue:\s*null/u.test(profileValidator)) {
    issues.push('suposição frágil de 24 fórmulas mensais não foi removida');
  }
  if (!profileValidator.includes('MONTHLY_SOURCE_SEMANTICS')) {
    issues.push('source gate P013 não foi integrado ao profile validator');
  }
  for (const token of [
    'P013_MONTHLY_BASELINE_SEMANTIC_CONTRACT',
    'createP013MonthlyBaselineSemanticIdentity',
    'createP013MonthlyBaselineIdempotencyKey',
    'explicit_zero',
    'MAX_INTEGER_DIGITS = 18',
  ]) {
    if (!monthlyContract.includes(token)) issues.push(`contrato TypeScript ausente: ${token}`);
  }

  for (const token of [
    'P013_CERTIFIED_MONTHLY_SOURCE_CONTRACT',
    'loadP013CertifiedMonthlySource',
    'readP013CertifiedMonthlySourceFacts',
    'certifiedSources = new WeakMap',
    'P013_SOURCE_CHANGED_DURING_READ',
  ]) {
    if (!certifiedSource.includes(token)) issues.push(`autoridade da fonte D03 ausente: ${token}`);
  }
  for (const token of [
    'P013_MONTHLY_PLAN_CONTRACT',
    'P013_MONTHLY_SNAPSHOT_CONTRACT',
    'runP013MonthlyBaselineDryRun',
    'certifiedSnapshots = new WeakMap',
    'certifiedPlans = new WeakMap',
    'snapshotBindings = new WeakMap',
    'createP013LocalPostgresDryRunAdapter',
    'begin transaction isolation level repeatable read read only',
    'transaction_read_only',
    'snapshotStatementEvidence = new WeakMap',
    "status: 'pending_decision'",
  ]) {
    if (!monthlyPlan.includes(token))
      issues.push(`contrato de plano/dry-run D03 ausente: ${token}`);
  }
  if (
    /`\s*(?:insert|update|delete|merge|create|alter|drop|truncate|grant|revoke)\b/iu.test(
      monthlyPlan,
    )
  ) {
    issues.push('D03 contém SQL mutável no módulo de plano/dry-run');
  }
  if (/export\s+(?:async\s+)?function\s+\w*(?:apply|write|persist)/iu.test(monthlyPlan)) {
    issues.push('D03 expõe caminho de apply/writer/persistência');
  }

  try {
    const manifest = JSON.parse(extractorPackage);
    const p013Export = manifest?.exports?.['./p013'];
    if (p013Export?.types !== './types/p013.d.ts') {
      issues.push('export de tipos P013 deve apontar para contrato TypeScript versionado');
    }
    if (p013Export?.default !== './dist/src/p013-monthly-source.js') {
      issues.push('export runtime P013 deve permanecer no JavaScript compilado');
    }
  } catch {
    issues.push('package manifest do extractor inválido');
  }
  if (!extractorTypesTargetExists) {
    issues.push('target versionado do export de tipos P013 ausente');
  }

  return [...new Set(issues)];
}

export function checkP013D02(repositoryRoot) {
  const read = (...segments) => fs.readFileSync(path.join(repositoryRoot, ...segments), 'utf8');
  return scanP013D02({
    migration: read('supabase', 'migrations', P013_MIGRATION),
    sourceGate: read('tools', 'ltcm-extractor', 'src', 'p013-source-gate.ts'),
    profileValidator: read('tools', 'ltcm-extractor', 'src', 'profile-validator.ts'),
    monthlyContract: read('tools', 'ltcm-normalizer', 'src', 'monthly-baseline.ts'),
    certifiedSource: read('tools', 'ltcm-extractor', 'src', 'p013-monthly-source.ts'),
    monthlyPlan: read('tools', 'ltcm-normalizer', 'src', 'monthly-baseline-plan.ts'),
    extractorPackage: read('tools', 'ltcm-extractor', 'package.json'),
    extractorTypesTargetExists: fs.existsSync(
      path.join(repositoryRoot, 'tools', 'ltcm-extractor', 'types', 'p013.d.ts'),
    ),
  });
}

function main() {
  const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const issues = checkP013D02(repositoryRoot);
  if (issues.length > 0) {
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log('P013 D02 válido: proveniência, idempotência, RLS e source gate semântico presentes');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
