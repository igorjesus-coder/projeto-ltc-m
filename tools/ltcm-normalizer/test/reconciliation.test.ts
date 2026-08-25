import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P015_FINDING_CODES,
  P015_RECONCILIATION_CONTRACT,
  P015_RECONCILIATION_REPORT_CONTRACT,
  assertP015ReconciliationReport,
  createP015ReconciliationInput,
  generateP015ReconciliationReport,
  renderP015HumanSummary,
  type P015ReconciliationPayload,
} from '../src/reconciliation.js';

const hash = (character: string): string => character.repeat(64);
const line = (character: string): string => `p012-line-v1:${hash(character)}`;
const source = (locator: string, character = 'a') => ({
  kind: 'source' as const,
  locator,
  fingerprint: hash(character),
});
const database = (locator: string, character = 'b') => ({
  kind: 'database' as const,
  locator,
  fingerprint: hash(character),
});

function basePayload(): P015ReconciliationPayload {
  return {
    source_snapshot_fingerprint: hash('1'),
    database_snapshot_fingerprint: hash('2'),
    projects: [
      {
        project_code: 'PROJECT-A',
        project_id: 'project-a-id',
        project_name: 'Project A',
        client_id: 'client-a-id',
        currency_code: 'BRL',
        contract_value: '100.00',
        database_contract_value: '100.00',
        source_references: [source('Valores Projetos LTC-M!C4')],
        database_references: [database('ltc_m.projects:project-a-id')],
      },
      {
        project_code: 'PROJECT-B',
        project_id: 'project-b-id',
        project_name: 'Project B',
        client_id: 'client-b-id',
        currency_code: 'BRL',
        contract_value: '50.00',
        database_contract_value: '50.00',
        source_references: [source('Valores Projetos LTC-M!D4', 'c')],
        database_references: [database('ltc_m.projects:project-b-id', 'd')],
      },
    ],
    items: [
      {
        project_code: 'PROJECT-A',
        item_id: 'item-a-id',
        source_line_key: line('a'),
        item_code: 'ITEM',
        description: 'Item A',
        quantity: '1.000000',
        unit_code: 'UN',
        currency_code: 'BRL',
        total_amount: '100.00',
        database_total_amount: '100.00',
        source_references: [source('Prev. Receita Mensal!A4:J4', 'e')],
        database_references: [database('ltc_m.project_items:item-a-id', 'f')],
      },
      {
        project_code: 'PROJECT-B',
        item_id: 'item-b-id',
        source_line_key: line('b'),
        item_code: null,
        description: 'Item B',
        quantity: '1.000000',
        unit_code: 'SERV',
        currency_code: 'BRL',
        total_amount: '50.00',
        database_total_amount: '50.00',
        source_references: [source('Prev. Receita Mensal!A5:J5', '3')],
        database_references: [database('ltc_m.project_items:item-b-id', '4')],
      },
    ],
    monthly_plan: [
      {
        project_code: 'PROJECT-A',
        source_line_key: line('a'),
        competence_month: '2026-01-01',
        metric: 'billing_planned',
        currency_code: 'BRL',
        source_amount: '100.00',
        database_amount: '100.00',
        source_references: [source('Prev. Receita Mensal!K4', '5')],
        database_references: [database('ltc_m.financial_plan_lines:line-a', '6')],
      },
    ],
    actual_evidence: [],
    costs: [],
    decisions: [],
    unsupported_comparisons: [],
    import_identities: ['p009-batch-a'],
  };
}

test('contratos P015 produzem relatório vazio de divergências, read-only e determinístico', () => {
  const payload = basePayload();
  const first = generateP015ReconciliationReport(createP015ReconciliationInput(payload));
  const reordered = {
    ...payload,
    projects: [...payload.projects].reverse(),
    items: [...payload.items].reverse(),
    monthly_plan: [...payload.monthly_plan].reverse(),
  };
  const second = generateP015ReconciliationReport(createP015ReconciliationInput(reordered));
  assert.equal(P015_RECONCILIATION_CONTRACT, 'ltcm.p015.reconciliation.v1');
  assert.equal(P015_RECONCILIATION_REPORT_CONTRACT, 'ltcm.p015.reconciliation-report.v1');
  assert.equal(P015_FINDING_CODES.length, 17);
  assert.equal(first.report_fingerprint, second.report_fingerprint);
  assert.equal(
    first.report_fingerprint,
    '70fbd6103505e62ce7339b84153fb0c34eff44de60aab117209d76f54ff7f03c',
  );
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.project_summaries.map(({ status }) => status),
    ['PASS', 'PASS'],
  );
  assert.deepEqual(first.execution, {
    database_access: 'none',
    transaction_read_only: true,
    select_statement_count: 0,
    insert_count: 0,
    update_count: 0,
    delete_count: 0,
    ddl_count: 0,
  });
  assert.equal(first.arbitrary_allocation_performed, false);
  assert.equal(first.actual_events_manufactured, false);
  assertP015ReconciliationReport(first);
});

