import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const EXCLUDED_FINGERPRINT_SCHEMAS = new Set(['ltc_m', 'supabase_migrations']);
const INVENTORY_FIELDS = ['object_kind', 'schema_name', 'object_name', 'detail', 'definition_hash'];

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeInventoryRows(rows) {
  return rows
    .map((row) =>
      Object.fromEntries(
        INVENTORY_FIELDS.map((field) => [
          field,
          row[field] === null || row[field] === undefined ? '' : String(row[field]),
        ]),
      ),
    )
    .sort((left, right) => {
      for (const field of INVENTORY_FIELDS) {
        const comparison = compareText(left[field], right[field]);
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
}

function fingerprintRows(rows, predicate) {
  const selectedRows = normalizeInventoryRows(rows).filter(predicate);
  const canonical = JSON.stringify(selectedRows);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').toUpperCase();
}

export function fingerprintExternalRows(rows) {
  return fingerprintRows(rows, (row) => !EXCLUDED_FINGERPRINT_SCHEMAS.has(row.schema_name));
}

export function fingerprintLtcmRows(rows) {
  return fingerprintRows(rows, (row) => row.schema_name === 'ltc_m');
}

export function fingerprintMigrationRows(rows) {
  return fingerprintRows(rows, (row) => row.schema_name === 'supabase_migrations');
}

export function summarizeInventory(rows) {
  const normalized = normalizeInventoryRows(rows);
  const byKind = {};
  const bySchema = {};

  for (const row of normalized) {
    byKind[row.object_kind] = (byKind[row.object_kind] ?? 0) + 1;
    bySchema[row.schema_name] = (bySchema[row.schema_name] ?? 0) + 1;
  }

  return {
    totalObjects: normalized.length,
    ltcmObjects: normalized.filter((row) => row.schema_name === 'ltc_m').length,
    migrationObjects: normalized.filter((row) => row.schema_name === 'supabase_migrations').length,
    byKind: Object.fromEntries(
      Object.entries(byKind).sort(([left], [right]) => compareText(left, right)),
    ),
    bySchema: Object.fromEntries(
      Object.entries(bySchema).sort(([left], [right]) => compareText(left, right)),
    ),
  };
}

function parseArguments(argv) {
  const options = { phase: null, output: null };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--phase') {
      options.phase = argv.at(index + 1);
      index += 1;
    } else if (argv[index] === '--output') {
      options.output = argv.at(index + 1);
      index += 1;
    } else {
      throw new Error(`argumento desconhecido: ${argv[index]}`);
    }
  }

  if (!['pre', 'post'].includes(options.phase)) {
    throw new Error('--phase deve ser pre ou post');
  }
  if (!options.output) {
    throw new Error('--output é obrigatório');
  }

  return options;
}

function parseCliPayload(stdout) {
  const objectStart = stdout.indexOf('{');
  const arrayStart = stdout.indexOf('[');
  const starts = [objectStart, arrayStart].filter((value) => value >= 0);
  if (starts.length === 0) throw new Error('a CLI não retornou JSON');

  const payload = JSON.parse(stdout.slice(Math.min(...starts)));
  if (!Array.isArray(payload.rows)) throw new Error('a CLI não retornou rows');
  return payload.rows;
}

function runInventoryQuery(rootDirectory) {
  // A CLI empacotada no Windows não interpreta corretamente estes argumentos absolutos
  // quando o caminho do workspace contém espaços. O subprocesso já usa rootDirectory
  // como cwd, portanto caminhos relativos são suficientes e portáveis.
  const cliWrapperPath = path.join('node_modules', 'supabase', 'dist', 'supabase.js');
  const queryPath = path.join('database', 'audit', 'remote-metadata-inventory.sql');
  const result = spawnSync(
    process.execPath,
    [cliWrapperPath, 'db', 'query', '--linked', '--file', queryPath, '--output-format', 'json'],
    {
      cwd: rootDirectory,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    throw new Error('a consulta remota read-only falhou');
  }

  return parseCliPayload(result.stdout);
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Falha de uso: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const rootDirectory = process.cwd();
  const outputPath = path.resolve(rootDirectory, options.output);
  const allowedDirectory = path.resolve(rootDirectory, 'docs', 'database');
  const relativeOutput = path.relative(allowedDirectory, outputPath);

  if (
    relativeOutput.startsWith('..') ||
    path.isAbsolute(relativeOutput) ||
    path.extname(outputPath) !== '.json'
  ) {
    console.error('Falha de inventário: saída deve ser um JSON em docs/database');
    process.exitCode = 2;
    return;
  }

  let rows;
  try {
    rows = runInventoryQuery(rootDirectory);
  } catch {
    console.error('Falha de inventário: consulta read-only não concluída');
    process.exitCode = 1;
    return;
  }

  const objects = normalizeInventoryRows(rows);
  const summary = summarizeInventory(objects);
  const externalFingerprint = fingerprintExternalRows(objects);
  const ltcmFingerprint = fingerprintLtcmRows(objects);
  const migrationFingerprint = fingerprintMigrationRows(objects);
  const document = {
    formatVersion: 1,
    phase: options.phase,
    collectedAtUtc: new Date().toISOString(),
    target: 'Funcionarios',
    region: 'us-east-1',
    query: 'database/audit/remote-metadata-inventory.sql',
    fingerprint: {
      algorithm: 'SHA-256',
      excludedSchemas: [...EXCLUDED_FINGERPRINT_SCHEMAS].sort(),
      value: externalFingerprint,
    },
    fingerprints: {
      external: {
        algorithm: 'SHA-256',
        excludedSchemas: [...EXCLUDED_FINGERPRINT_SCHEMAS].sort(),
        value: externalFingerprint,
      },
      ltcm: {
        algorithm: 'SHA-256',
        includedSchemas: ['ltc_m'],
        value: ltcmFingerprint,
      },
      migrationHistory: {
        algorithm: 'SHA-256',
        includedSchemas: ['supabase_migrations'],
        value: migrationFingerprint,
      },
    },
    summary,
    objects,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  console.log(`Inventário ${options.phase}: ${summary.totalObjects} metadados`);
  console.log(`Objetos ltc_m: ${summary.ltcmObjects}`);
  console.log(`Fingerprint externo: ${externalFingerprint}`);
  console.log(`Fingerprint ltc_m: ${ltcmFingerprint}`);
  console.log(`Fingerprint de migrations: ${migrationFingerprint}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
