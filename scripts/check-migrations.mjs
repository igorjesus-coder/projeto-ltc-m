import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MIGRATION_NAME = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

const FORBIDDEN_PATTERNS = [
  [/\bdrop\b/i, 'comando DROP'],
  [/\btruncate\b/i, 'comando TRUNCATE'],
  [/\bdelete\b/i, 'comando DELETE'],
  [/\bupdate\b/i, 'comando UPDATE'],
  [/\binsert\b/i, 'comando INSERT'],
  [/\bmerge\b/i, 'comando MERGE'],
  [/\bcopy\b/i, 'comando COPY'],
  [/\balter\s+schema\b/i, 'comando ALTER SCHEMA'],
  [/\balter\s+role\b/i, 'comando ALTER ROLE'],
  [/\balter\s+default\s+privileges\b/i, 'comando ALTER DEFAULT PRIVILEGES'],
  [/\bcreate\s+role\b/i, 'comando CREATE ROLE'],
  [/\bdrop\s+role\b/i, 'comando DROP ROLE'],
  [/\bgrant\b/i, 'comando GRANT'],
  [/\brevoke\b/i, 'comando REVOKE'],
  [/\bcreate\s+extension\b/i, 'comando CREATE EXTENSION'],
  [/\bdrop\s+extension\b/i, 'comando DROP EXTENSION'],
  [/\bcreate\s+publication\b/i, 'comando CREATE PUBLICATION'],
  [/\balter\s+publication\b/i, 'alteração de publication'],
  [/\bcreate\s+(?:function|procedure)\b/i, 'função ou procedure fora da whitelist'],
  [/\bcreate\s+trigger\b/i, 'trigger fora da whitelist'],
  [/\bdo\b/i, 'bloco dinâmico DO'],
  [/\bexecute\b/i, 'SQL dinâmico EXECUTE'],
  [/\bset\s+(?:local\s+|session\s+)?search_path\b/i, 'alteração de search_path'],
  [/\bcreate\s+(?:unique\s+)?index\s+concurrently\b/i, 'CREATE INDEX CONCURRENTLY'],
  [/\b(?:real|float4|float8|float|double\s+precision|money)\b/i, 'tipo financeiro impreciso'],
  [/\b(?:auth\.users|auth\.uid\s*\()/i, 'dependência de Supabase Auth'],
  [
    /\b(?:public|auth|storage|extensions|vault|realtime|supabase_migrations)\s*\./i,
    'referência a schema externo',
  ],
];

function consumeDollarTag(sql, index) {
  const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match?.[0] ?? null;
}

export function stripSqlNoise(sql) {
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
      output += ' ';
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

    const dollarTag = sql[index] === '$' ? consumeDollarTag(sql, index) : null;
    if (dollarTag) {
      output += ' ';
      const end = sql.indexOf(dollarTag, index + dollarTag.length);
      if (end < 0) break;
      output += sql.slice(index + dollarTag.length, end).replace(/[^\r\n]/g, ' ');
      index = end + dollarTag.length;
      continue;
    }

    output += sql[index];
    index += 1;
  }

  return output;
}

function isValidTimestamp(timestamp) {
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(4, 6));
  const day = Number(timestamp.slice(6, 8));
  const hour = Number(timestamp.slice(8, 10));
  const minute = Number(timestamp.slice(10, 12));
  const second = Number(timestamp.slice(12, 14));
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function requireQualifiedObjects(sql, issues) {
  const checks = [
    [/\bcreate\s+schema\s+(?!ltc_m\b)/i, 'somente o schema ltc_m pode ser criado'],
    [
      /\bcreate\s+(?:table|type|view|sequence)\s+(?:if\s+not\s+exists\s+)?(?!ltc_m\.)/i,
      'objeto de domínio sem qualificação ltc_m',
    ],
    [/\breferences\s+(?!ltc_m\.)/i, 'foreign key para tabela fora de ltc_m'],
    [
      /\bcomment\s+on\s+(?:schema|table|column|type|view|sequence)\s+(?!ltc_m(?:\.|\b))/i,
      'comentário sobre objeto fora de ltc_m',
    ],
  ];

  for (const [pattern, message] of checks) {
    if (pattern.test(sql)) issues.push(message);
  }

  for (const match of sql.matchAll(/\bcreate\s+(?:unique\s+)?index\b[\s\S]*?;/gi)) {
    if (!/\bon\s+ltc_m\./i.test(match[0])) {
      issues.push('índice sobre tabela fora de ltc_m');
    }
  }
}

