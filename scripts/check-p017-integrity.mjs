import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createSnapshot,
  renderedDocuments,
  serializeSnapshot,
} from './generate-p017-schema-docs.mjs';
import { P016_VIEW_CONTRACTS } from './p017-schema-model.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

export function validateP017Sources({
  snapshot,
  migrationNames,
  documents,
  rootPackage,
  runner,
  integration,
  readme,
}) {
  const issues = [];
  const expectedSnapshot = createSnapshot(snapshot.model, snapshot.migrationCount);
  if (serializeSnapshot(snapshot) !== serializeSnapshot(expectedSnapshot)) {
    issues.push('snapshot canônico/fingerprint divergente');
  }
  if (migrationNames.length !== snapshot.migrationCount) {
    issues.push(
      `inventário de migrations divergente: atual=${migrationNames.length}, nominal=${snapshot.migrationCount}`,
    );
  }
  if (new Set(migrationNames.map((name) => name.slice(0, 14))).size !== migrationNames.length) {
    issues.push('ordem de migration contém timestamp duplicado');
  }
  if (migrationNames.some((name) => /p017/iu.test(name))) {
    issues.push('P017 introduziu migration sem necessidade de schema');
  }

  const relations = snapshot.model.relations;
  const tables = relations.filter((relation) => relation.kind === 'table');
  const views = relations.filter((relation) => relation.kind === 'view');
  if (tables.length !== 19) issues.push(`inventário P008 de tabelas divergente: ${tables.length}`);
  if (views.length !== 9) issues.push(`inventário P016 de views divergente: ${views.length}`);
  if (snapshot.model.policies.length !== 49) {
    issues.push(`inventário P008 de policies divergente: ${snapshot.model.policies.length}`);
  }
  if (tables.some((table) => !table.rowSecurity || !table.forceRowSecurity)) {
    issues.push('RLS/FORCE RLS divergente em tabela protegida');
  }

  const relationByName = new Map(relations.map((relation) => [relation.name, relation]));
  if (relationByName.size !== relations.length) issues.push('relação duplicada no modelo canônico');
  for (const constraint of snapshot.model.constraints) {
    const relation = relationByName.get(constraint.table);
    if (!relation) {
      issues.push(`constraint aponta para relação ausente: ${constraint.name}`);
      continue;
    }
    const columns = new Set(relation.columns.map((column) => column.name));
    if (constraint.columns.some((column) => !columns.has(column))) {
      issues.push(`constraint aponta para coluna ausente: ${constraint.name}`);
    }
    if (
      constraint.type === 'foreign_key' &&
      (constraint.referencedSchema !== 'ltc_m' || !relationByName.has(constraint.referencedTable))
    ) {
      issues.push(`FK fora do modelo ltc_m: ${constraint.name}`);
    }
  }

  for (const viewName of Object.keys(P016_VIEW_CONTRACTS)) {
    const view = relationByName.get(viewName);
    if (!view || view.kind !== 'view') {
      issues.push(`view P016 ausente: ${viewName}`);
      continue;
    }
    for (const option of ['security_invoker=true', 'security_barrier=true']) {
      if (!view.options.includes(option)) issues.push(`${viewName} sem ${option}`);
    }
    if (
      !snapshot.model.grants.some(
        (grant) =>
          grant.object === viewName &&
          grant.grantee === 'ltc_m_runtime' &&
          grant.privilege === 'SELECT',
      )
    ) {
      issues.push(`${viewName} sem SELECT de ltc_m_runtime`);
    }
    if (
      snapshot.model.grants.some((grant) => grant.object === viewName && grant.grantee === 'PUBLIC')
    ) {
      issues.push(`${viewName} exposta a PUBLIC`);
    }
  }

  const expectedDocuments = [...renderedDocuments(snapshot).entries()];
  for (const [filename, expected] of expectedDocuments) {
    const name = path.basename(filename);
    if (documents[name] !== expected) issues.push(`documentação gerada divergente: ${name}`);
  }

  for (const token of [
    '"p017:check"',
    '"test:p017:static"',
    '"test:p017:postgres"',
    '"docs:schema:generate"',
    '"docs:schema:check"',
  ]) {
    if (!rootPackage.includes(token)) issues.push(`script raiz P017 ausente: ${token}`);
  }
  if (
    !rootPackage.includes('npm run p017:check') ||
    !rootPackage.includes('npm run test:p017:static')
  ) {
    issues.push('P017 não integra check/test raiz');
  }
  for (const token of [
    "runStage('p017_postgres'",
    "LTCM_P017_INTEGRATION: '1'",
    "LTCM_P017_ISOLATED_CLUSTER: '1'",
    'postgres-p017-integrity.integration.test.mjs',
    'p017_postgres: false',
    'evidence.regressions.p017_postgres = true',
  ]) {
    if (!runner.includes(token)) issues.push(`runner CI P017 ausente: ${token}`);
  }
  for (const token of [
    'P017_INTEGRATION',
    'MIGRATION_FROM_ZERO',
    'createSnapshot',
    'assertNoLogicalDuplicates',
    'security_invoker=true',
    '23503',
    '23514',
    '23505',
    'advisory',
  ]) {
    if (!integration.includes(token)) issues.push(`acceptance PostgreSQL P017 ausente: ${token}`);
  }
  if (integration.includes('.local-source') || integration.includes('supabase.com')) {
    issues.push('acceptance P017 contém dependência externa proibida');
  }
  for (const token of ['ltcm.p017.schema-integrity.v1', 'docs:schema:check', 'PostgreSQL 17']) {
    if (!readme.includes(token)) issues.push(`README P017 ausente: ${token}`);
  }
  return [...new Set(issues)];
}

export async function officialP017Sources(directory = root) {
  const migrationDirectory = path.join(directory, 'supabase', 'migrations');
  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const snapshot = JSON.parse(
    await readFile(path.join(directory, 'docs', 'database', 'p017-schema-model.json'), 'utf8'),
  );
  const documentNames = ['erd.md', 'data-dictionary.md', 'p017-integrity-validation.md'];
  const documents = Object.fromEntries(
    await Promise.all(
      documentNames.map(async (name) => [
        name,
        await readFile(path.join(directory, 'docs', 'database', name), 'utf8'),
      ]),
    ),
  );
  return {
    snapshot,
    migrationNames,
    documents,
    rootPackage: await readFile(path.join(directory, 'package.json'), 'utf8'),
    runner: await readFile(
      path.join(directory, 'scripts', 'run-postgres-ci-validation.mjs'),
      'utf8',
    ),
    integration: await readFile(
      path.join(directory, 'scripts', 'postgres-p017-integrity.integration.test.mjs'),
      'utf8',
    ),
    readme: await readFile(path.join(directory, 'README.md'), 'utf8'),
  };
}

async function main() {
  try {
    const issues = validateP017Sources(await officialP017Sources());
    if (issues.length > 0) {
      console.error(`P017 inválido:\n- ${issues.join('\n- ')}`);
      process.exitCode = 1;
      return;
    }
    console.log('P017 válido: schema, fingerprint, RLS, ERD, dicionário e CI reconciliados');
  } catch {
    console.error('P017_CHECK_FAILED');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
