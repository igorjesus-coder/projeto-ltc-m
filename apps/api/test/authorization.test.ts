import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException } from '@nestjs/common';

import {
  AuthorizationService,
  capabilitiesForRole,
  hasCapabilities,
  isRole,
} from '../src/auth/authorization.js';

type FakeClient = {
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: readonly Record<string, string>[] }>;
};

test('mapeia capabilities com least privilege e sem permissões proibidas', () => {
  assert.deepEqual(capabilitiesForRole('viewer'), ['data:read', 'financial:read']);
  assert.ok(capabilitiesForRole('editor').includes('workflow:submit'));
  assert.ok(!capabilitiesForRole('editor').includes('workflow:approve'));
  assert.deepEqual(capabilitiesForRole('approver'), [
    'data:read',
    'financial:read',
    'workflow:approve',
    'workflow:return_to_draft',
  ]);
  assert.ok(capabilitiesForRole('admin').includes('roles:manage'));
  for (const role of ['viewer', 'editor', 'approver', 'admin'] as const) {
    const capabilities = capabilitiesForRole(role) as readonly string[];
    assert.ok(!capabilities.includes('physical_delete'));
    assert.ok(!capabilities.includes('archive'));
    assert.ok(!capabilities.includes('unlock_direct'));
  }
  assert.equal(isRole('unknown'), false);
});

test('hasCapabilities exige todas as capabilities e não aceita escalada local', () => {
  const editor = { capabilities: capabilitiesForRole('editor') };
  assert.equal(hasCapabilities(editor, ['record:create', 'workflow:submit']), true);
  assert.equal(hasCapabilities(editor, ['workflow:approve']), false);
});

test('resolve usuário interno, configura contexto e falha fechado sem perfil', async () => {
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  const database = {
    transaction: async <T>(operation: (client: FakeClient) => Promise<T>) =>
      operation({
        query: async (text: string, values?: readonly unknown[]) => {
          if (values === undefined) queries.push({ text });
          else queries.push({ text, values });
          if (text.includes('resolve_authorization')) {
            return {
              rows: [
                {
                  app_user_id: '00000000-0000-4000-8000-000000021001',
                  display_name: 'P021 Approver',
                  app_role: 'approver',
                },
              ],
            };
          }
          return { rows: [] };
        },
      }),
  };
  const service = new AuthorizationService(database as never);
  const profile = await service.resolve('auth0|p021-approver', 'p021-request');
  assert.equal(profile.role, 'approver');
  assert.ok(profile.capabilities.includes('workflow:approve'));
  assert.ok(queries.some((query) => query.text.includes('ltc_m.set_actor_context')));

  const deniedService = new AuthorizationService({
    transaction: async <T>(operation: (client: FakeClient) => Promise<T>) =>
      operation({ query: async () => ({ rows: [] }) }),
  } as never);
  await assert.rejects(
    deniedService.resolve('auth0|p021-missing'),
    (error: unknown) => error instanceof ForbiddenException,
  );
});
