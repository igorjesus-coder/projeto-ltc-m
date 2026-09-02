import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const P027_PROJECT_ITEMS_CONTRACT = 'ltcm.p027.project-items-crud.v1';

const REQUIRED_FILES = [
  'apps/api/src/project-items/project-items.controller.ts',
  'apps/api/src/project-items/project-items.module.ts',
  'apps/api/src/project-items/project-items.service.ts',
  'apps/api/src/project-items/project-items.types.ts',
  'apps/api/test/project-items.test.ts',
  'apps/web/src/projects/project-items.ts',
  'apps/web/src/routes/ProjectItemsGrid.tsx',
  'apps/web/src/projects/project-items.test.ts',
  'docs/projects/p027-project-items-crud.md',
];

function read(rootDirectory, relativePath) {
  const filename = path.join(rootDirectory, relativePath);
  return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
}

export function checkP027(rootDirectory = process.cwd()) {
  const issues = [];
  for (const relativePath of REQUIRED_FILES) {
    if (read(rootDirectory, relativePath) === null)
      issues.push(`P027_REQUIRED_FILE_MISSING:${relativePath}`);
  }

  const controller =
    read(rootDirectory, 'apps/api/src/project-items/project-items.controller.ts') ?? '';
  const module = read(rootDirectory, 'apps/api/src/project-items/project-items.module.ts') ?? '';
  const service = read(rootDirectory, 'apps/api/src/project-items/project-items.service.ts') ?? '';
  const apiTypes = read(rootDirectory, 'apps/api/src/project-items/project-items.types.ts') ?? '';
  const webTypes = read(rootDirectory, 'apps/web/src/projects/project-items.ts') ?? '';
  const grid = read(rootDirectory, 'apps/web/src/routes/ProjectItemsGrid.tsx') ?? '';
  const docs = read(rootDirectory, 'docs/projects/p027-project-items-crud.md') ?? '';

  for (const marker of [
    P027_PROJECT_ITEMS_CONTRACT,
    'ProjectItemsModule',
    "@Controller('projects/:projectId/items')",
    '@Get()',
    '@Post()',
    "@Patch(':itemId')",
    "@Post(':itemId/duplicate')",
    "@Post(':itemId/inactivate')",
    "@RequireCapabilities('record:create')",
    "@RequireCapabilities('record:edit_draft')",
    "@RequireCapabilities('soft_delete:execute')",
  ]) {
    if (!controller.includes(marker) && !apiTypes.includes(marker) && !module.includes(marker)) {
      issues.push(`P027_API_MARKER_MISSING:${marker}`);
    }
  }

  for (const marker of [
    'actorTransaction',
    'ltc_m.project_items',
    'row_version',
    'expectedVersion',
    'source_line_key',
    'round',
    'active = false',
    'for update',
  ]) {
    if (!service.includes(marker) && !apiTypes.includes(marker) && !docs.includes(marker)) {
      issues.push(`P027_SERVICE_MARKER_MISSING:${marker}`);
    }
  }

  for (const marker of [
    'parseProjectItemsResponse',
    'ProjectItemsGrid',
    '/duplicate',
    '/inactivate',
    'formatProjectItemMoney',
    'record:create',
    'record:edit_draft',
    'soft_delete:execute',
    'expectedVersion',
  ]) {
    if (!grid.includes(marker) && !webTypes.includes(marker))
      issues.push(`P027_WEB_MARKER_MISSING:${marker}`);
  }

  for (const forbidden of [
    /delete\s+from/iu,
    /exchange\s*rate/iu,
    /supabase\s+auth/iu,
    /VITE_DATABASE_URL/iu,
  ]) {
    if (forbidden.test(`${controller}\n${service}\n${apiTypes}\n${grid}\n${webTypes}`)) {
      issues.push(`P027_FORBIDDEN_MARKER_FOUND:${forbidden}`);
    }
  }

  if (!docs.includes(P027_PROJECT_ITEMS_CONTRACT))
    issues.push('P027_DOCUMENTATION_CONTRACT_MISSING');
  if (
    !docs.includes('Não existe endpoint HTTP DELETE') ||
    !docs.includes('Nenhuma migration foi criada')
  ) {
    issues.push('P027_DOCUMENTATION_BOUNDARY_MISSING');
  }

  const migrations = fs.existsSync(path.join(rootDirectory, 'supabase/migrations'))
    ? fs
        .readdirSync(path.join(rootDirectory, 'supabase/migrations'))
        .filter((name) => /p027/iu.test(name))
    : [];
  if (migrations.length > 0) issues.push('P027_UNEXPECTED_MIGRATION');
  return [...new Set(issues)].sort();
}

function main() {
  const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
  const issues = checkP027(rootDirectory);
  if (issues.length > 0) {
    console.error(`P027 invÃ¡lido:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`P027 vÃ¡lido: ${P027_PROJECT_ITEMS_CONTRACT}, sem migration`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
