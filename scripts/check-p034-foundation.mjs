import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const P034_MIGRATION = '20260910100000_add_p034_provenance_foundation.sql';
export const P034_CONTRACT_SHA256 =
  '3e1fc135c61634e759210e718ce04785de38e6be3b2c409468288df1d7a73117';
export const P034_DESIGN_SHA256 =
  '59d387ed655093d05a2f9d2ababf0eecd05bbadc057b6d2a335ade9f5c986eee';

const TABLES = [
  'p034_provenance_snapshots',
  'p034_provenance_project_observations',
  'p034_provenance_item_observations',
  'p034_provenance_source_references',
];
const FUNCTIONS = [
  'p034_provenance_reject_update',
  'p034_provenance_reject_delete',
  'p034_provenance_source_hash_matches_batch',
  'p034_provenance_context_guard',
  'p034_project_observation_reference_guard',
  'p034_item_observation_reference_guard',
];

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const has = (source, pattern) => pattern.test(source);

export function validateP034Sources({ migration, migrationNames, contract, design }) {
  const issues = [];
  const normalized = migration.replace(/\s+/gu, ' ').trim().toLowerCase();
  const tableCreates = [...migration.matchAll(/\bcreate table\s+ltc_m\.([a-z0-9_]+)/giu)].map(
    (match) => match[1].toLowerCase(),
  );
  const functionCreates = [...migration.matchAll(/\bcreate function\s+ltc_m\.([a-z0-9_]+)/giu)].map(
    (match) => match[1].toLowerCase(),
  );

  if (migrationNames.filter((name) => /p034/iu.test(name)).length !== 1) {
    issues.push('P034 deve possuir exatamente uma migration forward');
  }
  if (!migrationNames.includes(P034_MIGRATION)) issues.push('migration P034 ausente');
  if (
    tableCreates.length !== TABLES.length ||
    TABLES.some((table) => !tableCreates.includes(table))
  ) {
    issues.push('P034 deve criar exatamente as quatro tabelas aprovadas');
  }
  if (/qualityfinding|receipt_actual|staging|import_duplication/iu.test(migration)) {
    issues.push('P034 contém escopo de findings, realizados, staging ou duplicação');
  }
  if (
    !normalized.includes(
      'create role ltc_m_provenance_writer nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;',
    )
  ) {
    issues.push('capability writer não possui o perfil aprovado');
  }
  if (
    /\b(?:create user|create login|alter role|drop role)\b|\bpassword\s*(?:=|')/iu.test(migration)
  ) {
    issues.push('migration não pode provisionar login, password ou lifecycle de role');
  }
  for (const table of TABLES) {
    if (
      !has(
        migration,
        new RegExp(
          `alter\\s+table\\s+ltc_m\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
          'iu',
        ),
      )
    ) {
      issues.push(`${table} sem ENABLE RLS`);
    }
    if (
      !has(
        migration,
        new RegExp(`alter\\s+table\\s+ltc_m\\.${table}\\s+force\\s+row\\s+level\\s+security`, 'iu'),
      )
    ) {
      issues.push(`${table} sem FORCE RLS`);
    }
    if (
      !has(
        migration,
        new RegExp(`revoke\\s+all\\s+privileges\\s+on\\s+ltc_m\\.${table}\\s+from\\s+public`, 'iu'),
      )
    ) {
      issues.push(`${table} sem REVOKE ALL de PUBLIC`);
    }
  }
  for (const functionName of FUNCTIONS) {
    if (!has(migration, new RegExp(`create\\s+function\\s+ltc_m\\.${functionName}\\b`, 'iu'))) {
      issues.push(`função P034 ausente: ${functionName}`);
    }
  }
  if (
    [...migration.matchAll(/\bcreate function\b[\s\S]*?\$function\$/giu)].some(
      (match) =>
        !/security invoker\b/iu.test(match[0]) || !/set search_path\s*=\s*''/iu.test(match[0]),
    )
  ) {
    issues.push('função P034 sem SECURITY INVOKER e search_path vazio');
  }
  if (!/\bcreate constraint trigger\b[\s\S]*?deferrable initially deferred/iu.test(migration)) {
    issues.push('cardinalidade de referência P034 não é diferível');
  }
  if (!/source_hash_matches_batch|source artifact hash does not match/iu.test(migration)) {
    issues.push('guard de hash da fonte ausente');
  }
  if (!/p034_provenance_context_guard|current_actor_id\(true\)/iu.test(migration)) {
    issues.push('guard de contexto do ator ausente');
  }
  if (!/grant\s+select,\s*insert\s+on[\s\S]*?to\s+ltc_m_provenance_writer/iu.test(migration)) {
    issues.push('capability writer sem SELECT/INSERT restrito');
  }
  if (!/grant\s+select\s+on[\s\S]*?to\s+ltc_m_runtime/iu.test(migration)) {
    issues.push('runtime sem SELECT explícito');
  }
  if (/grant[\s\S]*?\b(?:update|delete|truncate|references|trigger|create)\b/iu.test(migration)) {
    issues.push('migration concede privilégio de mutação ou delegação');
  }
  if (contract && sha256(contract) !== P034_CONTRACT_SHA256)
    issues.push('fingerprint do contrato divergente');
  if (design && sha256(design).toLowerCase() !== P034_DESIGN_SHA256)
    issues.push('fingerprint do design divergente');
  if (functionCreates.length !== FUNCTIONS.length)
    issues.push('P034 criou função fora do conjunto aprovado');
  return [...new Set(issues)].sort();
}

export async function checkP034(rootDirectory = root) {
  const migrationDirectory = path.join(rootDirectory, 'supabase', 'migrations');
  const migrationNames = (await readdir(migrationDirectory)).filter((name) =>
    name.endsWith('.sql'),
  );
  return validateP034Sources({
    migration: await readFile(path.join(migrationDirectory, P034_MIGRATION), 'utf8'),
    migrationNames,
    contract: await readFile(
      path.join(rootDirectory, 'docs', 'quality', 'p034-data-quality-center.md'),
      'utf8',
    ),
    design: await readFile(
      path.join(rootDirectory, 'docs', 'quality', 'p034-provenance-ddl-design.md'),
      'utf8',
    ),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = await checkP034();
  if (issues.length) {
    console.error(`P034 inválido:\n- ${issues.join('\n- ')}`);
    process.exitCode = 1;
  } else console.log('P034 foundation válido: DDL, ACL, RLS, guards e fingerprints reconciliados');
}
