import type {
  ExistingSnapshot,
  ExistingSnapshotV1,
  LegacyImportBatchReference,
  PlannedLegacyImportBatchReference,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const PLANNED_KEY = /^[a-z0-9][a-z0-9:._-]{0,254}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Contrato inválido: ${label}.`);
  }
  return value as Record<string, unknown>;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new Error(`${label}: UUID inválido.`);
}

export function assertLegacyImportBatchReference(
  value: LegacyImportBatchReference,
): LegacyImportBatchReference {
  if (value.kind === 'existing') {
    assertUuid(value.import_batch_id, 'Lote legado existente');
    return value;
  }
  if (
    value.kind !== 'planned' ||
    !PLANNED_KEY.test(value.planned_key) ||
    value.planned_key !== value.planned_key.trim()
  ) {
    throw new Error('Lote legado planejado exige chave determinística não vazia.');
  }
  if (
    !PLANNED_KEY.test(value.idempotency_key) ||
    value.idempotency_key !== value.idempotency_key.trim()
  ) {
    throw new Error('Lote legado planejado exige idempotency key determinística não vazia.');
  }
  if (!SHA256.test(value.source_manifest_hash) || !SHA256.test(value.source_hash)) {
    throw new Error('Lote legado planejado exige hashes SHA-256 canônicos.');
  }
  return value;
}

export function plannedLegacyImportBatchReference(
  sourceManifestHash: string,
  sourceHash: string,
): PlannedLegacyImportBatchReference {
  if (!SHA256.test(sourceManifestHash) || !SHA256.test(sourceHash)) {
    throw new Error('Origem do lote planejado possui hash inválido.');
  }
  return {
    kind: 'planned',
    planned_key: `p011-batch-${sourceManifestHash.slice(0, 24)}`,
    idempotency_key: `ltcm-p011:${sourceManifestHash}`,
    source_manifest_hash: sourceManifestHash,
    source_hash: sourceHash,
  };
}

function validateSnapshotProject(
  value: unknown,
  version: 1 | 2,
): ExistingSnapshot['projects'][number] {
  const project = record(value, 'existing-snapshot.projects[]');
  const dataReferenceDate = project['data_reference_date'];
  const legacyImportBatchId = version === 2 ? project['legacy_import_batch_id'] : null;
  if (dataReferenceDate !== null && !validDate(dataReferenceDate)) {
    throw new Error('Snapshot contém data_reference_date inválida.');
  }
  if (version === 1 && dataReferenceDate === null) {
    throw new Error('Snapshot v1 não pode converter data_reference_date nula.');
  }
  if (legacyImportBatchId !== null && typeof legacyImportBatchId !== 'string') {
    throw new Error('Snapshot v2 contém legacy_import_batch_id inválido.');
  }
  if (typeof legacyImportBatchId === 'string') {
    assertUuid(legacyImportBatchId, 'Snapshot legacy_import_batch_id');
  }
  if (dataReferenceDate === null && legacyImportBatchId === null) {
    throw new Error('Snapshot v2 viola a linhagem obrigatória para data nula.');
  }
  for (const field of [
    'id',
    'project_code',
    'project_name',
    'client_id',
    'classification',
    'status',
    'base_currency',
    'contract_value',
  ]) {
    if (typeof project[field] !== 'string' || project[field] === '') {
      throw new Error(`Snapshot contém campo de projeto inválido: ${field}.`);
    }
  }
  assertUuid(project['id'] as string, 'Snapshot project.id');
  assertUuid(project['client_id'] as string, 'Snapshot project.client_id');
  if (!Number.isInteger(project['version']) || (project['version'] as number) <= 0) {
    throw new Error('Snapshot contém version inválida.');
  }
  if (project['deleted_at'] !== null && typeof project['deleted_at'] !== 'string') {
    throw new Error('Snapshot contém deleted_at inválido.');
  }
  return {
    ...(project as unknown as Omit<
      ExistingSnapshot['projects'][number],
      'data_reference_date' | 'legacy_import_batch_id'
    >),
    data_reference_date: dataReferenceDate,
    legacy_import_batch_id: legacyImportBatchId,
  };
}

export function parseExistingSnapshot(value: unknown): ExistingSnapshot {
  const snapshot = record(value, 'existing-snapshot');
  const contract = snapshot['contract'];
  if (
    (contract !== 'ltcm.p011.existing-snapshot.v1' &&
      contract !== 'ltcm.p011.existing-snapshot.v2') ||
    !Array.isArray(snapshot['currencies']) ||
    !Array.isArray(snapshot['clients']) ||
    !Array.isArray(snapshot['projects'])
  ) {
    throw new Error('Contrato do snapshot existente incompatível.');
  }
  const version = contract.endsWith('.v1') ? 1 : 2;
  const source = snapshot as unknown as ExistingSnapshotV1 | ExistingSnapshot;
  return {
    contract: 'ltcm.p011.existing-snapshot.v2',
    currencies: structuredClone(source.currencies),
    clients: structuredClone(source.clients),
    projects: source.projects.map((project) => validateSnapshotProject(project, version)),
  };
}
