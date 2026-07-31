import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { scanP008TestText } from './check-p008-tests.mjs';

const p008Sql = fs.readFileSync(
  new URL('../database/audit/ltcm-p008-rls-tests.sql', import.meta.url),
  'utf8',
);

test('aceita a suíte oficial P008 com rollback integral', () => {
  assert.deepEqual(scanP008TestText(p008Sql), []);
});

test('rejeita COMMIT, ausência de rollback e cenário obrigatório ausente', () => {
  assert.notDeepEqual(scanP008TestText(p008Sql.replace('rollback;', 'commit;')), []);
  assert.notDeepEqual(scanP008TestText(p008Sql.replace('rollback;', '')), []);
  assert.ok(
    scanP008TestText(p008Sql.replace('último admin foi inativado', 'cenário removido')).some(
      (issue) => issue.includes('último admin'),
    ),
  );
});

test('rejeita DDL, role externa, credencial e mutação fora do escopo', () => {
  const ddl = p008Sql.replace('rollback;', 'alter table ltc_m.clients disable row level security;');
  const role = p008Sql.replace('set local role ltc_m_runtime;', 'set local role postgres;');
  const credential = p008Sql.replace('rollback;', "select 'client_secret';\nrollback;");
  const external = p008Sql.replace(
    'rollback;',
    'insert into public.example (id) values (1);\nrollback;',
  );

  assert.notDeepEqual(scanP008TestText(ddl), []);
  assert.notDeepEqual(scanP008TestText(role), []);
  assert.notDeepEqual(scanP008TestText(credential), []);
  assert.notDeepEqual(scanP008TestText(external), []);
});

test('exige evidência de current_actor_id e do DML completo do Editor', () => {
  const withoutActorEvidence = p008Sql.replace(
    'P008 falhou: current_actor_id não está na allowlist D28.',
    'P008 falhou: dependência de contexto ausente.',
  );
  const withoutEditorDml = p008Sql.replace(
    /do\s+\$editor\$[\s\S]*?\$editor\$;/i,
    'do $editor$ begin null; end; $editor$;',
  );

  assert.ok(
    scanP008TestText(withoutActorEvidence).some((issue) => issue.includes('current_actor_id')),
  );
  assert.ok(
    scanP008TestText(withoutEditorDml).some((issue) => issue.includes('Editor DML completo')),
  );
});
