import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(...parts) {
  return readFile(path.join(root, ...parts), 'utf8');
}

export function scanP031Sources(input) {
  const issues = [];
  const required = [
    ['decisions', input.documentation, 'P031-D01-DEC-01'],
    ['archive decision', input.documentation, 'P031-D01-DEC-02'],
    ['lineage decision', input.documentation, 'P031-D01-DEC-03'],
    ['baseline reference', input.migration, 'baseline_plan_version_id'],
    ['archive function', input.migration, 'archive_plan_version'],
    ['archive ACL', input.migration, 'workflow_action'],
    ['row version SQL guard', input.migration, 'p_expected_row_version'],
    ['submit endpoint', input.controller, '/submit'],
    ['return endpoint', input.controller, '/return'],
    ['approve endpoint', input.controller, '/approve'],
    ['lock endpoint', input.controller, '/lock'],
    ['archive endpoint', input.controller, '/archive'],
    ['reopen endpoint', input.controller, '/reopen'],
    ['workflow service', input.service, 'expectedRowVersion'],
    ['explicit SQL dispatch', input.service, 'submit_plan_version'],
    ['content concurrency separation', input.service, 'content_revision'],
    ['archive capability', input.auth, "'workflow:archive'"],
    ['archive UI capability', input.webAuth, "'workflow:archive'"],
    ['workflow UI', input.page, 'planningWorkflowActions'],
    ['history UI', input.page, 'Histórico e linhagem'],
    ['P031 parser tests', input.apiTests, 'P031_EXPECTED_ROW_VERSION_INVALID'],
    ['P031 workflow tests', input.apiTests, 'P031_VERSION_CONFLICT'],
    ['P031 web tests', input.webTests, 'planningWorkflowActions'],
    ['PostgreSQL harness', input.postgres, 'P031 PostgreSQL'],
    ['baseline harness assertion', input.postgres, 'baselinePlanVersionId'],
    ['rollback harness assertion', input.postgres, 'rollback'],
    ['CI invocation', input.workflow, 'LTCM_P031_INTEGRATION'],
  ];
  for (const [label, source, token] of required) {
    if (!source.includes(token)) issues.push(`${label} ausente`);
  }
  if (input.auth.includes("UNSUPPORTED_OPERATIONS = ['physical_delete', 'archive'")) {
    issues.push('archive continua marcada como operação unsupported');
  }
  if (/\bPATCH\b/iu.test(input.controller)) issues.push('workflow expõe PATCH genérico');
  if (/\bdelete\s+from\b/iu.test(input.service)) issues.push('workflow contém DELETE');
  if (input.migrationFiles.filter((name) => /p031/iu.test(name)).length !== 1) {
    issues.push('P031 deve possuir uma única migration forward');
  }
  return [...new Set(issues)].sort();
}

export async function checkP031() {
  return scanP031Sources({
    documentation: await read('docs', 'planning', 'p031-version-approval-locking.md'),
    migration: await read(
      'supabase',
      'migrations',
      '20260903120000_add_p031_version_approval_locking.sql',
    ),
    migrationFiles: await readdir(path.join(root, 'supabase', 'migrations')),
    controller: await read('apps', 'api', 'src', 'planning', 'planning.controller.ts'),
    service: await read('apps', 'api', 'src', 'planning', 'planning.service.ts'),
    auth: await read('apps', 'api', 'src', 'auth', 'authorization.ts'),
    webAuth: await read('apps', 'web', 'src', 'auth', 'authorization.tsx'),
    page: await read('apps', 'web', 'src', 'routes', 'MonthlyPlanningPage.tsx'),
    apiTests: await read('apps', 'api', 'test', 'planning.test.ts'),
    webTests: await read('apps', 'web', 'src', 'planning', 'planning.test.ts'),
    postgres: await read('scripts', 'p031-postgres.integration.test.mjs'),
    workflow: await read('.github', 'workflows', 'ltcm-postgres-validation.yml'),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = await checkP031();
  if (issues.length) {
    console.error(`P031 inválido:\n- ${issues.join('\n- ')}`);
    process.exitCode = 1;
  } else console.log('P031 válido: workflow, linhagem, ACL e evidências reconciliados');
}
