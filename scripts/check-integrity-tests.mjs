import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { stripSeedNoise } from './check-seeds.mjs';

const ALLOWED_INSERT_TABLES = new Set([
  'ltc_m.app_users',
  'ltc_m.clients',
  'ltc_m.projects',
  'ltc_m.project_items',
  'ltc_m.plan_versions',
  'ltc_m.financial_plan_scopes',
  'ltc_m.financial_plan_lines',
  'ltc_m.financial_actual_events',
]);

const REQUIRED_SCENARIOS = [
  ['auth_subject duplicado', /auth_subject duplicado foi aceito/i],
  ['código de projeto duplicado', /código de projeto duplicado foi aceito/i],
  ['item com moeda divergente', /item com moeda diferente do projeto foi aceito/i],
  ['planejamento de item sem item', /planejamento de item sem item foi aceito/i],
  ['planejamento de projeto com item', /planejamento de projeto com item foi aceito/i],
  ['evento com item de outro projeto', /evento com item de outro projeto foi aceito/i],
  ['competência mensal inválida', /competência fora do primeiro dia foi aceita/i],
  ['FK órfã', /FK órfã foi aceita/i],
  ['datas inválidas', /data final anterior à inicial foi aceita/i],
];

export function scanIntegrityTestText(sql) {
  const issues = [];
  const stripped = stripSeedNoise(sql);

  if (!stripped.replace(/[\s;]+/g, '')) issues.push('teste SQL vazio');
  if (!/^\s*begin\s*;/i.test(stripped)) issues.push('transação inicial ausente');
  if ((stripped.match(/\brollback\s*;/gi) ?? []).length !== 1) {
    issues.push('deve existir exatamente um ROLLBACK');
  }
  if (/\bcommit\s*;/i.test(stripped)) issues.push('COMMIT proibido em teste de integridade');

  for (const [pattern, message] of [
    [/\bdelete\b/i, 'DELETE proibido'],
    [/\btruncate\b/i, 'TRUNCATE proibido'],
    [/\bdrop\b/i, 'DROP proibido'],
    [/\balter\b/i, 'ALTER proibido'],
    [/\bupdate\b/i, 'UPDATE proibido'],
    [/\bmerge\b/i, 'MERGE proibido'],
    [/\bcreate\b/i, 'CREATE proibido'],
    [/\bexecute\b/i, 'SQL dinâmico proibido'],
  ]) {
    if (pattern.test(stripped)) issues.push(message);
  }

  for (const match of stripped.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
    if (match[1].toLowerCase() !== 'ltc_m') {
      issues.push('referência a schema fora de ltc_m');
    }
  }

  for (const match of stripped.matchAll(
    /\binsert\s+into\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi,
  )) {
    if (!ALLOWED_INSERT_TABLES.has(match[1].toLowerCase())) {
      issues.push('INSERT em tabela não aprovada para o teste');
    }
  }

  if (/\binsert\s+into\s+ltc_m\.(?:currencies|units)\b/i.test(stripped)) {
    issues.push('valores controlados não podem ser modificados');
  }
  if (!/\brollback\s*;[\s\S]*?select\b/i.test(stripped)) {
    issues.push('verificação pós-rollback ausente');
  }

  for (const [name, pattern] of REQUIRED_SCENARIOS) {
    if (!pattern.test(sql)) issues.push(`cenário ausente: ${name}`);
  }

  return [...new Set(issues)];
}

function main() {
  const testPath = path.resolve(
    process.cwd(),
    process.argv[2] ?? path.join('database', 'audit', 'ltcm-integrity-tests.sql'),
  );
  let sql;
  try {
    sql = fs.readFileSync(testPath, 'utf8');
  } catch {
    console.error('Falha de integridade: arquivo de teste não encontrado ou ilegível');
    process.exitCode = 1;
    return;
  }

  const issues = scanIntegrityTestText(sql);
  if (issues.length > 0) {
    console.error(
      `Validação do teste de integridade falhou:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('Teste de integridade válido: transacional e restrito a ltc_m');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
