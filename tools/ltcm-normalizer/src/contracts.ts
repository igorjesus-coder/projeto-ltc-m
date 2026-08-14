import { sha256Canonical } from './canonical-json.js';
import {
  NORMALIZER_VERSION,
  type ExistingSnapshot,
  type ExistingImportBatchEvidence,
  type LegacyImportBatchReference,
  type PlannedLegacyImportBatchReference,
  type ProjectStatus,
  type ReviewedResolution,
  type ReviewedResolutionDocument,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const PLANNED_KEY = /^[a-z0-9][a-z0-9:._-]{0,254}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CURRENCY_CODE = /^[A-Z]{3}$/u;
const CANONICAL_CONTRACT_VALUE = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/u;
const CANDIDATE_IDS = {
  client: /^client-[0-9a-f]{24}$/u,
  project: /^project-[0-9a-f]{24}$/u,
} as const;
const PROJECT_CLASSIFICATIONS = new Set<ExistingSnapshot['projects'][number]['classification']>([
  'full_contract',
  'demand',
  'opening_balance',
]);
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

export function canonicalCandidateIdentifier(
  value: unknown,
  entity: keyof typeof CANDIDATE_IDS,
  label: string,
): string {
  const parsed = identifier(value, label);
  if (!CANDIDATE_IDS[entity].test(parsed)) {
    throw new Error(`REVIEWED_RESOLUTION_CANDIDATE_ID_NON_CANONICAL: ${entity}.`);
  }
  return parsed;
}

export function createClientCandidateId(matchKey: string): string {
  return `client-${sha256Canonical({ entity: 'client', match_key: matchKey }).slice(0, 24)}`;
}

export function createProjectCandidateId(projectCode: string): string {
  return `project-${sha256Canonical({ entity: 'project', project_code: projectCode }).slice(0, 24)}`;
}

export function canonicalClientName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function canonicalClientMatchKey(value: string): string {
  return canonicalClientName(value).toLocaleLowerCase('und');
}

export function clientPossibleMatchFamily(value: string): string {
  return (
    canonicalClientMatchKey(value)
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s/u, 1)[0] ?? ''
  );
}

