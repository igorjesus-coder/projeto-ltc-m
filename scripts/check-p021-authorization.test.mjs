import test from 'node:test';
import assert from 'node:assert/strict';

import { checkP021Authorization } from './check-p021-authorization.mjs';

test('aceita o contrato P021 versionado', () => {
  assert.deepEqual(checkP021Authorization(), []);
});

test('rejeita ausência de resolução fail-closed e da rota protegida', () => {
  const issues = checkP021Authorization(process.cwd(), {
    overrides: {
      'apps/api/src/auth/authorization.ts': 'const viewer = true;',
      'apps/api/src/auth/auth.controller.ts': "@Get('me')",
      'apps/api/src/auth/auth.guard.ts': '',
    },
  });

  assert.ok(issues.includes('P021_FAIL_CLOSED_MISSING'));
  assert.ok(issues.includes('P021_ACTOR_CONTEXT_BINDING_MISSING'));
});

test('rejeita capacidade explicitamente não suportada concedida a role', () => {
  const issues = checkP021Authorization(process.cwd(), {
    overrides: {
      'apps/api/src/auth/authorization.ts': `
        const ROLE_CAPABILITIES = { viewer: ['physical_delete'] };
        const viewer = 'viewer'; const editor = 'editor'; const approver = 'approver'; const admin = 'admin';
        const resolve_authorization = true; const AuthorizationGuard = true;
        const RequireCapabilities = true; const setActorContext = true; const actor_auth_subject = true;
        const P021_AUTHORIZATION_DENIED = true;
      `,
    },
  });

  assert.ok(issues.includes('P021_UNSUPPORTED_CAPABILITY_GRANTED:physical_delete'));
});
