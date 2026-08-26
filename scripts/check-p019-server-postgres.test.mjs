import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkP019ServerPostgres } from './check-p019-server-postgres.mjs';

test('aceita o contrato P019 completo no repositório', () => {
  assert.deepEqual(checkP019ServerPostgres(), []);
});

test('detecta import pg no browser sem inspecionar credenciais', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ltcm-p019-check-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of [
    'apps/api',
    'apps/web/src',
    'docs/backend',
    'scripts',
    'supabase/migrations',
  ]) {
    fs.cpSync(path.join(process.cwd(), directory), path.join(root, directory), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, 'apps', 'web', 'src', 'p019-forbidden.ts'),
    "import { Pool } from 'pg';\nvoid Pool;\n",
  );
  assert.ok(checkP019ServerPostgres(root).includes('P019_BROWSER_PG_IMPORT'));
});
