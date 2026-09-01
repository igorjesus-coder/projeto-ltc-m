import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL(
    '../supabase/migrations/20260901100000_add_p026_master_data_management.sql',
    import.meta.url,
  ),
  'utf8',
);
const controller = fs.readFileSync(
  new URL('../apps/api/src/master-data/master-data.controller.ts', import.meta.url),
  'utf8',
);
const service = fs.readFileSync(
  new URL('../apps/api/src/master-data/master-data.service.ts', import.meta.url),
  'utf8',
);

test('P026 corrige clients para admin-only e preserva RLS/FORCE sem DELETE', () => {
  assert.match(migration, /drop policy clients_insert on ltc_m\.clients/iu);
  assert.match(migration, /drop policy clients_update on ltc_m\.clients/iu);
  assert.match(migration, /create policy clients_insert[\s\S]*?app_role = 'admin'/iu);
  assert.match(migration, /create policy clients_update[\s\S]*?app_role = 'admin'/iu);
  assert.doesNotMatch(migration, /grant[\s\S]*delete/iu);
  assert.match(migration, /trg_90_(?:currencies|units)_audit/iu);
});

test('P026 backend tem guard administrativo, domínio fechado e concorrência', () => {
  assert.match(
    controller,
    /@UseGuards\(AuthorizationGuard\)[\s\S]*@RequireCapabilities\('catalog:manage'\)/u,
  );
  assert.match(service, /code in \('BRL', 'USD'\)/u);
  assert.match(service, /row_version = \$[0-9]+::bigint/u);
  assert.doesNotMatch(controller, /POST\('currencies'\)/u);
  assert.doesNotMatch(service, /delete\s+from/iu);
});
