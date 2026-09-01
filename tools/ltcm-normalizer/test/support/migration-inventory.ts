import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const ADMIN_BOOTSTRAP_MIGRATION = '20260731103000_add_ltcm_audit_read_event.sql';

const MIGRATION_FILENAME = /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/u;

export const P012_MIGRATION_BASELINE = [
  '20260729163000_create_ltcm_relational_core.sql',
  '20260730103002_add_ltcm_core_query_indexes.sql',
  '20260730144303_add_ltcm_workflow_enum_values.sql',
  '20260730144304_add_ltcm_versioning_audit_workflow.sql',
  '20260730155749_fix_ltcm_workflow_guard_fail_closed.sql',
  '20260730163419_fix_ltcm_admin_inactivation_columns.sql',
  ADMIN_BOOTSTRAP_MIGRATION,
  '20260731103001_add_ltcm_runtime_rls_security.sql',
  '20260731120000_fix_ltcm_runtime_function_acl.sql',
  '20260731130000_add_ltcm_import_staging.sql',
  '20260804120000_add_legacy_project_reference_date_exception.sql',
] as const;

export const P013_MIGRATION_BASELINE = [
  ...P012_MIGRATION_BASELINE,
  '20260820120000_add_p013_monthly_baseline_foundation.sql',
] as const;

export const P016_MIGRATION_BASELINE = [
  ...P013_MIGRATION_BASELINE,
  '20260825160000_add_p016_tableau_analytical_views.sql',
] as const;

export type MigrationFile = { name: string; sql: string };

function compareMigrationNames(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

export function validateMigrationNames(
  names: readonly string[],
  requiredBaseline: readonly string[],
): string[] {
  const invalidName = names.find((name) => !MIGRATION_FILENAME.test(name));
  assert.equal(invalidName, undefined, `nome de migration inválido: ${invalidName ?? ''}`);

  const sortedNames = [...names].sort(compareMigrationNames);
  assert.deepEqual(names, sortedNames, 'migrations fora da ordem canônica');

  const timestamps = names.map((name) => name.slice(0, 14));
  assert.equal(new Set(timestamps).size, timestamps.length, 'timestamp de migration duplicado');

  for (const requiredMigration of requiredBaseline) {
    assert.ok(
      names.includes(requiredMigration),
      `migration histórica obrigatória ausente: ${requiredMigration}`,
    );
  }

  return sortedNames;
}

export async function readMigrationInventory(
  directory: string,
  requiredBaseline: readonly string[],
): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort(compareMigrationNames);
  const canonicalNames = validateMigrationNames(names, requiredBaseline);
  return Promise.all(
    canonicalNames.map(async (name) => ({
      name,
      sql: await readFile(path.join(directory, name), 'utf8'),
    })),
  );
}
