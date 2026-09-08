import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { RealizedEventsService } from '../src/realized-events/realized-events.service.js';
import {
  P032_REALIZED_EVENTS_CONTRACT,
  parseRealizedEventCancelPayload,
  parseRealizedEventCreatePayload,
  parseRealizedEventPatchPayload,
} from '../src/realized-events/realized-events.types.js';

const projectId = '00000000-0000-4000-8000-000000032101';
const eventId = '00000000-0000-4000-8000-000000032201';
const itemId = '00000000-0000-4000-8000-000000032301';
const actor = Object.freeze({
  appUserId: '00000000-0000-4000-8000-000000032001',
  authSubject: 'auth0|p032-editor',
  requestId: 'p032-request',
  source: 'api' as const,
});
const project = {
  id: projectId,
  project_code: 'P032',
  project_name: 'Projeto de teste',
  base_currency: 'BRL',
  deleted_at: null,
};
const event = {
  id: eventId,
  project_id: projectId,
  project_item_id: itemId,
  item_code: 'ITEM-1',
  item_description: 'Item',
  competence_date: '2026-09-01',
  source_key: 'source-1',
  document_number: null,
  installment_key: null,
  amount: '10.00',
  currency_code: 'BRL',
  status: 'draft' as const,
  metric_type: 'billing_actual' as const,
  notes: null,
  row_version: '1',
  created_at: '2026-09-01T12:00:00.000Z',
  updated_at: '2026-09-01T12:00:00.000Z',
};

test('P032 parser fixa billing_actual, normaliza campos e fecha status/receita', () => {
  assert.deepEqual(
    parseRealizedEventCreatePayload({
      projectItemId: itemId,
      competenceDate: '2026-09-01',
      sourceKey: ' source-1 ',
      amount: '10.5',
      currencyCode: ' brl ',
      documentNumber: '',
      installmentKey: null,
      notes: null,
    }),
    {
      projectItemId: itemId,
      competenceDate: '2026-09-01',
      sourceKey: 'source-1',
      documentNumber: null,
      installmentKey: null,
      amount: '10.50',
      currencyCode: 'BRL',
      notes: null,
    },
  );
  assert.deepEqual(parseRealizedEventPatchPayload({ amount: '12', expectedVersion: 3 }), {
    amount: '12.00',
    expectedVersion: 3,
  });
  assert.deepEqual(
    parseRealizedEventCancelPayload({ expectedVersion: 3, justification: 'ajuste' }),
    {
      expectedVersion: 3,
      justification: 'ajuste',
    },
  );
  assert.throws(
    () => parseRealizedEventCreatePayload({ ...event, status: 'posted' }),
    (error: unknown) => error instanceof BadRequestException,
  );
  assert.throws(
    () =>
      parseRealizedEventCreatePayload({
        projectItemId: itemId,
        competenceDate: '2026-02-30',
        sourceKey: 'x',
        amount: '1',
        currencyCode: 'BRL',
      }),
    (error: unknown) => error instanceof BadRequestException,
  );
});

function databaseFor(
  query: (text: string, values: readonly unknown[]) => { readonly rows: readonly unknown[] },
) {
  const statements: string[] = [];
  const contexts: Array<{ readonly justification: string | null | undefined }> = [];
  return {
    statements,
    contexts,
    actorTransaction: async <T>(
      receivedActor: typeof actor & { readonly justification?: string | null },
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<T>,
    ) => {
      contexts.push({ justification: receivedActor.justification });
      return operation({
        query: async <Row>(text: string, values: readonly unknown[] = []) => {
          statements.push(text);
          return { rows: query(text, values).rows as Row[] };
        },
      });
    },
  };
}

