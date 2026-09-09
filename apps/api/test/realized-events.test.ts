import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { RealizedEventsService } from '../src/realized-events/realized-events.service.js';
import {
  P033_SOURCE_KEY_CONFLICT,
  P033_SOURCE_KEY_CONFLICT_MESSAGE,
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

function p033Database(
  query: (
    text: string,
    values: readonly unknown[],
  ) => { readonly rows: readonly unknown[] } | Promise<{ readonly rows: readonly unknown[] }>,
) {
  const statements: string[] = [];
  return {
    statements,
    actorTransaction: async <T>(
      _context: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<T>,
    ) =>
      operation({
        query: async <Row>(text: string, values: readonly unknown[] = []) => {
          statements.push(text);
          const result = await query(text, values);
          return { rows: result.rows as Row[] };
        },
      }),
  };
}

function databaseError(
  code: string,
  constraint?: string,
): Error & {
  readonly code: string;
  readonly constraint?: string;
} {
  const error = new Error('database detail must not escape') as Error & {
    readonly code: string;
    readonly constraint?: string;
  };
  Object.defineProperty(error, 'code', { value: code });
  if (constraint) Object.defineProperty(error, 'constraint', { value: constraint });
  return error;
}

function duplicatePayload() {
  return parseRealizedEventCreatePayload({
    projectItemId: null,
    competenceDate: '2026-09-01',
    sourceKey: 'source-1',
    amount: '10',
    currencyCode: 'BRL',
  });
}

test('P033 cria conflito seguro para billing_actual em todos os estados', async () => {
  for (const existingStatus of ['draft', 'posted', 'cancelled'] as const) {
    const database = p033Database(async (text) => {
      if (text.includes('from ltc_m.projects')) return { rows: [project] };
      if (text.includes('insert into ltc_m.financial_actual_events'))
        throw databaseError('23505', 'uq_financial_actual_source');
      if (text.includes('select id, metric_type::text as metric_type')) {
        return { rows: [{ id: eventId, metric_type: 'billing_actual', status: existingStatus }] };
      }
      return { rows: [] };
    });

    await assert.rejects(
      new RealizedEventsService(database as never).create(projectId, duplicatePayload(), actor),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.deepEqual(error.getResponse(), {
          statusCode: 409,
          code: P033_SOURCE_KEY_CONFLICT,
          message: P033_SOURCE_KEY_CONFLICT_MESSAGE,
          details: { existingEventId: eventId, existingStatus, canOpen: true },
        });
        return true;
      },
    );
    assert.deepEqual(
      database.statements.filter((statement) =>
        /savepoint|financial_actual_events/u.test(statement),
      ),
      [
        'savepoint p033_source_key_conflict',
        expectInsertStatement(database.statements),
        'rollback to savepoint p033_source_key_conflict',
        'release savepoint p033_source_key_conflict',
        expectConflictStatement(database.statements),
      ],
    );
  }
});

function expectInsertStatement(statements: readonly string[]): string {
  return (
    statements.find((statement) =>
      statement.includes('insert into ltc_m.financial_actual_events'),
    ) ?? ''
  );
}

function expectConflictStatement(statements: readonly string[]): string {
  return (
    statements.find((statement) =>
      statement.includes('select id, metric_type::text as metric_type'),
    ) ?? ''
  );
}

test('P033 oculta receipt_actual e permanece fail-closed quando o enriquecimento falha', async () => {
  const cases = [
    { metric_type: 'receipt_actual', status: 'posted' as const },
    { error: databaseError('XX000') },
  ];
  for (const conflict of cases) {
    const database = p033Database(async (text) => {
      if (text.includes('from ltc_m.projects')) return { rows: [project] };
      if (text.includes('insert into ltc_m.financial_actual_events'))
        throw databaseError('23505', 'uq_financial_actual_source');
      if (text.includes('select id, metric_type::text as metric_type')) {
        if ('error' in conflict) throw conflict.error;
        return {
          rows: [{ id: eventId, metric_type: conflict.metric_type, status: conflict.status }],
        };
      }
      return { rows: [] };
    });
    await assert.rejects(
      new RealizedEventsService(database as never).create(projectId, duplicatePayload(), actor),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.deepEqual(error.getResponse(), {
          statusCode: 409,
          code: P033_SOURCE_KEY_CONFLICT,
          message: P033_SOURCE_KEY_CONFLICT_MESSAGE,
          details: { canOpen: false },
        });
        return true;
      },
    );
  }
});

