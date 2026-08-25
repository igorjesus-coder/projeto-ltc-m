import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import type { P014CertifiedRealizedSource, P014RealizedSourcePosition } from '@ltcm/extractor/p014';

import { parseP014RealizedArguments } from '../src/p014-realized-cli.js';
import {
  createP014RealizedImportDryRun,
  deriveP014RealizedImportPreviewForTest,
} from '../src/p014-realized-import.js';

const PROJECTS = [
  ['2024-02-10990', '2260099.66', 'C'],
  ['2024-06-11837', '232825.00', 'D'],
  ['2024-10-12524', '205446.00', 'E'],
  ['2025-07-14416', '0.00', 'F'],
  ['2026-01-15797', '0.00', 'G'],
  ['2025-12-15568', '0.00', 'H'],
  ['2025-08-14656', '0.00', 'I'],
  ['2026-03-16231', '0.00', 'J'],
  ['2026-04-16531', '0.00', 'K'],
] as const;
const MONTHS = [
  '2026-07-01',
  '2026-08-01',
  '2026-09-01',
  '2026-10-01',
  '2026-11-01',
  '2026-12-01',
  '2027-01-01',
  '2027-02-01',
  '2027-03-01',
] as const;

function source(): P014CertifiedRealizedSource {
  return {
    contract: 'ltcm.p014.certified-realized-source.v1',
    source_name: 'source.xlsx',
    source_sha256: 'a'.repeat(64),
    source_size_bytes: 33873,
    source_semantic_fingerprint: 'b'.repeat(64),
    worksheet_names: [
      'Valores Projetos LTC-M',
      'Prev. Receita Mensal',
      'Curva S',
      'Decisões Aprovadas',
    ],
    position_count: 18,
    fact_count: 10,
    blank_count: 8,
    explicit_zero_count: 6,
    non_zero_count: 4,
    project_aggregate_total: '2698370.66',
    portfolio_month_total: '551516.66',
  };
}

function projectPosition(
  projectCode: string,
  canonicalAmount: string,
  column: string,
): P014RealizedSourcePosition {
  const formula = column === 'C';
  return {
    authoritative_grain: 'project_aggregate',
    metric_type: 'billing_actual',
    project_code: projectCode,
    competence_month: null,
    item_identity: null,
    currency_code: 'BRL',
    declaration_state: canonicalAmount === '0.00' ? 'explicit_zero' : 'value',
    source_status: 'source_declared_faturado_data_updating',
    worksheet_key: 'project_values',
    worksheet_name: 'Valores Projetos LTC-M',
    source_row_number: 4,
    source_column: column,
    source_cell_reference: `${column}4`,
    source_row_hash: 'c'.repeat(64),
    source_numeric_text: canonicalAmount,
    canonical_amount: canonicalAmount,
    source_state: formula ? 'formula' : 'value',
    formula_text: formula ? 'C3' : null,
    formula_present: formula,
    cached_result_present: formula,
    source_value_hash: 'd'.repeat(64),
    source_position_fingerprint: `${column.toLowerCase()}`.repeat(64).slice(0, 64),
  };
}

function portfolioPosition(competenceMonth: string, index: number): P014RealizedSourcePosition {
  const material = index === 0;
  const column = String.fromCharCode(67 + index);
  return {
    authoritative_grain: 'portfolio_month',
    metric_type: 'billing_actual',
    project_code: null,
    competence_month: competenceMonth,
    item_identity: null,
    currency_code: 'BRL',
    declaration_state: material ? 'value' : 'blank',
    source_status: 'source_declared_manual_realized_monthly',
    worksheet_key: 'curve_s',
    worksheet_name: 'Curva S',
    source_row_number: 12,
    source_column: column,
    source_cell_reference: `${column}12`,
    source_row_hash: 'e'.repeat(64),
    source_numeric_text: material ? '551516.65500000003' : null,
    canonical_amount: material ? '551516.66' : null,
    source_state: material ? 'value' : 'blank',
    formula_text: null,
    formula_present: false,
    cached_result_present: false,
    source_value_hash: material ? 'f'.repeat(64) : null,
    source_position_fingerprint: `${index}`.repeat(64).slice(0, 64),
  };
}

function positions(): P014RealizedSourcePosition[] {
  return [
    ...PROJECTS.map(([projectCode, amount, column]) =>
      projectPosition(projectCode, amount, column),
    ),
    ...MONTHS.map((month, index) => portfolioPosition(month, index)),
  ];
}

