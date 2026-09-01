import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const APPROVED_CURRENCIES = Object.freeze([
  Object.freeze({ code: 'BRL', name: 'Real brasileiro', decimalPlaces: 2, active: true }),
  Object.freeze({ code: 'USD', name: 'Dólar americano', decimalPlaces: 2, active: true }),
]);

const APPROVED_UNIT = Object.freeze({
  code: 'US',
  name: 'Unidade e Serviço',
  category: null,
  active: true,
});

const ALLOWED_TABLES = new Set(['ltc_m.currencies', 'ltc_m.units']);
const FORBIDDEN_PATTERNS = [
  [/\bdelete\b/i, 'comando DELETE'],
  [/\btruncate\b/i, 'comando TRUNCATE'],
  [/\bdrop\b/i, 'comando DROP'],
  [/\balter\b/i, 'comando ALTER'],
  [/\bupdate\b/i, 'comando UPDATE'],
  [/\bmerge\b/i, 'comando MERGE'],
  [/\bcopy\b/i, 'comando COPY'],
  [/\bexecute\b/i, 'SQL dinâmico EXECUTE'],
  [/\bcreate\b/i, 'comando CREATE'],
  [/\bgrant\b/i, 'comando GRANT'],
  [/\brevoke\b/i, 'comando REVOKE'],
  [/\b(?:auth\.users|auth\.uid\s*\()/i, 'dependência de Supabase Auth'],
];

export function stripSeedNoise(sql) {
  let output = '';

  for (let index = 0; index < sql.length;) {
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index + 2);
      if (end < 0) break;
      output += '\n';
      index = end + 1;
      continue;
    }

    if (sql.startsWith('/*', index)) {
      const end = sql.indexOf('*/', index + 2);
      if (end < 0) {
        output += ' ';
        break;
      }
      output += sql.slice(index, end + 2).replace(/[^\r\n]/g, ' ');
      index = end + 2;
      continue;
    }

    if (sql[index] === "'") {
      output += "''";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
        } else if (sql[index] === "'") {
          index += 1;
          break;
        } else {
          if (sql[index] === '\n') output += '\n';
          index += 1;
        }
      }
      continue;
    }

    output += sql[index];
    index += 1;
  }

  return output;
}

function findInsertPayloads(sql, table, columns) {
  const escapedTable = table.replace('.', '\\.');
  const columnPattern = columns.join('\\s*,\\s*');
  const pattern = new RegExp(
    `\\binsert\\s+into\\s+${escapedTable}\\s*\\(\\s*${columnPattern}\\s*\\)\\s*select\\s+([^;]+)`,
    'gi',
  );
  return [...sql.matchAll(pattern)].map((match) => match[1]);
}

