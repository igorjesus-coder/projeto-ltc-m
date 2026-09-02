import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, ConflictException } from '@nestjs/common';

import {
  parseClientCreatePayload,
  parseClientPatchPayload,
  parseCurrencyCode,
  parseStatusPayload,
  parseUnitCreatePayload,
} from '../src/master-data/master-data.types.js';
import { MasterDataService } from '../src/master-data/master-data.service.js';
import type { ActorContext } from '../src/database/transaction.js';

const clientId = '00000000-0000-4000-8000-000000026001';
const actor = {
  appUserId: '00000000-0000-4000-8000-000000026002',
  authSubject: 'auth0|p026-admin',
  requestId: 'p026-test',
  source: 'api' as const,
};

test('P026 parsers enforce explicit allowlists and normalize domain inputs', () => {
  assert.deepEqual(
    parseClientCreatePayload({ legalName: ' Legal ', displayName: ' Client ', taxId: null }),
    {
      legalName: 'Legal',
      displayName: 'Client',
      taxId: null,
    },
  );
  assert.deepEqual(parseClientPatchPayload({ displayName: ' New ', expectedVersion: 2 }), {
    displayName: 'New',
    expectedVersion: 2,
  });
  assert.deepEqual(parseUnitCreatePayload({ code: ' un ', name: 'Unidade' }), {
    code: 'UN',
    name: 'Unidade',
    category: null,
  });
  assert.deepEqual(
    parseStatusPayload({ active: false, expectedVersion: 2, justification: 'Motivo' }),
    {
      active: false,
      expectedVersion: 2,
      justification: 'Motivo',
    },
  );
  assert.equal(parseCurrencyCode(' usd '), 'USD');
  assert.throws(
    () => parseClientPatchPayload({ active: false, expectedVersion: 2 }),
    BadRequestException,
  );
  assert.throws(() => parseCurrencyCode('EUR'), /P026_CURRENCY_NOT_ALLOWED/);
});

test('P026 client mutations use row_version predicates and administrative justification', async () => {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const row = {
    id: clientId,
    legal_name: 'Legal',
    display_name: 'Client',
    tax_id: null,
    active: false,
    row_version: 3,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    deleted_at: null,
  };
  const database = {
    actorTransaction: async <Result>(
      receivedActor: ActorContext,
      operation: (client: never) => Promise<Result>,
    ) => {
      assert.equal(receivedActor.justification, 'Desativação aprovada');
      return operation({
        query: async <T>(text: string, values: readonly unknown[] = []) => {
          queries.push({ text, values });
          if (text.includes('returning id')) return { rows: [{ id: clientId } as T] };
          return { rows: [row as T] };
        },
      } as never);
    },
  };
  const result = await new MasterDataService(database as never).setClientStatus(
    clientId,
    { active: false, expectedVersion: 2, justification: 'Desativação aprovada' },
    actor,
  );
  assert.equal(result.active, false);
  const mutation = queries.find((query) => query.text.includes('update ltc_m.clients'));
  assert.ok(mutation);
  assert.match(mutation.text, /row_version\s*=\s*\$3::bigint/u);
  assert.deepEqual(mutation.values, [false, clientId, 2]);
});

test('P026 stale client mutation is a deterministic conflict', async () => {
  const database = {
    actorTransaction: async <Result>(
      _actor: unknown,
      operation: (client: never) => Promise<Result>,
    ) =>
      operation({
        query: async <T>(text: string) => {
          if (text.includes('where id = $1')) return { rows: [{ id: clientId } as T] };
          return { rows: [] };
        },
      } as never),
  };
  await assert.rejects(
    new MasterDataService(database as never).updateClient(
      clientId,
      { displayName: 'new', expectedVersion: 4 },
      actor,
    ),
    (error: unknown) =>
      error instanceof ConflictException && error.message.includes('P026_CLIENT_VERSION_CONFLICT'),
  );
});
