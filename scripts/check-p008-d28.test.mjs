import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { D28_FILENAME, checkD28Migrations, scanD28MigrationText } from './check-p008-d28.mjs';

const validD28 = `
begin;
revoke execute on function ltc_m.current_actor_id(boolean) from public;
grant execute on function ltc_m.current_actor_id(boolean) to ltc_m_runtime;
commit;
`;

function withDirectory(files, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ltcm-d28-'));
  try {
    for (const [filename, sql] of Object.entries(files)) {
      fs.writeFileSync(path.join(directory, filename), sql, 'utf8');
    }
    callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('aceita exatamente a ACL forward mínima da D28', () => {
  assert.deepEqual(scanD28MigrationText(validD28), []);
});

test('exige assinatura completa e current_actor_id na allowlist', () => {
  const missingSignature = validD28.replaceAll('current_actor_id(boolean)', 'current_actor_id');
  const missingGrant = validD28.replace(
    'grant execute on function ltc_m.current_actor_id(boolean) to ltc_m_runtime;',
    'grant execute on function ltc_m.current_justification(boolean) to ltc_m_runtime;',
  );

  assert.notDeepEqual(scanD28MigrationText(missingSignature), []);
  assert.ok(scanD28MigrationText(missingGrant).some((issue) => issue.includes('exclusivamente')));
});

test('bloqueia ALL FUNCTIONS, PUBLIC, outros papéis, funções e DDL/DML', () => {
  const invalid = `${validD28}
grant execute on all functions in schema ltc_m to ltc_m_runtime;
grant execute on function ltc_m.current_actor_id(boolean) to public;
grant execute on function ltc_m.authorization_context() to attacker;
alter table ltc_m.clients add column forbidden text;
insert into ltc_m.clients (id) values ('00000000-0000-4000-8000-000000000001');`;
  const issues = scanD28MigrationText(invalid);

  assert.ok(issues.some((issue) => issue.includes('ALL FUNCTIONS')));
  assert.ok(issues.some((issue) => issue.includes('PUBLIC')));
  assert.ok(issues.some((issue) => issue.includes('ltc_m_runtime')));
  assert.ok(issues.some((issue) => issue.includes('DDL')));
  assert.ok(issues.some((issue) => issue.includes('DML')));
  assert.ok(issues.some((issue) => issue.includes('exatamente um REVOKE')));
});

test('aceita D28 e migrations posteriores arbitrárias', () => {
  withDirectory(
    {
      [D28_FILENAME]: validD28,
      '20990101000000_future_one.sql': 'create view ltc_m.future_one as select 1;',
      '20990101000001_future_two.sql': 'create view ltc_m.future_two as select 1;',
    },
    (directory) => {
      assert.deepEqual(checkD28Migrations(directory).issues, []);
    },
  );
});

test('rejeita ausência ou variação inválida do filename D28', () => {
  withDirectory({ '20260731120001_wrong_name.sql': validD28 }, (directory) => {
    const issues = checkD28Migrations(directory).issues;
    assert.ok(issues.some((issue) => issue.includes('migration D28 obrigatória ausente')));
  });
});

test('checkD28Migrations aceita somente o arquivo esperado', () => {
  withDirectory({ [D28_FILENAME]: validD28 }, (directory) => {
    assert.deepEqual(checkD28Migrations(directory).issues, []);
  });
});

test('aceita uma migration posterior sem allowlist de sucessoras', () => {
  withDirectory(
    {
      [D28_FILENAME]: validD28,
      '20260825160000_add_p016_tableau_analytical_views.sql':
        'create view ltc_m.v_tableau_example as select 1;',
    },
    (directory) => {
      assert.deepEqual(checkD28Migrations(directory).issues, []);
    },
  );
});