function requireTransactionAndLocks(sql, stripped, issues) {
  const beginMatches = [...stripped.matchAll(/\bbegin\s*;/gi)];
  const commitMatches = [...stripped.matchAll(/\bcommit\s*;/gi)];
  const firstInsert = stripped.search(/\binsert\s+into\b/i);
  const validationBlock = stripped.search(/\bdo\s+\$seed\$/i);

  if (beginMatches.length !== 1 || !/^\s*begin\s*;/i.test(stripped)) {
    issues.push('seed deve iniciar uma única transação explícita');
  }
  if (commitMatches.length !== 1 || !/\bcommit\s*;\s*$/i.test(stripped)) {
    issues.push('seed deve concluir uma única transação explícita');
  }
  if (
    !/\block\s+table\s+ltc_m\.currencies\s+in\s+share\s+row\s+exclusive\s+mode\s*;/i.test(stripped)
  ) {
    issues.push('lock transacional de ltc_m.currencies ausente');
  }
  if (!/\block\s+table\s+ltc_m\.units\s+in\s+share\s+row\s+exclusive\s+mode\s*;/i.test(stripped)) {
    issues.push('lock transacional de ltc_m.units ausente');
  }
  if (validationBlock < 0 || firstInsert < 0 || validationBlock > firstInsert) {
    issues.push('validação de divergências deve ocorrer antes das inserções');
  }

  const currencyDivergence =
    /from\s+ltc_m\.currencies[\s\S]*?code\s*=\s*'BRL'[\s\S]*?name\s+is\s+distinct\s+from\s+'Real brasileiro'[\s\S]*?decimal_places\s+is\s+distinct\s+from\s+2[\s\S]*?active\s+is\s+distinct\s+from\s+true/i;
  const unitDivergence =
    /from\s+ltc_m\.units[\s\S]*?code\s*=\s*'US'[\s\S]*?name\s+is\s+distinct\s+from\s+'Unidade e Serviço'[\s\S]*?category\s+is\s+not\s+null[\s\S]*?active\s+is\s+distinct\s+from\s+true/i;
  const usdDivergence =
    /from\s+ltc_m\.currencies[\s\S]*?code\s*=\s*'USD'[\s\S]*?name\s+is\s+distinct\s+from\s+'Dólar americano'[\s\S]*?decimal_places\s+is\s+distinct\s+from\s+2[\s\S]*?active\s+is\s+distinct\s+from\s+true/i;

  if (!currencyDivergence.test(sql)) {
    issues.push('validação completa de divergência de BRL ausente');
  }
  if (!usdDivergence.test(sql)) {
    issues.push('P026 USD divergence validation missing');
  }
  if (!unitDivergence.test(sql)) {
    issues.push('validação completa de divergência de US ausente');
  }
  if ((sql.match(/\braise\s+exception\b/gi) ?? []).length < 3) {
    issues.push('divergências de BRL, USD e US devem interromper a execução');
  }
}

function requireApprovedPayloads(sql, issues) {
  const currencyInserts = findInsertPayloads(sql, 'ltc_m.currencies', [
    'code',
    'name',
    'decimal_places',
    'active',
  ]);
  const unitInserts = findInsertPayloads(sql, 'ltc_m.units', ['code', 'name', 'active']);
  const allInsertTargets = [
    ...sql.matchAll(/\binsert\s+into\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi),
  ].map((match) => match[1].toLowerCase());

  if (currencyInserts.length !== 2) {
    issues.push('deve existir exatamente uma declaração de moeda');
  } else if (
    !/^\s*'BRL'\s*,\s*'Real brasileiro'\s*,\s*2\s*,\s*true\s+where\s+not\s+exists\s*\(\s*select\s+1\s+from\s+ltc_m\.currencies\s+where\s+code\s*=\s*'BRL'\s*\)\s*$/i.test(
      currencyInserts[0],
    )
  ) {
    issues.push('o payload da moeda BRL deve ser Real brasileiro, 2 casas e ativo');
  }

  if (
    !currencyInserts.some((payload) =>
      /^\s*'USD'\s*,\s*'Dólar americano'\s*,\s*2\s*,\s*true\s+where\s+not\s+exists\s*\(\s*select\s+1\s+from\s+ltc_m\.currencies\s+where\s+code\s*=\s*'USD'\s*\)\s*$/i.test(
        payload,
      ),
    )
  ) {
    issues.push('P026 seed USD payload invalid');
  }

  if (unitInserts.length !== 1) {
    issues.push('deve existir exatamente uma declaração de unidade');
  } else if (
    !/^\s*'US'\s*,\s*'Unidade e Serviço'\s*,\s*true\s+where\s+not\s+exists\s*\(\s*select\s+1\s+from\s+ltc_m\.units\s+where\s+code\s*=\s*'US'\s*\)\s*$/i.test(
      unitInserts[0],
    )
  ) {
    issues.push('a unidade deve ser somente US = Unidade e Serviço e ativa');
  }

  if (allInsertTargets.some((target) => !ALLOWED_TABLES.has(target))) {
    issues.push('seed de entidade não aprovada');
  }
  if (allInsertTargets.length !== 3) {
    issues.push('arquivo deve conter somente os dois registros aprovados');
  }

  const currencyCodes = currencyInserts
    .map((payload) => payload.match(/^\s*'([^']+)'/)?.[1])
    .filter(Boolean);
  const unitCodes = unitInserts
    .map((payload) => payload.match(/^\s*'([^']+)'/)?.[1])
    .filter(Boolean);
  if (new Set(currencyCodes).size !== currencyCodes.length) {
    issues.push('código de moeda duplicado no arquivo');
  }
  if (new Set(unitCodes).size !== unitCodes.length) {
    issues.push('código de unidade duplicado no arquivo');
  }
}

