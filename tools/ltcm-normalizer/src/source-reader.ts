import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson, sha256, sha256Canonical } from './canonical-json.js';
import {
  EXPECTED_PROJECT_CODES,
  P010_WORKBOOK_SHA256,
  type ExistingSnapshot,
  type P010Row,
  type SheetKey,
} from './types.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_JSONL_LINES = 100_000;
const MAX_JSON_DEPTH = 32;
const MAX_TEXT_LENGTH = 32_767;
const REQUIRED_SHEETS: SheetKey[] = ['project_values', 'monthly_revenue', 'curve_s'];

function assertJsonLimits(value: unknown, depth = 0): void {
  if (depth > MAX_JSON_DEPTH) throw new Error('P010 JSON excede a profundidade permitida.');
  if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH) {
    throw new Error('P010 JSON contém texto acima do limite permitido.');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonLimits(item, depth + 1);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertJsonLimits(item, depth + 1);
    }
  }
}

async function safeFile(
  root: string,
  relative: string,
): Promise<{ bytes: Buffer; absolute: string }> {
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path traversal detectado na entrada P010.');
  }
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Entrada P010 insegura ou não regular: ${relative}.`);
  }
  if (metadata.size > MAX_FILE_BYTES) throw new Error(`Entrada P010 excede limite: ${relative}.`);
  return { bytes: await readFile(absolute), absolute };
}

function parseJson(bytes: Buffer, label: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`JSON corrompido: ${label}.`);
  }
  assertJsonLimits(value);
  return value;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Contrato inválido: ${label}.`);
  }
}

function parseRows(bytes: Buffer, label: string): P010Row[] {
  const text = bytes.toString('utf8');
  const lines = text.trimEnd() === '' ? [] : text.trimEnd().split(/\r?\n/u);
  if (lines.length > MAX_JSONL_LINES) throw new Error(`JSONL excede limite: ${label}.`);
  return lines.map((line, index) => {
    const parsed = parseJson(Buffer.from(line, 'utf8'), `${label}:${index + 1}`);
    assertRecord(parsed, `${label}:${index + 1}`);
    const row = parsed as unknown as P010Row;
    if (
      row.payload_schema_version !== 1 ||
      row.raw_payload?.schema_version !== 1 ||
      row.source_row_number !== row.raw_payload?.row_number ||
      row.source_range !== row.raw_payload?.source_range ||
      !Array.isArray(row.raw_payload?.cells) ||
      !/^[0-9a-f]{64}$/u.test(row.row_hash)
    ) {
      throw new Error(`Contrato P009/P010 incompatível em ${label}:${index + 1}.`);
    }
    if (sha256Canonical(row.raw_payload) !== row.row_hash) {
      throw new Error(`Hash de linha P010 inválido em ${label}:${index + 1}.`);
    }
    return row;
  });
}

export interface LoadedSource {
  inputDir: string;
  manifest: Record<string, unknown>;
  manifestHash: string;
  workbookHash: string;
  validation: Record<string, unknown>;
  profile: Record<string, unknown>;
  rows: Map<SheetKey, P010Row[]>;
  inputHashes: Record<string, string>;
}