function requireAdditiveAlterTables(sql, issues) {
  const alterPattern = /\balter\s+table\b[\s\S]*?;/gi;
  const statements = [...sql.matchAll(alterPattern)];

  for (const match of statements) {
    if (
      !/^\s*alter\s+table\s+ltc_m\.[a-z_][a-z0-9_]*\s+add\s+constraint\s+[a-z_][a-z0-9_]*\s+(?:check|unique|foreign\s+key)\b/i.test(
        match[0],
      )
    ) {
      issues.push('ALTER TABLE permitido somente para ADD CONSTRAINT aditivo em ltc_m');
    }
  }

  if (/\balter\s+table\b/i.test(sql.replace(alterPattern, ' '))) {
    issues.push('ALTER TABLE incompleto ou não aditivo');
  }
}

export function extractNamedObjects(sql) {
  const stripped = stripSqlNoise(sql);
  return {
    constraints: [...stripped.matchAll(/\bconstraint\s+([a-z_][a-z0-9_]*)/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
    indexes: [
      ...stripped.matchAll(
        /\bcreate\s+(?:unique\s+)?index\s+(?!concurrently\b)([a-z_][a-z0-9_]*)/gi,
      ),
    ].map((match) => match[1].toLowerCase()),
  };
}

export function scanMigrationText(sql) {
  const issues = [];
  const stripped = stripSqlNoise(sql);
  const semanticSql = stripped.replace(/\b(?:begin|commit|rollback)\b/gi, '').replace(/[;\s]/g, '');

  if (!semanticSql) issues.push('migration vazia');

  for (const [pattern, message] of FORBIDDEN_PATTERNS) {
    if (pattern.test(stripped)) issues.push(message);
  }

  requireQualifiedObjects(stripped, issues);
  requireAdditiveAlterTables(stripped, issues);

  if (/--project-ref\b/i.test(sql) || /\b[a-z0-9]{20}\.supabase\.co\b/i.test(sql)) {
    issues.push('project ref ou endpoint remoto versionado');
  }

  return [...new Set(issues)];
}

export function checkMigrations(directory) {
  const issues = [];
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  if (entries.length === 0) {
    return { files: [], issues: ['nenhuma migration SQL encontrada'] };
  }

  const timestamps = new Set();
  const constraintNames = new Set();
  const indexNames = new Set();
  let previousTimestamp = null;

  for (const filename of entries) {
    const match = filename.match(MIGRATION_NAME);
    if (!match) {
      issues.push(`${filename}: nome inválido`);
      continue;
    }

    const timestamp = match[1];
    if (!isValidTimestamp(timestamp)) {
      issues.push(`${filename}: timestamp inválido`);
    }
    if (timestamps.has(timestamp)) {
      issues.push(`${filename}: timestamp duplicado`);
    }
    if (previousTimestamp && timestamp <= previousTimestamp) {
      issues.push(`${filename}: ordem de timestamp inválida`);
    }

    timestamps.add(timestamp);
    previousTimestamp = timestamp;

    const sql = fs.readFileSync(path.join(directory, filename), 'utf8');
    for (const issue of scanMigrationText(sql)) {
      issues.push(`${filename}: ${issue}`);
    }

    const namedObjects = extractNamedObjects(sql);
    for (const name of namedObjects.constraints) {
      if (constraintNames.has(name)) {
        issues.push(`${filename}: nome de constraint duplicado: ${name}`);
      }
      constraintNames.add(name);
    }
    for (const name of namedObjects.indexes) {
      if (indexNames.has(name)) {
        issues.push(`${filename}: nome de índice duplicado: ${name}`);
      }
      indexNames.add(name);
    }
  }

  return { files: entries, issues };
}

export function formatMigrationIssues(issues) {
  return issues.map((issue) => `- ${issue}`).join('\n');
}

function main() {
  const directory = path.resolve(
    process.cwd(),
    process.argv[2] ?? path.join('supabase', 'migrations'),
  );

  let result;
  try {
    result = checkMigrations(directory);
  } catch {
    console.error('Falha de migrations: diretório não encontrado ou ilegível');
    process.exitCode = 1;
    return;
  }

  if (result.issues.length > 0) {
    console.error(`Validação de migrations falhou:\n${formatMigrationIssues(result.issues)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Migrations válidas: ${result.files.length}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