export function scanSeedText(sql) {
  const issues = [];
  const stripped = stripSeedNoise(sql);

  if (!sql.trim() || !stripped.replace(/[\s;]+/g, '')) issues.push('seed vazio');

  for (const [pattern, message] of FORBIDDEN_PATTERNS) {
    if (pattern.test(stripped)) issues.push(message);
  }

  for (const match of stripped.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
    if (match[1].toLowerCase() !== 'ltc_m') {
      issues.push('referência a schema fora de ltc_m');
    }
  }

  for (const match of stripped.matchAll(
    /\b(?:from|into|join|table)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi,
  )) {
    if (!ALLOWED_TABLES.has(match[1].toLowerCase())) {
      issues.push('referência a tabela não aprovada');
    }
  }

  if (
    /--project-ref\b/i.test(sql) ||
    /\b[a-z0-9]{20}\.supabase\.co\b/i.test(sql) ||
    /\b(?:postgres(?:ql)?:\/\/|SUPABASE_ACCESS_TOKEN|DATABASE_URL|service_role)\b/i.test(sql)
  ) {
    issues.push('credencial, endpoint ou project ref versionado');
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(sql)) {
    issues.push('dado pessoal não permitido');
  }
  if (/\b\d{4}-\d{2}-\d{5}\b/.test(sql)) {
    issues.push('código de projeto não permitido');
  }

  requireTransactionAndLocks(sql, stripped, issues);
  requireApprovedPayloads(sql, issues);

  return [...new Set(issues)];
}

export function applyApprovedSeed(state) {
  const next = structuredClone(state);
  const existingUnit = next.units.find((row) => row.code === APPROVED_UNIT.code);

  for (const approvedCurrency of APPROVED_CURRENCIES) {
    const existingCurrency = next.currencies.find((row) => row.code === approvedCurrency.code);
    if (
      existingCurrency &&
      (existingCurrency.name !== approvedCurrency.name ||
        existingCurrency.decimalPlaces !== approvedCurrency.decimalPlaces ||
        existingCurrency.active !== approvedCurrency.active)
    ) {
      throw new Error(`${approvedCurrency.code} divergente`);
    }
    if (!existingCurrency) next.currencies.push({ ...approvedCurrency });
  }
  if (
    existingUnit &&
    (existingUnit.name !== APPROVED_UNIT.name ||
      existingUnit.category !== APPROVED_UNIT.category ||
      existingUnit.active !== APPROVED_UNIT.active)
  ) {
    throw new Error('US divergente');
  }

  if (!existingUnit) next.units.push({ ...APPROVED_UNIT });
  return next;
}

export function checkSeed(seedPath) {
  const sql = fs.readFileSync(seedPath, 'utf8');
  return { file: seedPath, issues: scanSeedText(sql) };
}

function main() {
  const seedPath = path.resolve(
    process.cwd(),
    process.argv[2] ?? path.join('supabase', 'seed.sql'),
  );
  let result;
  try {
    result = checkSeed(seedPath);
  } catch {
    console.error('Falha de seeds: arquivo não encontrado ou ilegível');
    process.exitCode = 1;
    return;
  }

  if (result.issues.length > 0) {
    console.error(
      `Validação de seeds falhou:\n${result.issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('Seed válido: BRL, USD e US');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
