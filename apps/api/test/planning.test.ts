import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PlanningService } from '../src/planning/planning.service.js';
import {
  parsePlanningBatchPayload,
  parsePlanningMonthQuery,
  parsePlanningWorkflowPayload,
  P029_MAX_BATCH_ENTRIES,
} from '../src/planning/planning.types.js';

const projectId = '00000000-0000-4000-8000-000000029001';
const versionId = '00000000-0000-4000-8000-000000029002';
const itemA = '00000000-0000-4000-8000-000000029003';
const itemB = '00000000-0000-4000-8000-000000029004';
const actor = {
  appUserId: '00000000-0000-4000-8000-000000029005',
  authSubject: 'auth0|p029',
  requestId: 'p029-test',
  source: 'api' as const,
};

const validPayload = {
  expectedVersion: 4,
  justification: 'Reprogramação mensal',
  entries: [
    { itemId: itemA, competence: '2026-12-01', amount: '0.1' },
    { itemId: itemA, competence: '2027-01-01', amount: '12.30' },
    { itemId: itemB, competence: '2026-12-01', amount: '7' },
  ],
};

test('P029 parser normaliza payload decimal e preserva meses sem timezone', () => {
  assert.deepEqual(parsePlanningBatchPayload(validPayload), {
    expectedVersion: 4,
    justification: 'Reprogramação mensal',
    entries: [
      { itemId: itemA, competence: '2026-12-01', amount: '0.10' },
      { itemId: itemA, competence: '2027-01-01', amount: '12.30' },
      { itemId: itemB, competence: '2026-12-01', amount: '7.00' },
    ],
  });
  assert.deepEqual(
    parsePlanningMonthQuery(versionId, { versionId, from: '2026-12-01', to: '2027-01-01' }),
    {
      versionId,
      from: '2026-12-01',
      to: '2027-01-01',
    },
  );
});