export function hasVisibleClientIdentity(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

export function canonicalContractValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CANONICAL_CONTRACT_VALUE.test(value)) {
    throw new Error(`PROJECT_CONTRACT_VALUE_INVALID: ${label}.`);
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
        candidate_id: canonicalCandidateIdentifier(
          resolution['candidate_id'],
          'client',
          'candidate_id',
        ),
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
        candidate_id: canonicalCandidateIdentifier(
          resolution['candidate_id'],
          'client',
          'candidate_id',
        ),
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
        /[\p{Cc}\p{Cf}]/u.test(approvedName)
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
      candidate_id: canonicalCandidateIdentifier(
        resolution['candidate_id'],
        'project',
        'candidate_id',
      ),
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
  if (document['normalizer_version'] !== NORMALIZER_VERSION) {
    throw new Error('Contrato inválido: normalizer_version incompatível com o runtime.');
  }
  if (!Array.isArray(document['resolutions'])) {
    throw new Error('Contrato inválido: resolutions deve ser array.');
  }
  if (document['resolutions'].length > 10_000) {
    throw new Error('Contrato inválido: quantidade de resoluções excede o limite.');
  }
  return {
    contract: document['contract'],
    normalizer_version: NORMALIZER_VERSION,
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

function validateSnapshotImportBatch(value: unknown): ExistingImportBatchEvidence {
  const batch = record(value, 'existing-snapshot.import_batches[]');
  exactKeys(
    batch,
    ['id', 'idempotency_key', 'source_hash'],
    [],
    'existing-snapshot.import_batches[]',
  );
  const id = identifier(batch['id'], 'import_batches.id');
  assertUuid(id, 'Snapshot import_batches.id');
  const idempotencyKey = batch['idempotency_key'];
  if (
    idempotencyKey !== null &&
    (typeof idempotencyKey !== 'string' ||
      idempotencyKey === '' ||
      idempotencyKey.length > 255 ||
      idempotencyKey !== idempotencyKey.trim())
  ) {
    throw new Error('Snapshot import_batches.idempotency_key inválida.');
  }
  const sourceHash = batch['source_hash'];
  if (sourceHash !== null && (typeof sourceHash !== 'string' || !SHA256.test(sourceHash))) {
    throw new Error('Snapshot import_batches.source_hash inválido.');
  }
  return { id, idempotency_key: idempotencyKey, source_hash: sourceHash };
}

function validateSnapshotCurrency(value: unknown): ExistingSnapshot['currencies'][number] {
  const currency = record(value, 'existing-snapshot.currencies[]');
  exactKeys(currency, ['code', 'active'], [], 'existing-snapshot.currencies[]');
  const code = currency['code'];
  if (typeof code !== 'string' || !CURRENCY_CODE.test(code)) {
    throw new Error('Snapshot currencies.code inválido.');
  }
  const active = currency['active'];
  if (typeof active !== 'boolean') {
    throw new Error('Snapshot currencies.active inválido.');
  }
  return { code, active };
}

function validateSnapshotClient(value: unknown): ExistingSnapshot['clients'][number] {
  const client = record(value, 'existing-snapshot.clients[]');
  exactKeys(
    client,
    ['id', 'legal_name', 'display_name', 'tax_id', 'active', 'deleted_at', 'row_version'],
    [],
    'existing-snapshot.clients[]',
  );
  const id = identifier(client['id'], 'clients.id');
  assertUuid(id, 'Snapshot clients.id');
  const legalName = identifier(client['legal_name'], 'clients.legal_name');
  const displayName = identifier(client['display_name'], 'clients.display_name');
  const taxId = client['tax_id'];
  if (taxId !== null && (typeof taxId !== 'string' || taxId === '' || taxId.length > 255)) {
    throw new Error('Snapshot clients.tax_id inválido.');
  }
  const active = client['active'];
  if (typeof active !== 'boolean') {
    throw new Error('Snapshot clients.active inválido.');
  }
  const deletedAt = client['deleted_at'];
  if (
    deletedAt !== null &&
    (typeof deletedAt !== 'string' || deletedAt === '' || deletedAt.length > 255)
  ) {
    throw new Error('Snapshot clients.deleted_at inválido.');
  }
  const rowVersion = client['row_version'];
  if (!Number.isInteger(rowVersion) || (rowVersion as number) <= 0) {
    throw new Error('Snapshot clients.row_version inválido.');
  }
  return {
    id,
    legal_name: legalName,
    display_name: displayName,
    tax_id: taxId,
    active,
    deleted_at: deletedAt,
    row_version: rowVersion as number,
  };
}

function validateSnapshotProject(
  value: unknown,
  version: 1 | 2,
): ExistingSnapshot['projects'][number] {
  const project = record(value, 'existing-snapshot.projects[]');
  exactKeys(
    project,
    [
      'id',
      'project_code',
      'project_name',
      'client_id',
      'classification',
      'status',
      'base_currency',
      'contract_value',
      'data_reference_date',
      ...(version === 2 ? ['legacy_import_batch_id'] : []),
      'deleted_at',
      'version',
    ],
    [],
    'existing-snapshot.projects[]',
  );
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
  const id = identifier(project['id'], 'projects.id');
  const projectCode = identifier(project['project_code'], 'projects.project_code');
  const projectName = identifier(project['project_name'], 'projects.project_name');
  const clientId = identifier(project['client_id'], 'projects.client_id');
  assertUuid(id, 'Snapshot project.id');
  assertUuid(clientId, 'Snapshot project.client_id');
  const classification = project['classification'];
  if (
    typeof classification !== 'string' ||
    !PROJECT_CLASSIFICATIONS.has(
      classification as ExistingSnapshot['projects'][number]['classification'],
    )
  ) {
    throw new Error('Snapshot projects.classification inválida.');
  }
  const status = project['status'];
  if (typeof status !== 'string' || !PROJECT_STATUSES.has(status as ProjectStatus)) {
    throw new Error('Snapshot projects.status inválido.');
  }
  const baseCurrency = project['base_currency'];
  if (typeof baseCurrency !== 'string' || !CURRENCY_CODE.test(baseCurrency)) {
    throw new Error('Snapshot projects.base_currency inválida.');
  }
  const contractValue = canonicalContractValue(
    project['contract_value'],
    'existing-snapshot.projects[].contract_value',
  );
  const projectVersion = project['version'];
  if (!Number.isInteger(projectVersion) || (projectVersion as number) <= 0) {
    throw new Error('Snapshot contém version inválida.');
  }
  const deletedAt = project['deleted_at'];
  if (
    deletedAt !== null &&
    (typeof deletedAt !== 'string' || deletedAt === '' || deletedAt.length > 255)
  ) {
    throw new Error('Snapshot contém deleted_at inválido.');
  }
  return {
    id,
    project_code: projectCode,
    project_name: projectName,
    client_id: clientId,
    classification: classification as ExistingSnapshot['projects'][number]['classification'],
    status: status as ProjectStatus,
    base_currency: baseCurrency,
    contract_value: contractValue,
    data_reference_date: dataReferenceDate,
    legacy_import_batch_id: legacyImportBatchId,
    deleted_at: deletedAt,
    version: projectVersion as number,
  };
}

export function parseExistingSnapshot(value: unknown): ExistingSnapshot {
  const snapshot = record(value, 'existing-snapshot');
  const contract = snapshot['contract'];
  if (
    contract !== 'ltcm.p011.existing-snapshot.v1' &&
    contract !== 'ltcm.p011.existing-snapshot.v2' &&
    contract !== 'ltcm.p011.existing-snapshot.v3'
  ) {
    throw new Error('Contrato do snapshot existente incompatível.');
  }
  exactKeys(
    snapshot,
    contract === 'ltcm.p011.existing-snapshot.v3'
      ? ['contract', 'currencies', 'clients', 'import_batches', 'projects']
      : ['contract', 'currencies', 'clients', 'projects'],
    [],
    'existing-snapshot',
  );
  if (
    !Array.isArray(snapshot['currencies']) ||
    !Array.isArray(snapshot['clients']) ||
    !Array.isArray(snapshot['projects']) ||
    (contract === 'ltcm.p011.existing-snapshot.v3' && !Array.isArray(snapshot['import_batches']))
  ) {
    throw new Error('Contrato do snapshot existente incompatível.');
  }
  const version = contract.endsWith('.v1') ? 1 : 2;
  const importBatches =
    contract === 'ltcm.p011.existing-snapshot.v3'
      ? (snapshot['import_batches'] as unknown[]).map(validateSnapshotImportBatch)
      : [];
  const clients = (snapshot['clients'] as unknown[]).map(validateSnapshotClient);
  const projects = (snapshot['projects'] as unknown[]).map((project) =>
    validateSnapshotProject(project, version),
  );
  const currencies = (snapshot['currencies'] as unknown[]).map(validateSnapshotCurrency);
  const currencyCodes = new Set<string>();
  for (const currency of currencies) {
    if (currencyCodes.has(currency.code)) {
      throw new Error('Snapshot currencies.code duplicado.');
    }
    currencyCodes.add(currency.code);
  }
  const batchIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const batch of importBatches) {
    const batchId = batch.id.toLowerCase();
    if (batchIds.has(batchId)) {
      throw new Error('Snapshot import_batches.id duplicado.');
    }
    batchIds.add(batchId);
    if (batch.idempotency_key !== null) {
      if (idempotencyKeys.has(batch.idempotency_key)) {
        throw new Error('Snapshot import_batches.idempotency_key duplicada.');
      }
      idempotencyKeys.add(batch.idempotency_key);
    }
  }
  for (const [entries, label] of [
    [clients, 'clients'],
    [projects, 'projects'],
  ] as const) {
    const ids = new Set<string>();
    for (const entry of entries) {
      const id = entry.id.toLowerCase();
      if (ids.has(id)) {
        throw new Error(`Snapshot ${label}.id duplicado.`);
      }
      ids.add(id);
    }
  }
  return {
    contract: 'ltcm.p011.existing-snapshot.v3',
    currencies,
    clients,
    import_batches: importBatches,
    projects,
  };
}
