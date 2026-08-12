import type {
  ExistingSnapshot,
  ExistingSnapshotV1,
  LegacyImportBatchReference,
  PlannedLegacyImportBatchReference,
  ProjectStatus,
  ReviewedResolution,
  ReviewedResolutionDocument,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const PLANNED_KEY = /^[a-z0-9][a-z0-9:._-]{0,254}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const PROJECT_STATUSES = new Set<ProjectStatus>([
  'draft',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Contrato inválido: ${label}.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[],
  label: string,
): void {
  const accepted = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unexpected = Object.keys(value).filter((key) => !accepted.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Contrato inválido: ${label}; campos ausentes=${missing.join(',') || 'nenhum'}; ` +
        `campos não autorizados=${unexpected.join(',') || 'nenhum'}.`,
    );
  }
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`Contrato inválido: ${label} exige SHA-256 canônico.`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '' || value.length > 255) {
    throw new Error(`Contrato inválido: ${label}.`);
  }
  return value;
}

function parseResolution(value: unknown, index: number): ReviewedResolution {
  const resolution = record(value, `resolutions[${index}]`);
  const type = resolution['type'];
  if (type === 'client_identity') {
    exactKeys(
      resolution,
      ['type', 'candidate_id', 'candidate_hash', 'identity'],
      [],
      `resolutions[${index}]`,
    );
    const identity = record(resolution['identity'], `resolutions[${index}].identity`);
    if (identity['kind'] === 'create_new') {
      exactKeys(identity, ['kind'], [], `resolutions[${index}].identity`);
      return {
        type,
        candidate_id: identifier(resolution['candidate_id'], 'candidate_id'),
        candidate_hash: sha256(resolution['candidate_hash'], 'candidate_hash'),
        identity: { kind: 'create_new' },
      };
    }
    if (identity['kind'] === 'use_existing') {
      exactKeys(identity, ['kind', 'client_id'], [], `resolutions[${index}].identity`);
      const clientId = identifier(identity['client_id'], 'identity.client_id');
      assertUuid(clientId, 'Identidade revisada de cliente');
      return {
        type,
        candidate_id: identifier(resolution['candidate_id'], 'candidate_id'),
        candidate_hash: sha256(resolution['candidate_hash'], 'candidate_hash'),
        identity: { kind: 'use_existing', client_id: clientId },
      };
    }
    throw new Error(`Contrato inválido: resolutions[${index}].identity.kind.`);
  }
  if (type === 'project') {
    exactKeys(
      resolution,
      ['type', 'candidate_id', 'candidate_hash'],
      ['approved_name', 'approved_status'],
      `resolutions[${index}]`,
    );
    const approvedName = resolution['approved_name'];
    const approvedStatus = resolution['approved_status'];
    if (approvedName === undefined && approvedStatus === undefined) {
      throw new Error(`Contrato inválido: resolutions[${index}] não contém decisão.`);
    }
    if (approvedName !== undefined) {
      if (
        typeof approvedName !== 'string' ||
        approvedName.length === 0 ||
        approvedName.length > 512 ||
        approvedName !== approvedName.normalize('NFC').trim().replace(/\s+/gu, ' ') ||
        /\p{Cc}/u.test(approvedName)
      ) {
        throw new Error(`Contrato inválido: resolutions[${index}].approved_name.`);
      }
    }
    if (
      approvedStatus !== undefined &&
      (typeof approvedStatus !== 'string' || !PROJECT_STATUSES.has(approvedStatus as ProjectStatus))
    ) {
      throw new Error(`Contrato inválido: resolutions[${index}].approved_status.`);
    }
    return {
      type,
      candidate_id: identifier(resolution['candidate_id'], 'candidate_id'),
      candidate_hash: sha256(resolution['candidate_hash'], 'candidate_hash'),
      ...(approvedName === undefined ? {} : { approved_name: approvedName }),
      ...(approvedStatus === undefined ? {} : { approved_status: approvedStatus as ProjectStatus }),
    };
  }
  throw new Error(`Contrato inválido: resolutions[${index}].type.`);
}

export function parseReviewedResolutionDocument(value: unknown): ReviewedResolutionDocument {
  const document = record(value, 'reviewed-resolutions');
  exactKeys(
    document,
    [
      'contract',
      'normalizer_version',
      'normalization_manifest_hash',
      'p010_manifest_hash',
      'input_hash',
      'snapshot_hash',
      'candidate_set_hash',
      'resolutions',
    ],
    [],
    'reviewed-resolutions',
  );
  if (document['contract'] !== 'ltcm.p011.reviewed-resolutions.v1') {
    throw new Error('Contrato de resoluções revisadas incompatível.');
  }
  if (!Array.isArray(document['resolutions'])) {
    throw new Error('Contrato inválido: resolutions deve ser array.');
  }
  if (document['resolutions'].length > 10_000) {
    throw new Error('Contrato inválido: quantidade de resoluções excede o limite.');
  }
  return {
    contract: document['contract'],
    normalizer_version: identifier(document['normalizer_version'], 'normalizer_version'),
    normalization_manifest_hash: sha256(
      document['normalization_manifest_hash'],
      'normalization_manifest_hash',
    ),
    p010_manifest_hash: sha256(document['p010_manifest_hash'], 'p010_manifest_hash'),
    input_hash: sha256(document['input_hash'], 'input_hash'),
    snapshot_hash: sha256(document['snapshot_hash'], 'snapshot_hash'),
    candidate_set_hash: sha256(document['candidate_set_hash'], 'candidate_set_hash'),
    resolutions: document['resolutions'].map(parseResolution),
  };
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