test('P032 service cria como rascunho, publica, atualiza com versão e cancela com justificativa', async () => {
  let insertStatement = '';
  const database = databaseFor((text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('from ltc_m.project_items')) return { rows: [{ id: itemId }] };
    if (text.includes('insert into ltc_m.financial_actual_events')) {
      insertStatement = text;
      return { rows: [{ id: eventId }] };
    }
    if (text.includes('from ltc_m.financial_actual_events')) return { rows: [event] };
    if (text.includes('update ltc_m.financial_actual_events')) return { rows: [{ id: eventId }] };
    return { rows: [] };
  });
  const service = new RealizedEventsService(database as never);
  const payload = parseRealizedEventCreatePayload({
    projectItemId: itemId,
    competenceDate: '2026-09-01',
    sourceKey: 'source-1',
    amount: '10',
    currencyCode: 'BRL',
  });
  const created = await service.create(projectId, payload, actor);
  assert.equal(created.metricType, 'billing_actual');
  assert.match(insertStatement, /'billing_actual'/u);
  assert.doesNotMatch(insertStatement, /receipt_actual/u);
  assert.doesNotMatch(insertStatement, /status/u);

  await service.update(projectId, eventId, { amount: '12.00', expectedVersion: 1 }, actor);
  await service.publish(projectId, eventId, 1, actor);
  await service.cancel(
    projectId,
    eventId,
    parseRealizedEventCancelPayload({ expectedVersion: 1, justification: 'correção documentada' }),
    actor,
  );
  assert.equal(database.contexts.at(-1)?.justification, 'correção documentada');
  assert.match(database.statements.join('\n'), /row_version =/u);
  assert.match(database.statements.join('\n'), /status = 'cancelled'/u);
});

test('P032 service não sobrescreve versão concorrente nem oferece exclusão física', async () => {
  const database = databaseFor((text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('from ltc_m.financial_actual_events')) return { rows: [event] };
    if (text.includes('update ltc_m.financial_actual_events')) return { rows: [] };
    return { rows: [] };
  });
  await assert.rejects(
    new RealizedEventsService(database as never).update(
      projectId,
      eventId,
      parseRealizedEventPatchPayload({ amount: '11', expectedVersion: 1 }),
      actor,
    ),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.doesNotMatch(database.statements.join('\n'), /delete\s+from/iu);
});

test('P032 consulta somente billing_actual e preserva cancelados no histórico', async () => {
  const database = databaseFor((text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('from ltc_m.financial_actual_events'))
      return { rows: [{ ...event, status: 'cancelled' }] };
    if (text.includes('select id, item_code, description'))
      return { rows: [{ id: itemId, item_code: 'ITEM-1', description: 'Item' }] };
    return { rows: [] };
  });
  const response = await new RealizedEventsService(database as never).list(projectId, actor);
  assert.equal(response.events[0]?.status, 'cancelled');
  assert.match(
    database.statements.find((statement) => statement.includes('financial_actual_events')) ?? '',
    /metric_type = 'billing_actual'/u,
  );
});

test('P032 mantém posted corrigível e torna cancelled terminal em todas as ações', async () => {
  const postedDatabase = databaseFor((text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('from ltc_m.financial_actual_events'))
      return { rows: [{ ...event, status: 'posted' }] };
    if (text.includes('update ltc_m.financial_actual_events')) return { rows: [{ id: eventId }] };
    return { rows: [] };
  });
  const posted = await new RealizedEventsService(postedDatabase as never).update(
    projectId,
    eventId,
    parseRealizedEventPatchPayload({ amount: '12', expectedVersion: 1 }),
    actor,
  );
  assert.equal(posted.status, 'posted');

  const cancelledDatabase = databaseFor((text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('from ltc_m.financial_actual_events'))
      return { rows: [{ ...event, status: 'cancelled' }] };
    return { rows: [] };
  });
  const cancelledService = new RealizedEventsService(cancelledDatabase as never);
  await assert.rejects(
    cancelledService.update(projectId, eventId, { amount: '12', expectedVersion: 1 }, actor),
    ConflictException,
  );
  await assert.rejects(cancelledService.publish(projectId, eventId, 1, actor), ConflictException);
  await assert.rejects(
    cancelledService.cancel(
      projectId,
      eventId,
      { expectedVersion: 1, justification: 'repetição' },
      actor,
    ),
    ConflictException,
  );
});

assert.equal(P032_REALIZED_EVENTS_CONTRACT, 'ltcm.p032.realized-events-crud.v1');