test('classifica deltas exatos de projeto, item e baseline sem Number financeiro', () => {
  const payload = basePayload();
  payload.projects[0]!.database_contract_value = '99.99';
  payload.items[0]!.total_amount = '90.00';
  payload.items[0]!.database_total_amount = '80.00';
  payload.monthly_plan.push({
    ...payload.monthly_plan[0]!,
    competence_month: '2026-02-01',
    source_amount: '0.01',
    database_amount: '0.02',
    source_references: [source('Prev. Receita Mensal!L4', '7')],
    database_references: [database('ltc_m.financial_plan_lines:line-b', '8')],
  });
  const report = generateP015ReconciliationReport(createP015ReconciliationInput(payload));
  const codes = report.findings.map(({ finding_code }) => finding_code);
  assert.ok(codes.includes('PROJECT_VALUE_MISMATCH'));
  assert.ok(codes.includes('MONTHLY_BASELINE_TOTAL_MISMATCH'));
  assert.ok(codes.includes('SOURCE_DB_DIVERGENCE'));
  assert.ok(report.findings.some(({ delta }) => delta === '-10.00'));
  assert.ok(report.findings.some(({ delta }) => delta === '0.01'));
  assert.equal(report.project_summaries[0]!.status, 'ERROR');
});

test('P014 permanece impossível: dez evidências geram dez findings e zero actual events', () => {
  const payload = basePayload();
  payload.actual_evidence = Array.from({ length: 9 }, (_, index) => ({
    source_key: `p014-project-${index}`,
    grain: 'project_aggregate' as const,
    project_code: index === 0 ? 'PROJECT-A' : 'PROJECT-B',
    competence_month: null,
    metric: 'billing_actual' as const,
    currency_code: 'BRL',
    amount: index === 0 ? '10.00' : '0.00',
    source_references: [source(`Valores Projetos LTC-M!${String.fromCharCode(67 + index)}4`, '9')],
  }));
  payload.actual_evidence.push({
    source_key: 'p014-portfolio-month',
    grain: 'portfolio_month',
    project_code: null,
    competence_month: '2026-01-01',
    metric: 'billing_actual',
    currency_code: 'BRL',
    amount: '551516.66',
    source_references: [source('Curva S!C12', '0')],
  });
  const report = generateP015ReconciliationReport(createP015ReconciliationInput(payload));
  assert.equal(report.portfolio_summary.p014_missing_grain_count, 10);
  assert.equal(report.non_migratable_evidence.length, 10);
  assert.equal(report.arbitrary_allocation_performed, false);
  assert.equal(report.actual_events_manufactured, false);
  assert.equal(report.execution.insert_count, 0);
  assert.equal(
    report.findings.filter(
      ({ finding_code }) => finding_code === 'REALIZED_PROJECT_MISSING_COMPETENCE',
    ).length,
    9,
  );
  assert.equal(
    report.findings.filter(({ finding_code }) => finding_code === 'REALIZED_MONTH_MISSING_PROJECT')
      .length,
    1,
  );
});

