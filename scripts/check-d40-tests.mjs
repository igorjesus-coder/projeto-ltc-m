import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { scanMigrationText, stripSqlNoise } from './check-migrations.mjs';

export const D40_MIGRATION = '20260804120000_add_legacy_project_reference_date_exception.sql';
export const D40_HARNESS = 'database/audit/ltcm-d40-tests.sql';
export const SYNTHETIC_CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u;

const CURRENCY_INSERT_TARGET_PATTERN = /\binsert\s+into\s+ltc_m\.currencies\b/giu;
const CURRENCY_INSERT_PATTERN =
  /\binsert\s+into\s+ltc_m\.currencies\s*\(\s*code\s*,[^)]*\)\s*values\s*\(\s*'((?:''|[^'])*)'/giu;

const REQUIRED_SCENARIOS = [
  ['data sem lote', /Projeto novo com data e sem lote/iu],
  ['nulo sem lote', /Sem data e sem lote/iu],
  ['legado por Admin', /Admin ativo e contexto completo/iu],
  ['FK inexistente', /Lote inexistente/iu],
  ['Editor rejeitado', /Editor tentando criar exceção/iu],
  ['justificativa obrigatória', /Admin sem justificativa/iu],
  ['request obrigatório', /Admin sem request ID/iu],
  ['Admin inativo', /Admin inativo/iu],
  ['received aceito', /D40-RECEIVED/iu],
  ['validating aceito', /D40-VALIDATING/iu],
  ['loaded aceito', /D40-LOADED/iu],
  ['rejected negado', /lote rejected foi aceito/iu],
  ['data e lote', /Data\+lote exige Admin/iu],
  ['enriquecimento', /Enriquecimento sintético D40/iu],
  ['remoção negada', /linhagem foi removida/iu],
  ['correção de lote', /Correção sintética de lote D40/iu],
  ['linhagem preservada', /enriquecimento não preservou\/corrigiu a linhagem/iu],
  ['delete negado', /DELETE físico foi aceito/iu],
  ['P008/D24 preservados', /Viewer\/Editor\/Admin e D24 continuam/iu],
  ['auditoria contextual', /auditoria before\/after\/contexto incompleta/iu],
  ['rollback limpo', /rollback_clean/iu],
  ['escopo ltc_m', /não há mutação fora do schema/iu],
  ['D41 received sem vínculo', /d41-unlinked-received/iu],
  ['D41 validating sem vínculo', /d41-unlinked-validating/iu],
  ['D41 loaded sem vínculo', /d41-unlinked-loaded/iu],
  ['D41 received vinculado', /D40-RECEIVED/iu],
  ['D41 validating vinculado', /D40-VALIDATING/iu],
  ['D41 loaded vinculado', /D40-LOADED/iu],
  ['D41 data nula', /D41-MULTIPLE-B[\s\S]*?100, null/iu],
  ['D41 data preenchida', /D41-ACTIVE/iu],
  ['D41 draft', /D41-MULTIPLE-A/iu],
  ['D41 active', /Projeto sintético active/iu],
  ['D41 completed', /Projeto sintético completed/iu],
  ['D41 inactive real', /enum real não possui inactive/iu],
  ['D41 soft delete', /deleted_at is not null/iu],
  ['D41 múltiplos projetos', /D41-MULTIPLE-A[\s\S]*?D41-MULTIPLE-B/iu],
  ['D41 correção total', /d41-correct-all/iu],
  ['D41 correção parcial', /correção parcial liberou o lote antigo/iu],
  ['D41 limpeza negada', /limpeza de legacy_import_batch_id foi aceita/iu],
  ['D41 sem Admin', /correção sem Admin foi aceita/iu],
  ['D41 sem justificativa', /correção sem justificativa foi aceita/iu],
  ['D41 sem request', /correção sem request ID foi aceita/iu],
  ['D41 destino rejected', /correção para lote rejected foi aceita/iu],
  ['D41 auditoria', /auditoria before\/after da correção ausente/iu],
  ['D41 atomicidade lote', /rejeição bloqueada alterou o lote/iu],
  ['D41 atomicidade projeto', /rejeição bloqueada alterou projeto histórico/iu],
  ['D41 rollback', /rollback deixou fixture permanente/iu],
];

