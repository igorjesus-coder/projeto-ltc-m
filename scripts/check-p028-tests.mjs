import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const P028_PROJECT_ITEMS_LIFECYCLE_CONTRACT = 'ltcm.p028.project-items-lifecycle.v1';

const REQUIRED_FILES = [
  'apps/api/src/project-items/project-items.controller.ts',
  'apps/api/src/project-items/project-items.service.ts',
  'apps/api/src/project-items/project-items.types.ts',
  'apps/api/test/project-items.test.ts',
  'apps/web/src/routes/ProjectItemsGrid.tsx',
  'docs/projects/p028-item-stable-keys-soft-lifecycle.md',
];

function read(rootDirectory, relativePath) {
  const filename = path.join(rootDirectory, relativePath);
  return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
}

export function checkP028(rootDirectory = process.cwd()) {
  const issues = [];
  for (const relativePath of REQUIRED_FILES) {
    if (read(rootDirectory, relativePath) === null)
      issues.push(`P028_REQUIRED_FILE_MISSING:${relativePath}`);
  }

  const controller =
    read(rootDirectory, 'apps/api/src/project-items/project-items.controller.ts') ?? '';
  const service = read(rootDirectory, 'apps/api/src/project-items/project-items.service.ts') ?? '';
  const types = read(rootDirectory, 'apps/api/src/project-items/project-items.types.ts') ?? '';
  const grid = read(rootDirectory, 'apps/web/src/routes/ProjectItemsGrid.tsx') ?? '';
  const docs = read(rootDirectory, 'docs/projects/p028-item-stable-keys-soft-lifecycle.md') ?? '';
  const implementation = `${controller}\n${service}\n${types}\n${grid}`;

  for (const marker of [
    P028_PROJECT_ITEMS_LIFECYCLE_CONTRACT,
    'parseProjectItemReactivatePayload',
    "@Post(':itemId/reactivate')",
    "@RequireCapabilities('soft_delete:restore')",
    'async reactivate',
    'active = true',
    'active = false',
    'expectedVersion',
    'source_line_key',
    'line_number',
    'actorTransaction',
  ]) {
    if (!implementation.includes(marker) && !docs.includes(marker))
      issues.push(`P028_MARKER_MISSING:${marker}`);
  }

  for (const marker of [
    'manual:${randomUUID()}',
    'soft_delete:restore',
    '/reactivate',
    'Reativar',
  ]) {
    if (!grid.includes(marker) && !service.includes(marker) && !docs.includes(marker))
      issues.push(`P028_UI_MARKER_MISSING:${marker}`);
  }

  for (const forbidden of [/delete\s+from/iu, /supabase\s+auth/iu, /VITE_DATABASE_URL/iu]) {
    if (forbidden.test(implementation)) issues.push(`P028_FORBIDDEN_MARKER_FOUND:${forbidden}`);
  }

  if (!docs.includes('Não existe endpoint HTTP `DELETE`'))
    issues.push('P028_PHYSICAL_DELETE_BOUNDARY_MISSING');
  if (!docs.includes('nenhuma migration P028 foi criada'))
    issues.push('P028_MIGRATION_BOUNDARY_MISSING');

  const migrationsDirectory = path.join(rootDirectory, 'supabase/migrations');
  const migrations = fs.existsSync(migrationsDirectory)
    ? fs.readdirSync(migrationsDirectory).filter((name) => /p028/iu.test(name))
    : [];
  if (migrations.length > 0) issues.push('P028_UNEXPECTED_MIGRATION');
  return [...new Set(issues)].sort();
}

function main() {
  const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
  const issues = checkP028(rootDirectory);
  if (issues.length > 0) {
    console.error(`P028 inválido:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`P028 válido: ${P028_PROJECT_ITEMS_LIFECYCLE_CONTRACT}, sem migration`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
