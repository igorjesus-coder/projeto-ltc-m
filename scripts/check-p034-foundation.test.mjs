import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { P034_MIGRATION, validateP034Sources } from './check-p034-foundation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = path.join(root, 'supabase', 'migrations');

async function sources(migration = null) {
  return {
    migration: migration ?? (await readFile(path.join(migrationDirectory, P034_MIGRATION), 'utf8')),
    migrationNames: await readdir(migrationDirectory),
    contract: await readFile(
      path.join(root, 'docs', 'quality', 'p034-data-quality-center.md'),
      'utf8',
    ),
    design: await readFile(
      path.join(root, 'docs', 'quality', 'p034-provenance-ddl-design.md'),
      'utf8',
    ),
  };
}

test('P034 foundation oficial passa o gate estático', async () => {
  assert.deepEqual(validateP034Sources(await sources()), []);
});

test('P034 rejeita capability com login e tabela fora do escopo', async () => {
  const migration = await readFile(path.join(migrationDirectory, P034_MIGRATION), 'utf8');
  const mutated = migration
    .replace('nologin', 'login')
    .replace('create table ltc_m.p034_provenance_snapshots', 'create table public.findings');
  const issues = validateP034Sources(await sources(mutated));
  assert.ok(issues.some((issue) => issue.includes('capability writer')));
  assert.ok(issues.some((issue) => issue.includes('quatro tabelas')));
});
