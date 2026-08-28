import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkP020Auth0 } from './check-p020-auth0.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('aceita o contrato P020 Auth0 com boundaries de segurança', () => {
  assert.deepEqual(checkP020Auth0(root), []);
});

test('rejeita Supabase Auth e segredo no código do navegador', () => {
  const environment = `${read('apps/web/src/app/environment.ts')}\nlocalStorage.setItem('token', 'x');`;
  const issues = checkP020Auth0(root, {
    overrides: { 'apps/web/src/app/environment.ts': environment },
  });
  assert.ok(issues.includes('P020_WEB_SECRET_FOUND'));
});