test('expõe duplicidades, obrigatórios, custos indisponíveis e decisões sem resolvê-los', () => {
  const payload = basePayload();
  payload.projects.push(structuredClone(payload.projects[0]!));
  payload.items.push(structuredClone(payload.items[0]!));
  payload.projects[1]!.project_name = null;
  payload.items[1]!.description = null;
  payload.costs.push({
    project_code: 'PROJECT-A',
    currency_code: 'BRL',
    status: 'unavailable',
    expected_value: null,
    observed_value: null,
    source_references: [source('cost:source-unavailable', 'a')],
    database_references: [],
  });
  payload.decisions.push({
    decision_reference: 'NB-ACTUAL-STATUS',
    project_code: 'PROJECT-A',
    domain: 'business_decision',
    finding_code: 'ACTUAL_STATUS_UNRESOLVED',
    explanation: 'Actual status semantics are not approved.',
    blocking: true,
  });
  payload.unsupported_comparisons.push({
    project_code: 'PROJECT-B',
    domain: 'billing_remaining',
    metric: 'billing_remaining',
    currency_code: 'BRL',
    decision_reference: 'NB-REMAINING-FORMULA',
    explanation: 'Remaining-to-bill formula is not approved.',
    source_references: [],
    database_references: [],
  });
  payload.import_identities.push('p009-batch-a');
  const report = generateP015ReconciliationReport(createP015ReconciliationInput(payload));
  const codes = new Set(report.findings.map(({ finding_code }) => finding_code));
  for (const code of [
    'DUPLICATE_PROJECT_SOURCE_IDENTITY',
    'DUPLICATE_ITEM_SOURCE_IDENTITY',
    'MISSING_REQUIRED_FIELD',
    'COST_RECONCILIATION_UNAVAILABLE',
    'ACTUAL_STATUS_UNRESOLVED',
    'UNSUPPORTED_COMPARISON',
    'IMPORT_DUPLICATION',
  ])
    assert.ok(codes.has(code as never));
  assert.equal(
    report.project_summaries.find(({ project_code }) => project_code === 'PROJECT-A')!.status,
    'BLOCKED_BY_DECISION',
  );
  assert.equal(report.unresolved_decisions.length, 1);
});

test('falha fechado para decimal, competência, métrica, moeda e contaminação entre projetos', () => {
  const invalidDecimal = basePayload();
  invalidDecimal.projects[0]!.contract_value = '1,00';
  assert.throws(
    () => createP015ReconciliationInput(invalidDecimal),
    /P015_RECONCILIATION_INVALID:project.contract/,
  );
  const invalidMonth = basePayload();
  invalidMonth.monthly_plan[0]!.competence_month = '2026-02-28';
  assert.throws(() => createP015ReconciliationInput(invalidMonth), /monthly.grain/);
  const invalidMetric = basePayload() as unknown as { monthly_plan: Array<{ metric: string }> };
  invalidMetric.monthly_plan[0]!.metric = 'billing_actual';
  assert.throws(
    () => createP015ReconciliationInput(invalidMetric as unknown as P015ReconciliationPayload),
    /monthly.grain/,
  );
  const invalidCurrency = basePayload();
  invalidCurrency.items[0]!.currency_code = 'brl';
  assert.throws(() => createP015ReconciliationInput(invalidCurrency), /item.currency/);
  const incompatibleCurrency = basePayload();
  incompatibleCurrency.items[0]!.currency_code = 'USD';
  const mismatch = generateP015ReconciliationReport(
    createP015ReconciliationInput(incompatibleCurrency),
  );
  assert.ok(mismatch.findings.some(({ finding_code }) => finding_code === 'GRAIN_MISMATCH'));
  const crossProject = basePayload();
  crossProject.items[0]!.project_code = 'UNKNOWN';
  assert.throws(() => createP015ReconciliationInput(crossProject), /cross-project-item/);
  const sensitiveLocator = basePayload();
  sensitiveLocator.projects[0]!.source_references[0]!.locator = 'C:\\Users\\example\\secret.xlsx';
  assert.throws(() => createP015ReconciliationInput(sensitiveLocator), /locator-sensitive/);
});

test('clones, spread, relatório forjado e rehash não adquirem autoridade', () => {
  const input = createP015ReconciliationInput(basePayload());
  const report = generateP015ReconciliationReport(input);
  for (const clone of [structuredClone(input), { ...input }])
    assert.throws(() => generateP015ReconciliationReport(clone), /untrusted-input/);
  for (const clone of [structuredClone(report), { ...report }])
    assert.throws(() => assertP015ReconciliationReport(clone), /untrusted-report/);
  const forged = { ...report, report_fingerprint: hash('f') };
  assert.throws(() => assertP015ReconciliationReport(forged), /untrusted-report/);
});

test('estado vazio é reproduzível e resumo humano não vaza caminho ou credencial', () => {
  const payload = basePayload();
  payload.projects = [];
  payload.items = [];
  payload.monthly_plan = [];
  payload.actual_evidence = [];
  payload.costs = [];
  payload.decisions = [];
  payload.unsupported_comparisons = [];
  payload.import_identities = [];
  const report = generateP015ReconciliationReport(createP015ReconciliationInput(payload));
  assert.equal(report.portfolio_summary.project_count, 0);
  assert.equal(report.portfolio_summary.finding_count, 0);
  const summary = renderP015HumanSummary(report);
  assert.match(summary, /Projects: 0; findings: 0/);
  assert.doesNotMatch(summary, /[A-Z]:\\Users\\|postgres(?:ql)?:\/\/|password=/iu);
});