test('P029 parser rejeita duplicata, competência deslocada e valor fora da escala', () => {
  assert.throws(
    () =>
      parsePlanningBatchPayload({
        ...validPayload,
        entries: [...validPayload.entries, validPayload.entries[0]],
      }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('P029_DUPLICATE_ENTRY'),
  );
  assert.throws(
    () => parsePlanningMonthQuery(versionId, { from: '2026-12-02' }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('P029_INVALID_RANGE'),
  );
  assert.throws(
    () =>
      parsePlanningBatchPayload({
        ...validPayload,
        entries: [{ ...validPayload.entries[0], amount: '0.001' }],
      }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('P029_INVALID_AMOUNT'),
  );
});

test('P029 parser limita batch técnico sem impor horizonte financeiro', () => {
  assert.throws(
    () =>
      parsePlanningBatchPayload({
        expectedVersion: 1,
        entries: Array.from({ length: P029_MAX_BATCH_ENTRIES + 1 }, (_, index) => ({
          itemId: `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, '0')}`,
          competence: '2026-12-01',
          amount: '1.00',
        })),
      }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('P029_BATCH_TOO_LARGE'),
  );
  assert.throws(
    () => parsePlanningMonthQuery(versionId, { from: '2020-01-01', to: '2040-01-01' }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('P029_RANGE_TOO_LARGE'),
  );
});

test('P029 exige justificativa não vazia, limitada e normalizada', () => {
  assert.equal(
    parsePlanningBatchPayload({ ...validPayload, justification: '  Ajuste de forecast  ' })
      .justification,
    'Ajuste de forecast',
  );
  for (const justification of [undefined, null, '', '   ', 'x'.repeat(2_001)]) {
    assert.throws(
      () => parsePlanningBatchPayload({ ...validPayload, justification }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes('P029_JUSTIFICATION_REQUIRED'),
    );
  }
});

test('P031 parser separa row_version de content_revision e exige justificativa terminal', () => {
  assert.deepEqual(parsePlanningWorkflowPayload({ expectedRowVersion: 4 }, 'submit'), {
    expectedRowVersion: 4,
  });
  assert.deepEqual(
    parsePlanningWorkflowPayload(
      { expectedRowVersion: 4, justification: '  Aprovação formal  ' },
      'approve',
    ),
    { expectedRowVersion: 4, justification: 'Aprovação formal' },
  );
  assert.throws(
    () => parsePlanningWorkflowPayload({ expectedRowVersion: 4 }, 'archive'),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('P031_JUSTIFICATION_REQUIRED'),
  );
  assert.throws(
    () => parsePlanningWorkflowPayload({ expectedRowVersion: 0 }, 'submit'),
    (error: unknown) =>
      error instanceof BadRequestException &&
      error.message.includes('P031_EXPECTED_ROW_VERSION_INVALID'),
  );
});

function createDatabase(
  options: {
    readonly inactive?: boolean;
    readonly stale?: boolean;
    readonly contractValue?: string;
    readonly aggregateOverflow?: boolean;
    readonly existingAmount?: string;
    readonly justification?: string;
    readonly workflowStatus?: string;
    readonly workflowRowVersion?: number;
  } = {},
) {
  const calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
  const project = {
    project_id: projectId,
    project_code: 'P029',
    project_name: 'Projeto P029',
    currency_code: 'BRL',
    contract_value: options.contractValue ?? '1000.00',
    project_status: 'active',
    start_date: '2026-12-01',
    end_date: '2027-01-01',
  };
  const plan = {
    version_id: versionId,
    version_name: 'Forecast 2026',
    version_status: options.workflowStatus ?? 'draft',
    row_version: options.workflowRowVersion ?? (options.stale ? 3 : 4),
    content_revision: options.stale ? 3 : 4,
    is_baseline: false,
  };
  const database = {
    actorTransaction: async <Result>(
      receivedActor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<Result>,
    ) => {
      assert.deepEqual(receivedActor, {
        ...actor,
        justification: options.justification ?? 'Reprogramação mensal',
      });
      return operation({
        query: async <Row>(text: string, values: readonly unknown[] = []) => {
          calls.push({ text, values });
          if (text.includes('approve_plan_version')) {
            plan.version_status = 'approved';
            plan.row_version += 1;
            return {
              rows: [
                {
                  plan_version_id: versionId,
                  status: 'approved',
                  row_version: plan.row_version,
                } as Row,
              ],
            };
          }
          if (options.aggregateOverflow && text.includes('financial_actual_events'))
            throw Object.assign(new Error('numeric field overflow'), { code: '22003' });
          if (text.includes('for update')) return { rows: [plan as Row] };
          if (text.includes('join ltc_m.financial_plan_scopes')) return { rows: [plan as Row] };
          if (text.includes('projects.contract_value'))
            return {
              rows: [
                {
                  contract_value: '1000.00',
                  currency_code: 'BRL',
                  actual_posted: '0.00',
                  planned_draft: '19.40',
                  currency_mismatch: false,
                  planned_currency_mismatch: false,
                } as Row,
              ],
            };
          if (text.includes('from ltc_m.projects')) return { rows: [project as Row] };
          if (text.includes('id = any'))
            return {
              rows: [
                { item_id: itemA, active: !options.inactive },
                { item_id: itemB, active: true },
              ] as Row[],
            };
          if (text.startsWith('insert into')) return { rows: [] as Row[] };
          if (text.startsWith('update ltc_m.plan_versions'))
            return { rows: [{ content_revision: 5 } as Row] };
          if (text.includes('from ltc_m.financial_actual_events'))
            return { rows: [{ actual_posted: '0.00' } as Row] };
          if (text.includes('min(competence_month)'))
            return { rows: [{ min_month: '2026-12-01', max_month: '2027-01-01' } as Row] };
          if (text.includes('from ltc_m.project_items'))
            return {
              rows: [
                {
                  item_id: itemA,
                  source_line_key: 'source-a',
                  item_code: 'A',
                  description: 'A',
                  line_number: 1,
                  active: true,
                },
                {
                  item_id: itemB,
                  source_line_key: 'source-b',
                  item_code: 'B',
                  description: 'B',
                  line_number: 2,
                  active: true,
                },
              ] as Row[],
            };
          if (text.includes('sum(amount)'))
            return { rows: [{ competence_month: '2026-12-01', amount: '7.00' }] as Row[] };
          return {
            rows: [
              {
                item_id: itemA,
                competence_month: '2026-12-01',
                amount: options.existingAmount ?? '0.10',
                row_version: 1,
              },
            ] as Row[],
          };
        },
      });
    },
  };
  return { database, calls };
}

test('P029 save envia vários meses em uma operação, usa upsert e retorna readback canônico', async () => {
  const { database, calls } = createDatabase();
  const response = await new PlanningService(database as never).save(
    projectId,
    versionId,
    parsePlanningBatchPayload(validPayload),
    actor,
  );
  assert.equal(response.contract, 'ltcm.p029.monthly-planning-editor.v1');
  assert.equal(calls.filter((call) => call.text.startsWith('insert into')).length, 3);
  assert.equal(calls.filter((call) => call.text.includes('on conflict')).length, 3);
  assert.ok(calls.some((call) => call.text.startsWith('update ltc_m.plan_versions')));
  assert.ok(calls.every((call) => !/\bdelete\s+(from|on)\b/iu.test(call.text)));
});

test('P029 bloqueia versão stale ou item inativo antes de persistir', async () => {
  const stale = createDatabase({ stale: true });
  await assert.rejects(
    new PlanningService(stale.database as never).save(
      projectId,
      versionId,
      parsePlanningBatchPayload(validPayload),
      actor,
    ),
    (error: unknown) =>
      error instanceof ConflictException && error.message.includes('P029_VERSION_CONFLICT'),
  );
  assert.equal(stale.calls.filter((call) => call.text.startsWith('insert into')).length, 0);

  const inactive = createDatabase({ inactive: true });
  await assert.rejects(
    new PlanningService(inactive.database as never).save(
      projectId,
      versionId,
      parsePlanningBatchPayload(validPayload),
      actor,
    ),
    (error: unknown) =>
      error instanceof UnprocessableEntityException &&
      error.message.includes('P029_ITEM_NOT_ELIGIBLE'),
  );
  assert.equal(inactive.calls.filter((call) => call.text.startsWith('insert into')).length, 0);
});

test('P030 bloqueia excesso sem override antes de qualquer escrita', async () => {
  const { database, calls } = createDatabase({ contractValue: '10.00' });
  await assert.rejects(
    new PlanningService(database as never).save(
      projectId,
      versionId,
      parsePlanningBatchPayload(validPayload),
      actor,
    ),
    (error: unknown) =>
      error instanceof ForbiddenException &&
      error.message.includes('P030_BALANCE_OVERRIDE_REQUIRED'),
  );
  assert.equal(calls.filter((call) => call.text.startsWith('insert into')).length, 0);
  assert.equal(
    calls.filter((call) => call.text.startsWith('update ltc_m.plan_versions')).length,
    0,
  );
});

test('P030 permite excesso somente quando o capability admin foi derivado', async () => {
  const { database } = createDatabase({ contractValue: '10.00' });
  const response = await new PlanningService(database as never).save(
    projectId,
    versionId,
    parsePlanningBatchPayload(validPayload),
    actor,
    true,
  );
  assert.equal(response.financial.canOverrideBalance, true);
});

test('P030 aplica replacement semantics ao calcular o total final', async () => {
  const { database } = createDatabase({ contractValue: '19.40' });
  const response = await new PlanningService(database as never).save(
    projectId,
    versionId,
    parsePlanningBatchPayload(validPayload),
    actor,
  );
  assert.equal(response.version.contentRevision, 4);
});

test('P030 sanitiza overflow de agregado financeiro', async () => {
  const { database, calls } = createDatabase({ aggregateOverflow: true });
  await assert.rejects(
    new PlanningService(database as never).save(
      projectId,
      versionId,
      parsePlanningBatchPayload(validPayload),
      actor,
    ),
    (error: unknown) =>
      error instanceof UnprocessableEntityException &&
      error.message.includes('P030_FINANCIAL_AGGREGATE_OVERFLOW'),
  );
  assert.equal(calls.filter((call) => call.text.startsWith('insert into')).length, 0);
});

test('P030 permite reduzir excesso até o contrato e bloqueia manter ou aumentar', async () => {
  const payload = parsePlanningBatchPayload({
    expectedVersion: 4,
    justification: 'Correção de excesso',
    entries: [
      { itemId: itemA, competence: '2026-12-01', amount: '100.00' },
      { itemId: itemB, competence: '2026-12-01', amount: '0.00' },
    ],
  });
  const firstEntry = payload.entries[0];
  const secondEntry = payload.entries[1];
  assert.ok(firstEntry);
  assert.ok(secondEntry);
  const corrected = createDatabase({
    contractValue: '100.00',
    existingAmount: '200.00',
    justification: 'Correção de excesso',
  });
  await new PlanningService(corrected.database as never).save(projectId, versionId, payload, actor);

  const maintained = createDatabase({
    contractValue: '100.00',
    existingAmount: '200.00',
    justification: 'Correção de excesso',
  });
  await assert.rejects(
    new PlanningService(maintained.database as never).save(
      projectId,
      versionId,
      {
        ...payload,
        entries: [
          { ...firstEntry, amount: '200.00' },
          { ...secondEntry, amount: '0.00' },
        ],
      },
      actor,
    ),
    /P030_BALANCE_OVERRIDE_REQUIRED/u,
  );
});

test('P031 rejeita row_version stale antes de chamar a função SQL', async () => {
  const calls: string[] = [];
  const database = {
    actorTransaction: async <Result>(
      _receivedActor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<Result>,
    ) =>
      operation({
        query: async <Row>(text: string) => {
          calls.push(text);
          if (text.includes('from ltc_m.projects'))
            return {
              rows: [
                {
                  project_id: projectId,
                  project_code: 'P031',
                  project_name: 'Projeto P031',
                  currency_code: 'BRL',
                  contract_value: '100.00',
                  project_status: 'active',
                  start_date: '2026-12-01',
                  end_date: '2027-01-01',
                } as Row,
              ],
            };
          return {
            rows: [
              {
                version_id: versionId,
                version_name: 'P031',
                version_status: 'draft',
                row_version: 8,
                content_revision: 3,
                is_baseline: false,
                approved_at: null,
                source_plan_version_id: null,
                baseline_plan_version_id: null,
              } as Row,
            ],
          };
        },
      }),
  };
  await assert.rejects(
    new PlanningService(database as never).workflow(
      projectId,
      versionId,
      'submit',
      { expectedRowVersion: 7 },
      actor,
    ),
    (error: unknown) =>
      error instanceof ConflictException && error.message.includes('P031_VERSION_CONFLICT'),
  );
  assert.equal(calls.filter((text) => text.includes('submit_plan_version')).length, 0);
});

test('P031 rejeita stale approve depois de uma aprovação válida', async () => {
  const { database, calls } = createDatabase({
    workflowStatus: 'pending_approval',
    workflowRowVersion: 4,
    justification: 'Aprovação concorrente',
  });
  const service = new PlanningService(database as never);
  const approved = await service.workflow(
    projectId,
    versionId,
    'approve',
    { expectedRowVersion: 4, justification: 'Aprovação concorrente' },
    actor,
  );
  assert.equal(approved.version.status, 'approved');
  assert.equal(approved.version.rowVersion, 5);
  await assert.rejects(
    service.workflow(
      projectId,
      versionId,
      'approve',
      { expectedRowVersion: 4, justification: 'Aprovação concorrente' },
      actor,
    ),
    (error: unknown) =>
      error instanceof ConflictException && error.message.includes('P031_VERSION_CONFLICT'),
  );
  assert.equal(calls.filter((call) => call.text.includes('approve_plan_version')).length, 1);
});