export async function loadP010Source(inputDir: string): Promise<LoadedSource> {
  const absoluteInput = path.resolve(inputDir);
  const inputMetadata = await lstat(absoluteInput);
  if (inputMetadata.isSymbolicLink() || !inputMetadata.isDirectory()) {
    throw new Error('O diretório P010 deve ser regular e não pode ser symlink.');
  }
  const resolvedInput = await realpath(absoluteInput);
  const manifestFile = await safeFile(resolvedInput, 'manifest.json');
  const validationFile = await safeFile(resolvedInput, 'validation-report.json');
  const profileFile = await safeFile(resolvedInput, 'profile-report.json');
  const manifestUnknown = parseJson(manifestFile.bytes, 'manifest.json');
  const validationUnknown = parseJson(validationFile.bytes, 'validation-report.json');
  const profileUnknown = parseJson(profileFile.bytes, 'profile-report.json');
  assertRecord(manifestUnknown, 'manifest.json');
  assertRecord(validationUnknown, 'validation-report.json');
  assertRecord(profileUnknown, 'profile-report.json');
  const manifest = manifestUnknown;
  const validation = validationUnknown;
  const profile = profileUnknown;
  const source = manifest['source'] as Record<string, unknown> | undefined;
  const extraction = manifest['extraction'] as Record<string, unknown> | undefined;
  const sheetDefinitions = manifest['sheets'];
  if (
    manifest['artifact_contract'] !== 'ltcm.p010.extraction-manifest.v1' ||
    manifest['payload_schema_version'] !== 1
  ) {
    throw new Error('P009_CONTRACT_MISMATCH: contrato P009/P010 v1 ausente.');
  }
  if (source?.['source_hash'] !== P010_WORKBOOK_SHA256) {
    throw new Error('P010_INPUT_HASH_MISMATCH: hash do workbook não aprovado.');
  }
  if (
    extraction?.['error_count'] !== 0 ||
    extraction['operational_sheet_count'] !== 3 ||
    !['passed', 'passed_with_warnings'].includes(String(extraction['status']))
  ) {
    throw new Error('A extração P010 contém erro estrutural ou abas incompletas.');
  }
  if (!Array.isArray(sheetDefinitions)) throw new Error('Manifesto P010 sem inventário de abas.');
  const sheetKeys = sheetDefinitions.map(
    (sheet) => (sheet as Record<string, unknown>)['sheet_key'] as string,
  );
  if (
    sheetKeys.length !== REQUIRED_SHEETS.length ||
    !REQUIRED_SHEETS.every((key) => sheetKeys.includes(key))
  ) {
    throw new Error('Aba operacional ausente ou aba documental presente no staging P010.');
  }
  const ignored = (manifest['workbook'] as Record<string, unknown> | undefined)?.[
    'ignored_sheet_names'
  ];
  if (!Array.isArray(ignored) || !ignored.includes('Decisões Aprovadas')) {
    throw new Error('A aba documental não está explicitamente fora do staging P010.');
  }
  if (
    validation['report_contract'] !== 'ltcm.p010.validation-report.v1' ||
    validation['error_count'] !== 0
  ) {
    throw new Error('Relatório de validação P010 incompatível.');
  }
  const validationEntries = validation['entries'];
  const warningCodes = Array.isArray(validationEntries)
    ? validationEntries.map((entry) => (entry as Record<string, unknown>)['error_code'])
    : [];
  if (!warningCodes.includes('RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE')) {
    throw new Error('Warning aprovado D04 ausente no P010.');
  }
  if (
    profile['report_contract'] !== 'ltcm.p010.profile-report.v1' ||
    profile['profile_detected'] !== true
  ) {
    throw new Error('Perfil LTC-M P010 não reconhecido.');
  }

  const rows = new Map<SheetKey, P010Row[]>();
  const inputHashes: Record<string, string> = {
    'manifest.json': sha256(manifestFile.bytes),
    'profile-report.json': sha256(profileFile.bytes),
    'validation-report.json': sha256(validationFile.bytes),
  };
  for (const key of REQUIRED_SHEETS) {
    const relative = `sheets/${key}.jsonl`;
    const file = await safeFile(resolvedInput, relative);
    const parsedRows = parseRows(file.bytes, relative);
    if (parsedRows.some((row) => row.raw_payload.sheet_key !== key)) {
      throw new Error(`Chave de aba divergente em ${relative}.`);
    }
    const definition = sheetDefinitions.find(
      (sheet) => (sheet as Record<string, unknown>)['sheet_key'] === key,
    ) as Record<string, unknown> | undefined;
    if (
      definition?.['staged_row_count'] !== parsedRows.length ||
      definition['content_hash'] !== sha256Canonical(parsedRows.map((row) => row.raw_payload))
    ) {
      throw new Error(`Contagem ou hash de conteúdo divergente em ${relative}.`);
    }
    rows.set(key, parsedRows);
    inputHashes[relative] = sha256(file.bytes);
  }
  const projects = profile['projects'] as Record<string, unknown> | undefined;
  const codes = projects?.['codes'];
  if (
    projects?.['count'] !== 9 ||
    !Array.isArray(codes) ||
    codes.length !== EXPECTED_PROJECT_CODES.length ||
    !EXPECTED_PROJECT_CODES.every((code) => codes.includes(code))
  ) {
    throw new Error('O perfil P010 não contém exatamente os nove projetos aprovados.');
  }
  return {
    inputDir: resolvedInput,
    manifest,
    manifestHash: sha256(manifestFile.bytes),
    workbookHash: P010_WORKBOOK_SHA256,
    validation,
    profile,
    rows,
    inputHashes,
  };
}

export function emptySnapshot(): ExistingSnapshot {
  return {
    contract: 'ltcm.p011.existing-snapshot.v1',
    currencies: [{ code: 'BRL', active: true }],
    clients: [],
    projects: [],
  };
}

export async function loadSnapshot(snapshotPath: string | undefined): Promise<ExistingSnapshot> {
  if (snapshotPath === undefined) return emptySnapshot();
  const absolute = path.resolve(snapshotPath);
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_FILE_BYTES) {
    throw new Error('Snapshot existente inseguro ou acima do limite.');
  }
  const parsed = parseJson(await readFile(absolute), 'existing-snapshot');
  assertRecord(parsed, 'existing-snapshot');
  if (
    parsed['contract'] !== 'ltcm.p011.existing-snapshot.v1' ||
    !Array.isArray(parsed['currencies']) ||
    !Array.isArray(parsed['clients']) ||
    !Array.isArray(parsed['projects'])
  ) {
    throw new Error('Contrato do snapshot existente incompatível.');
  }
  return parsed as unknown as ExistingSnapshot;
}

export async function assertSafeOutput(outputDir: string, inputDir: string): Promise<string> {
  const absolute = path.resolve(outputDir);
  const artifactsRoot = path.resolve('.artifacts');
  if (absolute === artifactsRoot || !absolute.startsWith(`${artifactsRoot}${path.sep}`)) {
    throw new Error('O diretório P011 deve ficar dentro de .artifacts e não pode ser sua raiz.');
  }
  if (absolute === inputDir || absolute.startsWith(`${inputDir}${path.sep}`)) {
    throw new Error('A saída P011 não pode estar dentro da entrada P010.');
  }
  const relativeParts = path.relative(artifactsRoot, absolute).split(path.sep);
  let cursor = artifactsRoot;
  for (const part of ['', ...relativeParts]) {
    if (part !== '') cursor = path.join(cursor, part);
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) throw new Error('A saída P011 não pode atravessar symlink.');
      if (cursor !== absolute && !metadata.isDirectory()) {
        throw new Error('Um ancestral da saída P011 não é diretório.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return absolute;
}

export function canonicalInputHash(inputHashes: Record<string, string>): string {
  return sha256(Buffer.from(canonicalJson(inputHashes), 'utf8'));
}
