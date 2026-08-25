import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import {
  P017_FINGERPRINT_CONTRACT,
  P017_SCHEMA_CONTRACT,
  canonicalizeSchemaModel,
  collectSchemaModel,
  fingerprintSchemaModel,
  renderDataDictionary,
  renderErd,
  renderIntegrityValidation,
  summarizeSchemaModel,
} from './p017-schema-model.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const modelPath = path.join(root, 'docs', 'database', 'p017-schema-model.json');
const outputs = new Map([
  [path.join(root, 'docs', 'database', 'erd.md'), renderErd],
  [path.join(root, 'docs', 'database', 'data-dictionary.md'), renderDataDictionary],
  [path.join(root, 'docs', 'database', 'p017-integrity-validation.md'), renderIntegrityValidation],
]);

function parseMode(argv) {
  if (argv.length !== 1 || !['--capture', '--write', '--check'].includes(argv[0])) {
    throw new Error('P017_DOCS_USAGE');
  }
  return argv[0];
}

function assertLocalDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('P017_DATABASE_ENV_INVALID');
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase()) ||
    parsed.pathname !== '/ltcm_test' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('P017_DATABASE_ENV_INVALID');
  }
}

export function createSnapshot(model, migrationCount = 13) {
  const canonical = canonicalizeSchemaModel(model);
  return {
    schemaContract: P017_SCHEMA_CONTRACT,
    fingerprintContract: P017_FINGERPRINT_CONTRACT,
    migrationCount,
    fingerprint: fingerprintSchemaModel(canonical),
    summary: summarizeSchemaModel(canonical),
    model: canonical,
  };
}

export function serializeSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function renderedDocuments(snapshot) {
  return new Map(
    [...outputs.entries()].map(([filename, renderer]) => [
      filename,
      `${renderer(snapshot).replace(/\n+$/u, '')}\n`,
    ]),
  );
}

async function loadSnapshot() {
  const snapshot = JSON.parse(await readFile(modelPath, 'utf8'));
  const expected = createSnapshot(snapshot.model, snapshot.migrationCount);
  if (serializeSnapshot(snapshot) !== serializeSnapshot(expected)) {
    throw new Error('P017_SCHEMA_SNAPSHOT_INVALID');
  }
  return snapshot;
}

async function capture() {
  const databaseUrl = process.env['LTCM_P017_DATABASE_URL'];
  if (!databaseUrl) throw new Error('P017_DATABASE_ENV_MISSING');
  assertLocalDatabaseUrl(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const environment = await client.query(
      `select current_database() as database_name,
              current_setting('server_version_num') as server_version_num`,
    );
    if (
      environment.rows[0]?.['database_name'] !== 'ltcm_test' ||
      !String(environment.rows[0]?.['server_version_num']).startsWith('17')
    ) {
      throw new Error('P017_DATABASE_ENV_INVALID');
    }
    const migrationCount = (await readdir(path.join(root, 'supabase', 'migrations'))).filter(
      (name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name),
    ).length;
    const snapshot = createSnapshot(await collectSchemaModel(client), migrationCount);
    await writeFile(modelPath, serializeSnapshot(snapshot), 'utf8');
    for (const [filename, content] of renderedDocuments(snapshot)) {
      await writeFile(filename, content, 'utf8');
    }
    return snapshot;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function writeDocuments() {
  const snapshot = await loadSnapshot();
  for (const [filename, content] of renderedDocuments(snapshot)) {
    await writeFile(filename, content, 'utf8');
  }
  return snapshot;
}

async function checkDocuments() {
  const snapshot = await loadSnapshot();
  const stale = [];
  for (const [filename, expected] of renderedDocuments(snapshot)) {
    let actual;
    try {
      actual = await readFile(filename, 'utf8');
    } catch {
      actual = null;
    }
    if (actual !== expected) stale.push(path.relative(root, filename).replaceAll('\\', '/'));
  }
  if (stale.length > 0) throw new Error(`P017_SCHEMA_DOCS_STALE:${stale.join(',')}`);
  return snapshot;
}

async function main() {
  try {
    const mode = parseMode(process.argv.slice(2));
    const snapshot =
      mode === '--capture'
        ? await capture()
        : mode === '--write'
          ? await writeDocuments()
          : await checkDocuments();
    console.log(
      `P017 schema docs ${mode.slice(2)}: ${snapshot.summary.relationCount} relations, ` +
        `${snapshot.summary.columnCount} columns, ${snapshot.fingerprint}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'P017_SCHEMA_DOCS_FAILED';
    console.error(
      message.startsWith('P017_')
        ? message
        : `P017_SCHEMA_DOCS_FAILED:${String(error?.code ?? 'UNEXPECTED')}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