test('dry-run P014 produz impossibilidade controlada determinística e zero writes', () => {
  const first = deriveP014RealizedImportPreviewForTest({
    source: source(),
    positions: positions(),
  });
  const second = deriveP014RealizedImportPreviewForTest({
    source: source(),
    positions: positions(),
  });
  assert.deepEqual(second, first);
  assert.equal(first.status, 'controlled_impossibility');
  assert.deepEqual(first.classification, [
    'PROJECT_AGGREGATE_REALIZED',
    'OTHER_EVIDENCE_BASED_GRAIN:PORTFOLIO_MONTH_REALIZED',
    'INSUFFICIENT_FOR_MIGRATION',
  ]);
  assert.equal(first.schema_classification, 'SCHEMA_INCOMPATIBLE');
  assert.equal(first.summary.migratable_count, 0);
  assert.equal(first.summary.non_migratable_count, 10);
  assert.equal(first.summary.project_aggregate_total, '2698370.66');
  assert.equal(first.summary.portfolio_month_total, '551516.66');
  assert.equal(first.dry_run.database_access, 'none');
  assert.equal(first.dry_run.write_statement_count, 0);
  assert.equal(first.dry_run.expected_write_count, 0);
  assert.equal(first.arbitrary_allocation_performed, false);
  assert.equal(first.planned_values_used_to_manufacture_realized, false);
  assert.equal(first.persistence_implemented, false);
  assert.equal(new Set(first.facts.map(({ source_key }) => source_key)).size, 10);
  assert.ok(
    first.facts
      .filter(({ authoritative_grain }) => authoritative_grain === 'project_aggregate')
      .every(
        ({ competence_resolution, item_identity, target_actual_status }) =>
          competence_resolution.status === 'missing_at_source_grain' &&
          item_identity === null &&
          target_actual_status === null,
      ),
  );
  assert.ok(
    first.facts
      .filter(({ authoritative_grain }) => authoritative_grain === 'portfolio_month')
      .every(
        ({ project_resolution, competence_resolution }) =>
          project_resolution.status === 'unavailable_at_source_grain' &&
          competence_resolution.status === 'authoritative',
      ),
  );
});

test('source_key independe de SHA/execução e divergência material preserva a identidade', () => {
  const first = deriveP014RealizedImportPreviewForTest({
    source: source(),
    positions: positions(),
  });
  const rehashedSource = { ...source(), source_sha256: '9'.repeat(64) };
  const rehashed = deriveP014RealizedImportPreviewForTest({
    source: rehashedSource,
    positions: positions(),
  });
  assert.deepEqual(
    rehashed.facts.map(({ source_key }) => source_key),
    first.facts.map(({ source_key }) => source_key),
  );
  assert.notEqual(rehashed.report_fingerprint, first.report_fingerprint);

  const divergentPositions = positions();
  const changed = divergentPositions.find(
    ({ authoritative_grain, project_code }) =>
      authoritative_grain === 'project_aggregate' && project_code === '2024-10-12524',
  );
  assert.ok(changed);
  changed.source_numeric_text = '205447.00';
  changed.canonical_amount = '205447.00';
  const divergent = deriveP014RealizedImportPreviewForTest({
    source: { ...source(), project_aggregate_total: '2698371.66' },
    positions: divergentPositions,
  });
  const originalFact = first.facts.find(({ project_code }) => project_code === '2024-10-12524');
  const divergentFact = divergent.facts.find(
    ({ project_code }) => project_code === '2024-10-12524',
  );
  assert.equal(divergentFact?.source_key, originalFact?.source_key);
  assert.notEqual(divergentFact?.fact_fingerprint, originalFact?.fact_fingerprint);
});

test('boundary P014 rejeita item/competência fabricados e mutação blank-zero', () => {
  const fabricatedCompetence = positions();
  fabricatedCompetence[0]!.competence_month = '2026-07-01';
  assert.throws(
    () =>
      deriveP014RealizedImportPreviewForTest({
        source: source(),
        positions: fabricatedCompetence,
      }),
    /P014_REPORT_SOURCE_FACTS_INVALID/u,
  );

  const fabricatedItem = positions();
  (fabricatedItem[0] as unknown as { item_identity: string | null }).item_identity = 'invented';
  assert.throws(
    () => deriveP014RealizedImportPreviewForTest({ source: source(), positions: fabricatedItem }),
    /P014_REPORT_SOURCE_FACTS_INVALID/u,
  );

  const blankToZero = positions();
  const blank = blankToZero.find(({ declaration_state }) => declaration_state === 'blank');
  assert.ok(blank);
  blank.declaration_state = 'explicit_zero';
  blank.source_numeric_text = '0';
  blank.canonical_amount = '0.00';
  blank.source_state = 'value';
  assert.throws(
    () => deriveP014RealizedImportPreviewForTest({ source: source(), positions: blankToZero }),
    /P014_REPORT_SOURCE_FACTS_INVALID/u,
  );
});

test('objeto reconstruído não adquire authority e CLI falha sem vazar argumentos', () => {
  assert.throws(() => createP014RealizedImportDryRun(source()), /P014_SOURCE_AUTHORITY_REQUIRED/u);
  assert.equal(parseP014RealizedArguments(['--help']), 'help');
  assert.equal(parseP014RealizedArguments(['--input=source.xlsx']), path.resolve('source.xlsx'));
  assert.throws(() => parseP014RealizedArguments([]), /P014_CLI_INPUT_REQUIRED/u);
  assert.throws(
    () => parseP014RealizedArguments(['--password=secret-value']),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'P014_CLI_UNKNOWN_ARGUMENT' &&
      !error.message.includes('secret-value'),
  );
});
