import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PlanningService } from '../src/planning/planning.service.js';
import {
  parsePlanningBatchPayload,
  parsePlanningMonthQuery,
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

function createDatabase(options: { readonly inactive?: boolean; readonly stale?: boolean } = {}) {
  const calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
  const project = {
    project_id: projectId,
    project_code: 'P029',
    project_name: 'Projeto P029',
    currency_code: 'BRL',
    project_status: 'active',
    start_date: '2026-12-01',
    end_date: '2027-01-01',
  };
  const plan = {
    version_id: versionId,
    version_name: 'Forecast 2026',
    version_status: 'draft',
    row_version: options.stale ? 3 : 4,
    is_baseline: false,
  };
  const database = {
    actorTransaction: async <Result>(
      receivedActor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<Result>,
    ) => {
      assert.deepEqual(receivedActor, { ...actor, justification: 'Reprogramação mensal' });
      return operation({
        query: async <Row>(text: string, values: readonly unknown[] = []) => {
          calls.push({ text, values });
          if (text.includes('for update')) return { rows: [plan as Row] };
          if (text.includes('join ltc_m.financial_plan_scopes')) return { rows: [plan as Row] };
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
            return { rows: [{ row_version: 5 } as Row] };
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
              { item_id: itemA, competence_month: '2026-12-01', amount: '0.10', row_version: 1 },
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
