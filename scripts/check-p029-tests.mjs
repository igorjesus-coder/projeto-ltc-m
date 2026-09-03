import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function read(...parts) {
  return readFile(path.join(root, ...parts), 'utf8');
}

export async function scanP029Sources(input) {
  const issues = [];
  const required = [
    ['contract', input.types, 'ltcm.p029.monthly-planning-editor.v1'],
    ['batch route', input.controller, '@Put'],
    ['capability guard', input.controller, "'forecast:edit_draft'"],
    ['actor transaction', input.service, 'actorTransaction'],
    ['optimistic lock', input.service, 'for update'],
    ['natural upsert', input.service, 'on conflict'],
    ['content revision', input.service, 'content_revision = content_revision + 1'],
    ['financial line write', input.service, 'insert into ltc_m.financial_plan_lines'],
    ['web editor', input.page, 'MonthlyPlanningPage'],
    ['BigInt precision', input.webTypes, 'BigInt'],
    ['backend tests', input.apiTests, 'P029 save envia vários meses'],
    ['frontend tests', input.webTests, 'decimais sem erro binário'],
    ['documentation', input.documentation, 'P029 — editor de programação mensal'],
  ];
  for (const [label, source, token] of required)
    if (!source.includes(token)) issues.push(`${label} ausente`);
  if (
    input.migrationFiles.some(
      (file) =>
        /p029|monthly-planning/iu.test(file) &&
        file !== '20260903100000_add_p029_plan_content_revision.sql',
    )
  )
    issues.push('migration P029 indevida');
  return issues;
}

export async function checkP029() {
  return scanP029Sources({
    types: await read('apps', 'api', 'src', 'planning', 'planning.types.ts'),
    controller: await read('apps', 'api', 'src', 'planning', 'planning.controller.ts'),
    service: await read('apps', 'api', 'src', 'planning', 'planning.service.ts'),
    page: await read('apps', 'web', 'src', 'routes', 'MonthlyPlanningPage.tsx'),
    webTypes: await read('apps', 'web', 'src', 'planning', 'planning.ts'),
    apiTests: await read('apps', 'api', 'test', 'planning.test.ts'),
    webTests: await read('apps', 'web', 'src', 'planning', 'planning.test.ts'),
    documentation: await read('docs', 'planning', 'p029-monthly-planning-editor.md'),
    migrationFiles: ['20260903100000_add_p029_plan_content_revision.sql'],
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = await checkP029();
  if (issues.length) {
    console.error(`P029 inválido:\n- ${issues.join('\n- ')}`);
    process.exitCode = 1;
  } else
    console.log('P029 válido: editor mensal, batch atômico, concorrência e precisão protegidos');
}
