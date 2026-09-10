import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { deriveP034DuplicateFindings } from '../src/quality/p015-duplicate-adapter.js';
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
  provenance_payload: null,
  total_items: '1',
};

const sourceReference = {
  kind: 'source' as const,
  locator: 'Valores Projetos LTC-M!C4',
  fingerprint: 'a'.repeat(64),
};

test('P034 valida allowlists, defaults e paginacao sem aceitar parametros desconhecidos', () => {
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
  assert.throws(() => parseQualityQuery({ rule: 'IMPORT_DUPLICATION' }), BadRequestException);
  assert.throws(() => parseQualityQuery({ rule: 'ACTUAL_STATUS_UNRESOLVED' }), BadRequestException);
  assert.throws(() => parseQualityQuery({ severity: 'CRITICAL' }), BadRequestException);
  assert.throws(() => parseQualityQuery({ pageSize: '101' }), BadRequestException);
});

test('P034 restringe moeda relevante ao universo billing_actual posted', () => {
  assert.equal(isMaterialBillingActual({ metricType: 'billing_actual', status: 'posted' }), true);
  assert.equal(isMaterialBillingActual({ metricType: 'billing_actual', status: 'draft' }), false);
  assert.equal(isMaterialBillingActual({ metricType: 'receipt_actual', status: 'posted' }), false);
});

test('adapter P034 preserva a identidade deterministica das duplicidades P015', () => {
  const findings = deriveP034DuplicateFindings({
    project_observations: [
      {
        project_code: 'P034-001',
        project_id: findingRow.project_id,
        source_references: [sourceReference],
      },
      {
        project_code: 'P034-001',
        project_id: findingRow.project_id,
        source_references: [
          { ...sourceReference, locator: 'Valores Projetos LTC-M!C5', fingerprint: 'b'.repeat(64) },
        ],
      },
    ],
    item_observations: [],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.finding_code, 'DUPLICATE_PROJECT_SOURCE_IDENTITY');
  assert.equal(
    findings[0]?.finding_id,
    'p015-finding-v1:c923da1db536f48810b8e2ce7fcbac6e17b701772917330cbdaa8083a8eb2be1',
  );
  assert.deepEqual(
    findings[0]?.source_references.map(({ locator }) => locator),
    ['Valores Projetos LTC-M!C4', 'Valores Projetos LTC-M!C5'],
  );
});

test('adapter P034 agrupa item por project_code e source_line_key', () => {
  const lineKey = `p012-line-v1:${'d'.repeat(64)}`;
  const findings = deriveP034DuplicateFindings({
    project_observations: [
      {
        project_code: 'P034-001',
        project_id: findingRow.project_id,
        source_references: [sourceReference],
      },
    ],
    item_observations: [
      {
        project_code: 'P034-001',
        source_line_key: lineKey,
        item_id: null,
        source_references: [sourceReference],
      },
      {
        project_code: 'P034-001',
        source_line_key: lineKey,
        item_id: null,
        source_references: [
          { ...sourceReference, locator: 'Itens!A5', fingerprint: 'b'.repeat(64) },
        ],
      },
    ],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.finding_code, 'DUPLICATE_ITEM_SOURCE_IDENTITY');
  assert.equal(
    findings[0]?.finding_id,
    'p015-finding-v1:fac23283cc07c946b9bcf16d157f9b8c60c3584d679b3a4e0801f829bb7d5e75',
  );
});

test('P034 compoe resposta no contexto do ator e seleciona provenance latest', async () => {
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
          if (text.includes('snapshot_count')) return { rows: [{ snapshot_count: '1' } as Row] };
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
      page: 1,
      pageSize: 25,
    },
    actor,
  );

  assert.equal(response.contract, 'ltcm.p034.data-quality-center.v3');
  assert.equal(response.items[0]?.id, findingRow.id);
  assert.equal(response.items[0]?.rule.code, 'PROJECT_VALUE_MISMATCH');
  assert.equal(response.totalItems, 1);
  assert.equal(response.totalPages, 1);
  assert.match(sql, /v_tableau_data_quality/u);
  assert.match(sql, /finding_code = 'PROJECT_VALUE_MISMATCH'/u);
  assert.doesNotMatch(sql, /ACTUAL_STATUS_UNRESOLVED|IMPORT_DUPLICATION/u);
  assert.match(sql, /distinct on \(snapshots\.project_id\)/u);
  assert.match(sql, /authority_revision desc/u);
  assert.match(sql, /p034_provenance_project_observations/u);
  assert.match(sql, /p034_provenance_item_observations/u);
  assert.match(
    sql,
    /actual_currency_issues[\s\S]*events\.metric_type = 'billing_actual'[\s\S]*events\.status = 'posted'/u,
  );
  assert.match(sql, /rule_label ilike \$4/u);
  assert.doesNotMatch(sql, /limit \$/u);
  assert.deepEqual(values, [null, '2026-09-09T12:00:00.000Z', 'ERROR', '%50\\%\\_\\\\%']);
  assert.doesNotMatch(sql, /insert\s+into|update\s+|delete\s+from|drop\s+/iu);
});

test('P034 falha fechado quando nao ha snapshot autoritativo', async () => {
  const database = {
    actorTransaction: async <T>(
      _actor: typeof actor,
      operation: (client: {
        query: () => Promise<{ rows: [{ snapshot_count: string }] }>;
      }) => Promise<T>,
    ) => operation({ query: async () => ({ rows: [{ snapshot_count: '0' }] }) }),
  };
  await assert.rejects(
    () => new QualityService(database as never).list(parseQualityQuery({}), actor),
    /P034_PROVENANCE_SNAPSHOT_UNAVAILABLE/u,
  );
});

test('P034 normaliza findings do adapter sem expor o payload de provenance', async () => {
  const database = {
    actorTransaction: async <T>(
      _actor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<T>,
    ) =>
      operation({
        query: async <Row>(text: string) => {
          if (text.includes('snapshot_count')) return { rows: [{ snapshot_count: '1' } as Row] };
          return {
            rows: [
              {
                ...findingRow,
                id: 'temporary-p034-id',
                rule_code: 'DUPLICATE_PROJECT_SOURCE_IDENTITY',
                expected_value: null,
                observed_value: null,
                delta: null,
                currency_code: null,
                source_reference: null,
                database_reference: null,
                provenance_payload: {
                  project_observations: [
                    {
                      project_code: findingRow.project_code,
                      project_id: findingRow.project_id,
                      source_references: [sourceReference],
                    },
                    {
                      project_code: findingRow.project_code,
                      project_id: findingRow.project_id,
                      source_references: [
                        {
                          ...sourceReference,
                          locator: 'Valores Projetos LTC-M!C5',
                          fingerprint: 'b'.repeat(64),
                        },
                      ],
                    },
                  ],
                  item_observations: [],
                },
              } as Row,
            ],
          };
        },
      }),
  };
  const response = await new QualityService(database as never).list(parseQualityQuery({}), actor);
  assert.equal(
    response.items[0]?.id,
    'p015-finding-v1:c923da1db536f48810b8e2ce7fcbac6e17b701772917330cbdaa8083a8eb2be1',
  );
  assert.equal(response.items[0]?.origin.sourceReferences?.[0]?.fingerprint, 'a'.repeat(64));
  assert.equal('provenance_payload' in (response.items[0] ?? {}), false);
});

test('P034 propaga falha tecnica da fonte e nao responde como lista vazia', async () => {
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
    () => new QualityService(database as never).list(parseQualityQuery({}), actor),
    /source unavailable/u,
  );
});
