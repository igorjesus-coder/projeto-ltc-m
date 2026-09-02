import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ProjectItemsService } from '../src/project-items/project-items.service.js';
import {
  parseProjectItemCreatePayload,
  parseProjectItemDuplicatePayload,
  parseProjectItemInactivatePayload,
  parseProjectItemPatchPayload,
} from '../src/project-items/project-items.types.js';

const actor = Object.freeze({
  appUserId: '00000000-0000-4000-8000-000000027001',
  authSubject: 'auth0|p027-editor',
  requestId: 'p027-request',
  source: 'api' as const,
});

const projectId = '00000000-0000-4000-8000-000000027101';
const itemId = '00000000-0000-4000-8000-000000027201';
const project = {
  id: projectId,
  base_currency: 'BRL' as const,
  project_status: 'active',
  deleted_at: null,
  currency_active: true,
};
const item = {
  id: itemId,
  project_id: projectId,
  source_line_key: 'manual:source',
  line_number: 1,
  item_code: 'ITEM-1',
  description: 'Item de teste',
  quantity: '2.0000',
  unit_code: 'UN',
  unit_name: 'Unidade',
  unit_available: true,
  currency_code: 'BRL' as const,
  currency_name: 'Real brasileiro',
  currency_available: true,
  unit_price: '10.5000',
  total_amount: '21.00',
  active: true,
  deleted_at: null,
  row_version: '3',
  created_at: '2026-09-02T12:00:00.000Z',
  updated_at: '2026-09-02T12:00:00.000Z',
};

test('P027 parser aceita criação, permite código repetido e falha fechado', () => {
  assert.deepEqual(
    parseProjectItemCreatePayload({
      itemCode: ' ITEM-1 ',
      description: '',
      quantity: '2.5',
      unitCode: ' un ',
      currencyCode: ' brl ',
      unitPrice: '0',
    }),
    {
      itemCode: 'ITEM-1',
      description: null,
      quantity: '2.5',
      unitCode: 'UN',
      currencyCode: 'BRL',
      unitPrice: '0',
    },
  );
  assert.throws(
    () =>
      parseProjectItemCreatePayload({
        itemCode: 'x',
        quantity: '0',
        unitCode: 'UN',
        currencyCode: 'BRL',
        unitPrice: '1',
      }),
    (error: unknown) => error instanceof BadRequestException,
  );
  assert.throws(
    () =>
      parseProjectItemCreatePayload({
        itemCode: 'x',
        quantity: '1',
        unitCode: 'UN',
        currencyCode: 'EUR',
        unitPrice: '1',
      }),
    (error: unknown) => error instanceof BadRequestException,
  );
  assert.throws(
    () =>
      parseProjectItemCreatePayload({
        quantity: '1',
        unitCode: 'UN',
        currencyCode: 'BRL',
        unitPrice: '1',
        unexpected: true,
      }),
    (error: unknown) => error instanceof BadRequestException,
  );
  assert.deepEqual(parseProjectItemDuplicatePayload({ expectedVersion: 3 }), {
    expectedVersion: 3,
  });
  assert.deepEqual(
    parseProjectItemInactivatePayload({ expectedVersion: 3, justification: 'correção' }),
    {
      expectedVersion: 3,
      justification: 'correção',
    },
  );
  assert.deepEqual(parseProjectItemPatchPayload({ unitPrice: '12.3456', expectedVersion: 3 }), {
    unitPrice: '12.3456',
    expectedVersion: 3,
  });
});

function databaseFor(
  query: (text: string, values: readonly unknown[]) => { readonly rows: readonly unknown[] },
) {
  const statements: string[] = [];
  return {
    statements,
    actorTransaction: async <T>(
      receivedActor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<T>,
    ) => {
      assert.deepEqual(receivedActor.appUserId, actor.appUserId);
      return operation({
        query: async <Row>(text: string, values: readonly unknown[] = []) => {
          statements.push(text);
          return { rows: query(text, values).rows as Row[] };
        },
      });
    },
  };
}

test('P027 criação usa transação, lock do projeto, moeda exata e total gerado pelo banco', async () => {
  const database = databaseFor((text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('from ltc_m.units')) return { rows: [{ active: true }] };
    if (text.includes('coalesce(max(line_number)')) return { rows: [{ line_number: 2 }] };
    if (text.includes('insert into ltc_m.project_items')) return { rows: [{ id: itemId }] };
    if (text.includes('from ltc_m.project_items')) return { rows: [item] };
    return { rows: [] };
  });
  const service = new ProjectItemsService(database as never);
  const created = await service.create(
    projectId,
    parseProjectItemCreatePayload({
      itemCode: 'ITEM-1',
      description: 'Item de teste',
      quantity: '2',
      unitCode: 'UN',
      currencyCode: 'BRL',
      unitPrice: '10.5',
    }),
    actor,
    'editor',
  );

  assert.equal(created.totalAmount, '21.00');
  assert.match(database.statements.join('\n'), /for update/u);
  assert.match(database.statements.join('\n'), /source_line_key/u);
  const insert = database.statements.find((statement) =>
    statement.includes('insert into ltc_m.project_items'),
  );
  assert.ok(insert);
  assert.doesNotMatch(insert, /total_amount/u);
  assert.doesNotMatch(database.statements.join('\n'), /delete\s+from/iu);
});

