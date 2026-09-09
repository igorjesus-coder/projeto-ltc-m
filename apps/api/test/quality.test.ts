import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import {
  isMaterialBillingActual,
  QualityService,
  type QualityClock,
} from '../src/quality/quality.service.js';
import { parseQualityQuery } from '../src/quality/quality.types.js';

const actor = Object.freeze({
  appUserId: '00000000-0000-4000-8000-000000034001',
  authSubject: 'auth0|p034-viewer',
  requestId: 'p034-request',
  source: 'api' as const,
});

const findingRow = {
  id: 'p016-finding:1',
  project_id: '00000000-0000-4000-8000-000000034101',
  project_code: 'P034-001',
  project_name: 'Projeto P034',
  rule_code: 'PROJECT_VALUE_MISMATCH',
  severity: 'ERROR',
  expected_value: '100.00',
  observed_value: '90.00',
  delta: '-10.00',
  currency_code: 'BRL',
  finding_origin: 'database_projection',
  origin_entity: 'project',
  origin_entity_id: '00000000-0000-4000-8000-000000034101',
  source_reference: 'ltc_m.projects:1',
  database_reference: 'ltc_m.project_items:project=1',
  evidence: null,
  explanation: null,
  remediation: 'REVIEW_SOURCE_OR_DATABASE',
  total_items: '1',
};

test('P034 valida allowlists, defaults e paginação sem aceitar parâmetros desconhecidos', () => {
  assert.deepEqual(parseQualityQuery({}), {
    sort: 'project',
    order: 'asc',
    page: 1,
    pageSize: 25,
  });
  assert.deepEqual(
    parseQualityQuery({
      projectId: '00000000-0000-4000-8000-000000034101',
      rule: 'UNPLANNED_BALANCE',
      severity: 'WARNING',
      origin: 'project',
      search: '  P034  ',
      sort: 'severity',
      order: 'desc',
      page: '2',
      pageSize: '50',
    }),
    {
      projectId: '00000000-0000-4000-8000-000000034101',
      rule: 'UNPLANNED_BALANCE',
      severity: 'WARNING',
      origin: 'project',
      search: 'P034',
      sort: 'severity',
      order: 'desc',
      page: 2,
      pageSize: 50,
    },
  );
  assert.throws(() => parseQualityQuery({ sql: 'drop table' }), BadRequestException);
  assert.throws(() => parseQualityQuery({ severity: 'CRITICAL' }), BadRequestException);
  assert.throws(() => parseQualityQuery({ pageSize: '101' }), BadRequestException);
});

test('P034 restringe moeda relevante ao universo billing_actual posted', () => {
  assert.equal(isMaterialBillingActual({ metricType: 'billing_actual', status: 'posted' }), true);
  assert.equal(isMaterialBillingActual({ metricType: 'billing_actual', status: 'draft' }), false);
  assert.equal(
    isMaterialBillingActual({ metricType: 'billing_actual', status: 'cancelled' }),
    false,
  );
  assert.equal(isMaterialBillingActual({ metricType: 'receipt_actual', status: 'posted' }), false);
  assert.equal(
    isMaterialBillingActual({ metricType: 'receipt_forecast', status: 'posted' }),
    false,
  );
});

test('P034 compõe resposta no contexto do ator, preserva findings P016 e pagina no SQL', async () => {
  let sql = '';
  let values: readonly unknown[] = [];
  const database = {
    actorTransaction: async <T>(
      receivedActor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<T>,
    ) => {
      assert.deepEqual(receivedActor, actor);
      return operation({
        query: async <Row>(text: string, receivedValues?: readonly unknown[]) => {
          sql = text;
          values = receivedValues ?? [];
          return { rows: [findingRow as Row] };
        },
      });
    },
  };
  const clock: QualityClock = { now: () => new Date('2026-09-09T12:00:00.000Z') };
  const response = await new QualityService(database as never, clock).list(
    {
      search: '50%_\\',
      severity: 'ERROR',
      sort: 'severity',
      order: 'desc',
      page: 2,
      pageSize: 25,
    },
    actor,
  );

  assert.equal(response.contract, 'ltcm.p034.data-quality-center.v1');
  assert.equal(response.items[0]?.id, findingRow.id);
  assert.equal(response.items[0]?.rule.code, 'PROJECT_VALUE_MISMATCH');
  assert.equal(response.items[0]?.severity, 'ERROR');
  assert.equal(response.items[0]?.navigationAction?.target, 'project');
  assert.equal(response.totalItems, 1);
  assert.equal(response.totalPages, 1);
  assert.match(sql, /v_tableau_data_quality/u);
  assert.match(
    sql,
    /finding_code = any\(array\['PROJECT_VALUE_MISMATCH', 'ACTUAL_STATUS_UNRESOLVED'\]/u,
  );
  assert.match(sql, /incomplete_findings/u);
  assert.match(sql, /greatest\(/u);
  assert.match(
    sql,
    /actual_currency_issues[\s\S]*events\.metric_type = 'billing_actual'[\s\S]*events\.status = 'posted'/u,
  );
  assert.match(sql, /rule_label ilike \$3/u);
  assert.match(sql, /limit \$4::integer offset \$5::bigint/u);
  assert.deepEqual(values.slice(1), ['ERROR', '%50\\%\\_\\\\%', 25, 25]);
  assert.doesNotMatch(sql, /insert\s+into|update\s+|delete\s+from|drop\s+/iu);
});

test('P034 propaga falha técnica da fonte e não responde como lista vazia', async () => {
  const database = {
    actorTransaction: async <T>(
      _actor: typeof actor,
      operation: (client: { query: () => Promise<never> }) => Promise<T>,
    ) =>
      operation({
        query: async () => {
          throw new Error('source unavailable');
        },
      }),
  };
  await assert.rejects(
    () =>
      new QualityService(database as never, {
        now: () => new Date('2026-09-09T12:00:00.000Z'),
      }).list(parseQualityQuery({}), actor),
    /source unavailable/u,
  );
});