test('P033 não classifica outra violação 23505 como conflito de source_key', async () => {
  const database = p033Database(async (text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('insert into ltc_m.financial_actual_events'))
      throw databaseError('23505', 'uq_financial_actual_other');
    return { rows: [] };
  });
  await assert.rejects(
    new RealizedEventsService(database as never).create(projectId, duplicatePayload(), actor),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.deepEqual(error.getResponse(), {
        statusCode: 409,
        message: 'P032_UNIQUE_CONFLICT',
        error: 'Conflict',
      });
      return true;
    },
  );
  assert.equal(
    database.statements.some((statement) => statement.includes('select id, metric_type::text')),
    false,
  );
});

test('P033 aplica o mesmo conflito seguro no update de source_key', async () => {
  const database = p033Database(async (text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (
      text.includes('from ltc_m.financial_actual_events') &&
      !text.includes('select id, metric_type::text')
    ) {
      return { rows: [event] };
    }
    if (text.includes('update ltc_m.financial_actual_events'))
      throw databaseError('23505', 'uq_financial_actual_source');
    if (text.includes('select id, metric_type::text as metric_type')) {
      return {
        rows: [
          {
            id: '00000000-0000-4000-8000-000000032202',
            metric_type: 'billing_actual',
            status: 'posted',
          },
        ],
      };
    }
    return { rows: [] };
  });
  await assert.rejects(
    new RealizedEventsService(database as never).update(
      projectId,
      eventId,
      parseRealizedEventPatchPayload({ sourceKey: 'other-source', expectedVersion: 1 }),
      actor,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.deepEqual(error.getResponse(), {
        statusCode: 409,
        code: P033_SOURCE_KEY_CONFLICT,
        message: P033_SOURCE_KEY_CONFLICT_MESSAGE,
        details: {
          existingEventId: '00000000-0000-4000-8000-000000032202',
          existingStatus: 'posted',
          canOpen: true,
        },
      });
      return true;
    },
  );
});

test('P033 sob concorrência mantém exatamente uma linha e converte a perdedora em 409', async () => {
  let attempts = 0;
  let inserted = false;
  let releaseSecond!: () => void;
  const secondInsert = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const database = p033Database(async (text) => {
    if (text.includes('from ltc_m.projects')) return { rows: [project] };
    if (text.includes('insert into ltc_m.financial_actual_events')) {
      attempts += 1;
      if (attempts === 2) releaseSecond();
      await secondInsert;
      if (!inserted) {
        inserted = true;
        return { rows: [{ id: eventId }] };
      }
      throw databaseError('23505', 'uq_financial_actual_source');
    }
    if (text.includes('select id, metric_type::text as metric_type')) {
      return { rows: [{ id: eventId, metric_type: 'billing_actual', status: 'draft' }] };
    }
    if (text.includes('from ltc_m.financial_actual_events')) return { rows: [event] };
    return { rows: [] };
  });

  const results = await Promise.allSettled([
    new RealizedEventsService(database as never).create(projectId, duplicatePayload(), actor),
    new RealizedEventsService(database as never).create(projectId, duplicatePayload(), actor),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.ok(rejected.reason instanceof ConflictException);
  assert.deepEqual(rejected.reason.getResponse(), {
    statusCode: 409,
    code: P033_SOURCE_KEY_CONFLICT,
    message: P033_SOURCE_KEY_CONFLICT_MESSAGE,
    details: { existingEventId: eventId, existingStatus: 'draft', canOpen: true },
  });
  assert.equal(inserted, true);
  assert.equal(attempts, 2);
});