test('P027 atualização exige row_version e rejeita concorrência sem sobrescrever', async () => {
  const database = databaseFor((text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('from ltc_m.project_items')) return { rows: [item] };
    if (text.includes('update ltc_m.project_items')) return { rows: [] };
    return { rows: [] };
  });
  const service = new ProjectItemsService(database as never);
  await assert.rejects(
    service.update(projectId, itemId, { unitPrice: '12', expectedVersion: 3 }, actor, 'editor'),
    (error: unknown) => error instanceof ConflictException,
  );
  const update = database.statements.find((statement) =>
    statement.includes('update ltc_m.project_items'),
  );
  assert.ok(update);
  assert.match(update, /row_version = \$[0-9]+::bigint/u);
  assert.match(update, /deleted_at is null/u);
});

test('P027 não aceita unidade inativa nem item de outro projeto', async () => {
  const unavailableUnitDatabase = databaseFor((text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('from ltc_m.units')) return { rows: [{ active: false }] };
    return { rows: [] };
  });
  const payload = parseProjectItemCreatePayload({
    itemCode: 'ITEM-2',
    description: 'Item',
    quantity: '1',
    unitCode: 'UN',
    currencyCode: 'BRL',
    unitPrice: '1',
  });
  await assert.rejects(
    new ProjectItemsService(unavailableUnitDatabase as never).create(
      projectId,
      payload,
      actor,
      'editor',
    ),
    (error: unknown) => error instanceof UnprocessableEntityException,
  );

  const wrongProjectDatabase = databaseFor((text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('from ltc_m.project_items')) return { rows: [] };
    return { rows: [] };
  });
  await assert.rejects(
    new ProjectItemsService(wrongProjectDatabase as never).update(
      projectId,
      itemId,
      { unitPrice: '1', expectedVersion: 1 },
      actor,
      'editor',
    ),
    (error: unknown) => error instanceof NotFoundException,
  );
});

test('P027 duplicação cria novo item ativo sem exigir código novo', async () => {
  const statements: string[] = [];
  const database = {
    actorTransaction: async <T>(
      _receivedActor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<T>,
    ) =>
      operation({
        query: async <Row>(text: string) => {
          statements.push(text);
          if (text.includes('from ltc_m.projects')) return { rows: [project] as Row[] };
          if (text.includes('from ltc_m.project_items') && !text.includes('coalesce')) {
            return { rows: [item] as Row[] };
          }
          if (text.includes('coalesce(max(line_number)'))
            return { rows: [{ line_number: 2 }] as Row[] };
          if (text.includes('insert into ltc_m.project_items'))
            return { rows: [{ id: itemId }] as Row[] };
          if (text.includes('from ltc_m.units')) return { rows: [{ active: true }] as Row[] };
          return { rows: [] as Row[] };
        },
      }),
  };
  const result = await new ProjectItemsService(database as never).duplicate(
    projectId,
    itemId,
    { expectedVersion: 3 },
    actor,
    'editor',
  );
  const insert = statements.find((statement) =>
    statement.includes('insert into ltc_m.project_items'),
  );
  assert.ok(insert);
  assert.match(insert, /active\s*\)\s*values[\s\S]*true/u);
  assert.equal(result.itemCode, 'ITEM-1');
});

test('P027 inativação é soft state change com justificativa no contexto do ator', async () => {
  let receivedActor: unknown;
  const database = {
    actorTransaction: async <T>(
      transactionActor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<T>,
    ) => {
      receivedActor = transactionActor;
      return operation({
        query: async <Row>(text: string) => {
          if (text.includes('from ltc_m.projects')) return { rows: [project] as Row[] };
          if (text.includes('from ltc_m.project_items')) return { rows: [item] as Row[] };
          if (text.includes('update ltc_m.project_items'))
            return { rows: [{ id: itemId }] as Row[] };
          return { rows: [] as Row[] };
        },
      });
    },
  };
  const service = new ProjectItemsService(database as never);
  const result = await service.inactivate(
    projectId,
    itemId,
    { expectedVersion: 3, justification: 'Correção de origem' },
    actor,
    'admin',
  );
  assert.equal(result.id, itemId);
  assert.equal(
    (receivedActor as { readonly justification: string }).justification,
    'Correção de origem',
  );
});
