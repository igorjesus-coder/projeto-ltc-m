import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { ProjectsService } from '../src/projects/projects.service.js';
import {
  parseProjectCreatePayload,
  parseProjectPatchPayload,
} from '../src/projects/projects-write.types.js';

const clientId = '00000000-0000-4000-8000-000000024001';
const projectId = '00000000-0000-4000-8000-000000024101';
const actor = {
  appUserId: '00000000-0000-4000-8000-000000024002',
  authSubject: 'auth0|p024-editor',
  requestId: 'p024-test',
  source: 'api' as const,
};

const validCreate = {
  projectCode: '  2026-01-15797  ',
  projectName: 'Projeto P024',
  clientId,
  classification: 'full_contract',
  status: 'active',
  contractValue: '2260099.66',
  dataReferenceDate: '2026-08-31',
  openingBalance: '',
  budgetCost: null,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  reportingGroup: 'Grupo P024',
  notes: null,
};

test('P024 parser normaliza create e preserva campos opcionais como null', () => {
  const parsed = parseProjectCreatePayload(validCreate);
  assert.equal(parsed.projectCode, '2026-01-15797');
  assert.equal(parsed.projectName, 'Projeto P024');
  assert.equal(parsed.openingBalance, null);
  assert.equal(parsed.budgetCost, null);
  assert.equal(parsed.status, 'active');
});

test('P024 parser rejeita campos desconhecidos, moeda atribuível, datas e valores inválidos', () => {
  assert.throws(
    () => parseProjectCreatePayload({ ...validCreate, unexpected: true }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('P024_UNKNOWN_FIELD'),
  );
  assert.throws(
    () => parseProjectCreatePayload({ ...validCreate, baseCurrency: 'USD' }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('P024_IMMUTABLE_FIELD'),
  );
  assert.throws(
    () => parseProjectCreatePayload({ ...validCreate, endDate: '2025-12-31' }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('P024_DATE_RANGE_INVALID'),
  );
  assert.throws(
    () => parseProjectCreatePayload({ ...validCreate, contractValue: '-1.00' }),
    (error: unknown) => error instanceof BadRequestException,
  );
  assert.throws(
    () => parseProjectCreatePayload({ ...validCreate, contractValue: '1.001' }),
    (error: unknown) => error instanceof BadRequestException,
  );
});

test('P024 PATCH exige versão, rejeita campos imutáveis e aceita atualização parcial', () => {
  assert.deepEqual(parseProjectPatchPayload({ projectName: '  Novo nome  ', expectedVersion: 3 }), {
    projectName: 'Novo nome',
    expectedVersion: 3,
  });
  assert.throws(
    () => parseProjectPatchPayload({ projectCode: 'novo', expectedVersion: 3 }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('P024_IMMUTABLE_FIELD'),
  );
  assert.throws(
    () => parseProjectPatchPayload({ projectName: 'novo' }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes('EXPECTED_VERSION'),
  );
});

test('P024 create usa actor transaction, BRL server-side e INSERT parametrizado', async () => {
  const calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
  const row = {
    project_id: projectId,
    project_code: '2026-01-15797',
    project_name: 'Projeto P024',
    client_id: clientId,
    client_name: 'Cliente P024',
    client_active: true,
    client_deleted_at: null,
    reporting_group: 'Grupo P024',
    classification: 'full_contract',
    project_status: 'active',
    currency_code: 'BRL',
    contract_value: '2260099.66',
    opening_balance: null,
    budget_cost: null,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    data_reference_date: '2026-08-31',
    notes: null,
    version: 1,
    updated_at: '2026-08-31T12:00:00.000Z',
  };
  type FakeClient = {
    query: <Result>(text: string, values?: readonly unknown[]) => Promise<{ rows: Result[] }>;
  };
  const database = {
    actorTransaction: async <Result>(
      receivedActor: typeof actor,
      operation: (client: FakeClient) => Promise<Result>,
    ) => {
      assert.deepEqual(receivedActor, actor);
      return operation({
        query: async <Result>(text: string, values: readonly unknown[] = []) => {
          calls.push({ text, values });
          if (text.includes('currencies')) return { rows: [{ available: true } as Result] };
          if (text.includes('clients') && text.includes('active = true'))
            return { rows: [{ id: clientId } as Result] };
          if (text.startsWith('insert into')) return { rows: [{ id: projectId } as Result] };
          return { rows: [row as Result] };
        },
      });
    },
  };
  const response = await new ProjectsService(database as never).create(
    parseProjectCreatePayload(validCreate),
    actor,
    'editor',
  );
  assert.equal(response.contract, 'ltcm.p024.project-create-edit.v1');
  assert.equal(response.baseCurrency, 'BRL');
  assert.equal(response.version, 1);
  const insert = calls.find((call) => call.text.startsWith('insert into'));
  assert.ok(insert);
  assert.match(insert.text, /'BRL'/u);
  assert.ok(!insert.values.includes(actor.appUserId));
});

test('P024 editor não pode criar projeto fora de active', async () => {
  await assert.rejects(
    new ProjectsService({} as never).create(
      parseProjectCreatePayload({ ...validCreate, status: 'draft' }),
      actor,
      'editor',
    ),
    (error: unknown) => error instanceof ConflictException,
  );
});