export const D40_SCENARIO_COUNT = REQUIRED_SCENARIOS.length;

export function isValidSyntheticCurrencyCode(code) {
  return typeof code === 'string' && SYNTHETIC_CURRENCY_CODE_PATTERN.test(code);
}

export function extractSyntheticCurrencyCodes(sql) {
  return [...String(sql).matchAll(CURRENCY_INSERT_PATTERN)].map((match) =>
    match[1].replaceAll("''", "'"),
  );
}

export function scanSyntheticCurrencyFixtures(sql, { requireInsert = false } = {}) {
  const source = String(sql);
  const insertCount = (source.match(CURRENCY_INSERT_TARGET_PATTERN) ?? []).length;
  const codes = extractSyntheticCurrencyCodes(source);
  const issues = [];
  if (requireInsert && insertCount === 0) {
    issues.push('fixture monetária sintética ausente');
  }
  if (codes.length !== insertCount) {
    issues.push('INSERT de ltc_m.currencies fora do formato nominal autorizado');
  }
  for (const code of codes) {
    if (!isValidSyntheticCurrencyCode(code)) {
      issues.push(`código monetário sintético inválido: ${JSON.stringify(code)}`);
    }
  }
  return [...new Set(issues)];
}

export function scanD40HarnessText(sql) {
  const issues = [];
  issues.push(...scanSyntheticCurrencyFixtures(sql, { requireInsert: true }));
  const stripped = stripSqlNoise(sql);
  if ((stripped.match(/\bbegin\s*;/giu) ?? []).length !== 1) {
    issues.push('harness D40 deve conter um BEGIN');
  }
  if ((stripped.match(/\brollback\s*;/giu) ?? []).length !== 1) {
    issues.push('harness D40 deve conter um ROLLBACK');
  }
  if (/\bcommit\s*;/iu.test(stripped)) issues.push('COMMIT proibido no harness D40');
  if (/\b(?:create|alter|drop|truncate|copy)\b/iu.test(stripped)) {
    issues.push('DDL/COPY proibido no harness D40');
  }
  if (
    /\b(?:password|client_secret|private_key|connection_string|https?:\/\/|supabase)\b/iu.test(sql)
  ) {
    issues.push('rede ou credencial proibida no harness D40');
  }
  for (const match of stripped.matchAll(
    /\b(?:insert\s+into|update|delete\s+from)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/giu,
  )) {
    if (!match[1].toLowerCase().startsWith('ltc_m.')) {
      issues.push(`mutação fora de ltc_m: ${match[1]}`);
    }
  }
  for (const [label, pattern] of REQUIRED_SCENARIOS) {
    if (!pattern.test(sql)) issues.push(`cenário D40 ausente: ${label}`);
  }
  return [...new Set(issues)];
}

export function checkD40(rootDirectory = process.cwd()) {
  const migrationPath = path.join(rootDirectory, 'supabase', 'migrations', D40_MIGRATION);
  const harnessPath = path.join(rootDirectory, ...D40_HARNESS.split('/'));
  const issues = [];
  if (!fs.existsSync(migrationPath)) issues.push(`migration D40 ausente: ${D40_MIGRATION}`);
  else {
    issues.push(
      ...scanMigrationText(fs.readFileSync(migrationPath, 'utf8'), {
        migrationName: D40_MIGRATION,
      }),
    );
  }
  if (!fs.existsSync(harnessPath)) issues.push(`harness D40 ausente: ${D40_HARNESS}`);
  else issues.push(...scanD40HarnessText(fs.readFileSync(harnessPath, 'utf8')));
  return [...new Set(issues)];
}

function main() {
  const issues = checkD40();
  if (issues.length > 0) {
    console.error(`Validação D40 falhou:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log('D40/D41 válido: migration nominal e 47 cenários locais transacionais presentes');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) main();
