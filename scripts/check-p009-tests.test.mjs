import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { checkP009, scanP009MigrationText, scanP009TestText } from './check-p009-tests.mjs';

test('aceita os artefatos P009 versionados', () => {
  assert.deepEqual(checkP009().issues, []);
});

test('rejeita tabela por aba, Excel e grant externo', () => {
  const issues = scanP009MigrationText(`
    create table public.staging_prev_receita (id uuid);
    create extension if not exists "xlsx";
    grant select on table ltc_m.import_staging_rows to attacker;
  `);
  assert.ok(issues.some((issue) => issue.includes('tabela duplicada')));
  assert.ok(issues.some((issue) => issue.includes('dependência de Excel')));
  assert.ok(issues.some((issue) => issue.includes('grant para papel')));
});

test('rejeita DROP INDEX fora da unicidade legada do hash do arquivo', () => {
  const issues = scanP009MigrationText('drop index ltc_m.other_index;');
  assert.ok(issues.some((issue) => issue.includes('DROP INDEX fora')));
});

test('rejeita teste P009 sem rollback ou com dados externos', () => {
  const issues = scanP009TestText(`
    begin;
    insert into public.clients values (1);
    commit;
  `);
  assert.ok(issues.some((issue) => issue.includes('ROLLBACK')));
  assert.ok(issues.some((issue) => issue.includes('COMMIT')));
  assert.ok(issues.some((issue) => issue.includes('fora do P009')));
});

test('rejeita fixtures P009 com aridade implicita ou estado ativo ausente', () => {
  const issues = scanP009TestText(`
    begin;
    insert into ltc_m.app_users (id, auth_subject, full_name, role)
    values ('00000000-0000-4000-8000-000000000001', 'test|viewer', 'Viewer', 'viewer');
    rollback;
    select true as rollback_clean;
  `);
  assert.ok(issues.some((issue) => issue.includes('estado ativo explicito')));
});

test('rejeita regressao do contexto D32 e ausencia da matriz configurado-auditado', () => {
  const official = fs.readFileSync('database/audit/ltcm-p009-staging-tests.sql', 'utf8');
  const withoutContext = official.replace('-- @p009-context batch:update editor', '');
  const withoutMatrix = official.replace("'request_contract'", "'removed_contract'");

  assert.ok(
    scanP009TestText(withoutContext).some((issue) => issue.includes('fluxo request D32 invalido')),
  );
  assert.ok(
    scanP009TestText(withoutMatrix).some((issue) =>
      issue.includes('matriz configurado-auditado D32 ausente'),
    ),
  );
});
