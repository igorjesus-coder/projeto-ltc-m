import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { assertP026MigrationInventory, P026_MIGRATION_COUNT } from './p026-migration-inventory.mjs';

const migration = fs.readFileSync(
  new URL(
    '../supabase/migrations/20260901100000_add_p026_master_data_management.sql',
    import.meta.url,
  ),
  'utf8',
);
const auditFixMigration = fs.readFileSync(
  new URL(
    '../supabase/migrations/20260902100000_fix_p026_catalog_audit_identity.sql',
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

test('P026-D21 usa identidade explícita nos catálogos e falha fechado', () => {
  assert.match(auditFixMigration, /tg_nargs/iu);
  assert.match(auditFixMigration, /tg_argv/iu);
  assert.match(auditFixMigration, /when tg_nargs = 0 then 'id'/iu);
  assert.match(auditFixMigration, /v_new_data \? v_identity_column/iu);
  assert.match(auditFixMigration, /audit_row_change\('code'\)/giu);
  assert.match(auditFixMigration, /record_id[\s\S]*v_record_id/iu);
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

test('P026 from-zero rejeita inventário stale e aceita o inventário atual', () => {
  assert.doesNotThrow(() =>
    assertP026MigrationInventory(Array(P026_MIGRATION_COUNT).fill('migration')),
  );
  assert.throws(
    () => assertP026MigrationInventory(Array(P026_MIGRATION_COUNT - 1).fill('migration')),
    /P026_MIGRATION_INVENTORY_UNEXPECTED/u,
  );
});
