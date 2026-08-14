import { sha256Canonical } from './canonical-json.js';
import {
  assertLegacyImportBatchReference,
  assertUuid,
  canonicalCandidateIdentifier,
  canonicalClientMatchKey,
  canonicalClientName,
  canonicalContractValue,
  clientPossibleMatchFamily,
  createClientCandidateId,
  createProjectCandidateId,
  hasVisibleClientIdentity,
  parseExistingSnapshot,
  parseReviewedResolutionDocument,
} from './contracts.js';
import { assertSourceProvenCandidateProof } from './normalizer.js';
import {
  NORMALIZER_VERSION,
  type ClientCandidate,
  type ExistingSnapshot,
  type LegacyImportBatchReference,
  type MappingEvidence,
  type ProjectCandidate,
  type ReviewBinding,
  type ReviewedResolution,
  type ReviewedResolutionDocument,
  type ResolutionDiagnostic,
  type ResolutionSummary,
} from './types.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CURRENCY_CODE = /^[A-Z]{3}$/u;
const REVIEW_BINDING_CONTRACT = 'ltcm.p011.review-binding.v1';
const CLIENT_CANDIDATE_KEYS = [
  'candidate_id',
  'client_ref',
  'raw_names',
  'normalized_name',
  'match_key',
  'status',
  'action',
  'matched_client_id',
  'possible_matches',
  'origins',
  'diagnostic_codes',
  'source_manifest_hash',
  'hash',
] as const;
const PROJECT_CANDIDATE_KEYS = [
  'candidate_id',
  'raw_codes',
  'project_code',
  'raw_project_label',
  'project_name_proposal',
  'project_name_mapping_status',
  'client_match_key',
  'client_candidate_id',
  'client_id',
  'currency',
  'raw_classifications',
  'classification',
  'operational_status',
  'contract_value',
  'data_reference_date',
  'legacy_import_batch_reference',
  'matched_legacy_import_batch_id',
  'value_evidence',
  'receipt_forecast_evidence',
  'action',
  'origins',
  'diagnostic_codes',
  'source_manifest_hash',
  'hash',
] as const;
const MAPPING_STATUSES = new Set(['mapped', 'evidence_only', 'pending_decision', 'ambiguous']);
const CLIENT_STATUSES = new Set(['valid', 'ambiguous', 'rejected']);
const PROJECT_CLASSIFICATIONS = new Set(['full_contract', 'demand', 'opening_balance']);
const PROJECT_STATUSES = new Set(['draft', 'active', 'on_hold', 'completed', 'cancelled']);
const PLAN_ACTIONS = new Set(['insert', 'no_op', 'conflict', 'rejected', 'pending_decision']);
const SHEET_KEYS = new Set(['project_values', 'monthly_revenue', 'curve_s']);
const PROJECT_DIAGNOSTIC_KINDS = new Map<
  string,
  'conflict' | 'rejection' | 'pending' | 'informational'
>([
  ['PROJECT_CODE_INVALID', 'rejection'],
  ['PROJECT_DUPLICATE_CONFLICT', 'conflict'],
  ['PROJECT_CLIENT_UNRESOLVED', 'rejection'],
  ['PROJECT_CURRENCY_UNRESOLVED', 'rejection'],
  ['PROJECT_VALUE_CONFLICT', 'rejection'],
  ['PROJECT_CLASSIFICATION_CONFLICT', 'rejection'],
  ['PROJECT_DATA_REFERENCE_DATE_MISSING', 'pending'],
  ['PROTECTED_RECORD_CONFLICT', 'conflict'],
  ['RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE', 'informational'],
]);
const projectDiagnosticsByKind = (
  ...kinds: Array<'conflict' | 'rejection' | 'pending' | 'informational'>
): Set<string> =>
  new Set(
    [...PROJECT_DIAGNOSTIC_KINDS].filter(([, kind]) => kinds.includes(kind)).map(([code]) => code),
  );
const PROJECT_CONFLICT_DIAGNOSTICS = projectDiagnosticsByKind('conflict');
const PROJECT_NON_BLOCKING_DIAGNOSTICS = projectDiagnosticsByKind('pending', 'informational');
const HARD_PROJECT_DIAGNOSTICS = projectDiagnosticsByKind('conflict', 'rejection');
const SNAPSHOT_PROJECT_DIAGNOSTICS = projectDiagnosticsByKind('conflict');

interface AppliedReviewedResolutions {
  clients: ClientCandidate[];
  projects: ProjectCandidate[];
  mappings: MappingEvidence[];
  summary: ResolutionSummary;
}

interface ProjectLineageMatch {
  equivalent: boolean;
  resolvedReference: LegacyImportBatchReference | null;
}

type ResolvedClientIdentity = 'create_new' | 'use_existing';

interface CandidateValidationContext {
  allowSnapshotReconciliation?: boolean;
  p010ManifestHash?: string;
  resolvedClientIdentities?: ReadonlyMap<string, ResolvedClientIdentity>;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runtimeRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Contrato inválido: ${label}.`);
  }
  return value as Record<string, unknown>;
}

function runtimeExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const accepted = new Set(expected);
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  const unexpected = Object.keys(value).filter((key) => !accepted.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Contrato inválido: ${label}; campos ausentes=${missing.join(',') || 'nenhum'}; ` +
        `campos não autorizados=${unexpected.join(',') || 'nenhum'}.`,
    );
  }
}

function runtimeString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 10_000) {
    throw new Error(`Contrato inválido: ${label}.`);
  }
  return value;
}

function runtimeText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 10_000) {
    throw new Error(`Contrato inválido: ${label}.`);
  }
  return value;
}

function runtimeNullableText(value: unknown, label: string): string | null {
  return value === null ? null : runtimeText(value, label);
}

function runtimeSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`Contrato inválido: ${label} exige SHA-256 canônico.`);
  }
  return value;
}

function runtimeUuid(value: unknown, label: string): string {
  const parsed = runtimeString(value, label);
  if (!UUID.test(parsed)) throw new Error(`Contrato inválido: ${label} exige UUID.`);
  return parsed;
}

function runtimeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Contrato inválido: ${label} deve ser array.`);
  return value.map((entry, index) => runtimeString(entry, `${label}[${index}]`));
}

function runtimeTextArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Contrato inválido: ${label} deve ser array.`);
  return value.map((entry, index) => runtimeText(entry, `${label}[${index}]`));
}

function runtimeEnum<T extends string>(
  value: unknown,
  accepted: ReadonlySet<string>,
  label: string,
): T {
  if (typeof value !== 'string' || !accepted.has(value)) {
    throw new Error(`Contrato inválido: ${label}.`);
  }
  return value as T;
}

function runtimeDate(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new Error(`Contrato inválido: ${label}.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Contrato inválido: ${label}.`);
  }
  return value;
}

function parseProjectOrigin(value: unknown, label: string): ProjectCandidate['origins'][number] {
  const origin = runtimeRecord(value, label);
  runtimeExactKeys(
    origin,
    [
      'sheet_key',
      'sheet_name',
      'source_row_number',
      'source_range',
      'cell_address',
      'row_hash',
      'workbook_hash',
    ],
    label,
  );
  const sourceRowNumber = origin['source_row_number'];
  if (!Number.isInteger(sourceRowNumber) || (sourceRowNumber as number) <= 0) {
    throw new Error(`Contrato inválido: ${label}.source_row_number.`);
  }
  return {
    sheet_key: runtimeEnum(origin['sheet_key'], SHEET_KEYS, `${label}.sheet_key`),
    sheet_name: runtimeString(origin['sheet_name'], `${label}.sheet_name`),
    source_row_number: sourceRowNumber as number,
    source_range: runtimeString(origin['source_range'], `${label}.source_range`),
    cell_address: runtimeString(origin['cell_address'], `${label}.cell_address`),
    row_hash: runtimeSha256(origin['row_hash'], `${label}.row_hash`),
    workbook_hash: runtimeSha256(origin['workbook_hash'], `${label}.workbook_hash`),
  };
}

function parseClientCandidate(value: unknown): ClientCandidate {
  const client = runtimeRecord(value, 'reviewed-resolutions.client-candidate');
  runtimeExactKeys(client, CLIENT_CANDIDATE_KEYS, 'reviewed-resolutions.client-candidate');
  const matchedClientId = client['matched_client_id'];
  if (matchedClientId !== null && typeof matchedClientId !== 'string') {
    throw new Error('Contrato inválido: reviewed-resolutions.client-candidate.matched_client_id.');
  }
  if (typeof matchedClientId === 'string') {
    assertUuid(matchedClientId, 'Client candidate matched_client_id');
  }
  const origins = client['origins'];
  if (!Array.isArray(origins)) {
    throw new Error('Contrato inválido: reviewed-resolutions.client-candidate.origins.');
  }
  return {
    candidate_id: canonicalCandidateIdentifier(
      client['candidate_id'],
      'client',
      'reviewed-resolutions.client-candidate.candidate_id',
    ),
    client_ref: runtimeString(
      client['client_ref'],
      'reviewed-resolutions.client-candidate.client_ref',
    ),
    raw_names: runtimeTextArray(
      client['raw_names'],
      'reviewed-resolutions.client-candidate.raw_names',
    ),
    normalized_name: runtimeText(
      client['normalized_name'],
      'reviewed-resolutions.client-candidate.normalized_name',
    ),
    match_key: runtimeText(client['match_key'], 'reviewed-resolutions.client-candidate.match_key'),
    status: runtimeEnum(
      client['status'],
      CLIENT_STATUSES,
      'reviewed-resolutions.client-candidate.status',
    ),
    action: runtimeEnum(
      client['action'],
      PLAN_ACTIONS,
      'reviewed-resolutions.client-candidate.action',
    ),
    matched_client_id: matchedClientId,
    possible_matches: runtimeStringArray(
      client['possible_matches'],
      'reviewed-resolutions.client-candidate.possible_matches',
    ),
    origins: origins.map((entry, index) =>
      parseProjectOrigin(entry, `reviewed-resolutions.client-candidate.origins[${index}]`),
    ),
    diagnostic_codes: runtimeStringArray(
      client['diagnostic_codes'],
      'reviewed-resolutions.client-candidate.diagnostic_codes',
    ),
    source_manifest_hash: runtimeSha256(
      client['source_manifest_hash'],
      'reviewed-resolutions.client-candidate.source_manifest_hash',
    ),
    hash: runtimeSha256(client['hash'], 'reviewed-resolutions.client-candidate.hash'),
  };
}

function validateClientCandidateSemantics(candidate: ClientCandidate): ClientCandidate {
  if (candidate.candidate_id !== createClientCandidateId(candidate.match_key)) {
    throw new Error('REVIEWED_RESOLUTION_CANDIDATE_ID_DERIVATION_MISMATCH: client.');
  }
  const expectedAction =
    candidate.status === 'valid'
      ? new Set(['insert', 'no_op'])
      : candidate.status === 'ambiguous'
        ? new Set(['conflict'])
        : new Set(['rejected']);
  const identityRequired = candidate.status !== 'rejected';
  const canonicalName = canonicalClientName(candidate.normalized_name);
  const identityIsCanonical =
    canonicalName !== '' &&
    hasVisibleClientIdentity(canonicalName) &&
    candidate.normalized_name === canonicalName &&
    candidate.match_key === canonicalClientMatchKey(canonicalName) &&
    hasVisibleClientIdentity(candidate.match_key);
  const associationIsValid =
    candidate.status === 'valid' && candidate.action === 'no_op'
      ? candidate.matched_client_id !== null
      : candidate.matched_client_id === null;
  const diagnosticsAreValid =
    candidate.status === 'valid'
      ? candidate.diagnostic_codes.length === 0
      : candidate.status === 'ambiguous'
        ? candidate.diagnostic_codes.length === 1 &&
          candidate.diagnostic_codes[0] === 'CLIENT_MATCH_AMBIGUOUS'
        : candidate.diagnostic_codes.length === 1 &&
          candidate.diagnostic_codes[0] === 'CLIENT_NAME_MISSING';
  const possibleMatchesAreValid =
    candidate.status === 'ambiguous'
      ? candidate.possible_matches.length > 0 &&
        candidate.possible_matches.length === new Set(candidate.possible_matches).size &&
        candidate.possible_matches.every((reference) => reference !== candidate.client_ref)
      : candidate.possible_matches.length === 0;
  const rejectedIdentityIsValid =
    candidate.status !== 'rejected' ||
    (candidate.normalized_name === '' && candidate.match_key === '');
  if (
    !expectedAction.has(candidate.action) ||
    (identityRequired && !identityIsCanonical) ||
    !associationIsValid ||
    !diagnosticsAreValid ||
    !possibleMatchesAreValid ||
    !rejectedIdentityIsValid
  ) {
    throw new Error(`REVIEWED_RESOLUTION_CLIENT_SEMANTIC_INVARIANT: ${candidate.candidate_id}.`);
  }
  return candidate;
}

function assertCandidateOrigins(
  origins: ClientCandidate['origins'] | ProjectCandidate['origins'],
  candidateId: string,
): string {
  if (origins.length === 0) {
    throw new Error(`REVIEWED_RESOLUTION_CANDIDATE_ORIGIN_MISSING: ${candidateId}.`);
  }
  const originHashes = origins.map((origin) => sha256Canonical(origin));
  if (new Set(originHashes).size !== originHashes.length) {
    throw new Error(`REVIEWED_RESOLUTION_CANDIDATE_ORIGIN_DUPLICATE: ${candidateId}.`);
  }
  const workbookHashes = new Set(origins.map((origin) => origin.workbook_hash));
  if (workbookHashes.size !== 1) {
    throw new Error(`REVIEWED_RESOLUTION_CANDIDATE_ORIGIN_INCONSISTENT: ${candidateId}.`);
  }
  return origins[0]!.workbook_hash;
}

function assertClientCandidateProvenance(candidate: ClientCandidate): void {
  assertCandidateOrigins(candidate.origins, candidate.candidate_id);
  if (
    candidate.raw_names.length === 0 ||
    candidate.raw_names.some(
      (rawName) => canonicalClientMatchKey(canonicalClientName(rawName)) !== candidate.match_key,
    )
  ) {
    throw new Error(`REVIEWED_RESOLUTION_CLIENT_PROVENANCE_UNPROVEN: ${candidate.candidate_id}.`);
  }
}

function existingClientMatches(
  candidate: ClientCandidate,
  snapshot: ExistingSnapshot,
): ExistingSnapshot['clients'] {
  return snapshot.clients.filter((existing) =>
    [existing.legal_name, existing.display_name].some(
      (name) => canonicalClientMatchKey(name) === candidate.match_key,
    ),
  );
}

function deriveClientSnapshotAssociation(
  candidate: ClientCandidate,
  snapshot: ExistingSnapshot | undefined,
): { action: 'insert' | 'no_op'; matchedClientId: string | null } {
  if (snapshot === undefined) return { action: 'insert', matchedClientId: null };
  const matches = existingClientMatches(candidate, snapshot);
  if (matches.length > 1) {
    throw new Error(
      `REVIEWED_RESOLUTION_CLIENT_SNAPSHOT_MATCH_AMBIGUOUS: ${candidate.candidate_id}.`,
    );
  }
  const match = matches[0];
  if (match === undefined) return { action: 'insert', matchedClientId: null };
  if (!match.active || match.deleted_at !== null) {
    throw new Error(
      `REVIEWED_RESOLUTION_CLIENT_SNAPSHOT_MATCH_UNAVAILABLE: ${candidate.candidate_id}.`,
    );
  }
  return { action: 'no_op', matchedClientId: match.id };
}

function assertClientCandidateSetEvidence(
  candidates: ClientCandidate[],
  snapshot: ExistingSnapshot | undefined,
  context: CandidateValidationContext,
): void {
  const clientsByReference = new Map<string, ClientCandidate>();
  for (const candidate of candidates) {
    if (clientsByReference.has(candidate.client_ref)) {
      throw new Error('REVIEWED_RESOLUTION_CLIENT_REFERENCE_DUPLICATE: client.');
    }
    clientsByReference.set(candidate.client_ref, candidate);
  }
  for (const candidate of candidates) {
    assertClientCandidateProvenance(candidate);
    if (candidate.status === 'rejected') continue;
    const family = clientPossibleMatchFamily(candidate.normalized_name);
    const expected = candidates
      .filter(
        (other) =>
          other.candidate_id !== candidate.candidate_id &&
          clientPossibleMatchFamily(other.normalized_name) === family,
      )
      .map((other) => other.client_ref)
      .sort(compare);
    const resolvedIdentity = context.resolvedClientIdentities?.get(candidate.candidate_id);
    if (expected.length > 0 && resolvedIdentity === undefined) {
      if (
        family === '' ||
        candidate.status !== 'ambiguous' ||
        candidate.action !== 'conflict' ||
        candidate.diagnostic_codes.length !== 1 ||
        candidate.diagnostic_codes[0] !== 'CLIENT_MATCH_AMBIGUOUS' ||
        candidate.possible_matches.length !== expected.length ||
        candidate.possible_matches.some((reference, index) => reference !== expected[index])
      ) {
        throw new Error(
          `REVIEWED_RESOLUTION_CLIENT_AMBIGUITY_UNPROVEN: ${candidate.candidate_id}.`,
        );
      }
      continue;
    }
    if (
      candidate.status !== 'valid' ||
      candidate.diagnostic_codes.length !== 0 ||
      candidate.possible_matches.length !== 0
    ) {
      throw new Error(`REVIEWED_RESOLUTION_CLIENT_AMBIGUITY_UNPROVEN: ${candidate.candidate_id}.`);
    }
    if (candidate.action === 'no_op') {
      if (snapshot === undefined) {
        throw new Error(`REVIEWED_RESOLUTION_SNAPSHOT_INSUFFICIENT: ${candidate.candidate_id}.`);
      }
      assertExistingClient(candidate, candidate.matched_client_id!, snapshot);
    }
    const association = deriveClientSnapshotAssociation(candidate, snapshot);
    const allowSnapshotInsert =
      context.allowSnapshotReconciliation === true &&
      resolvedIdentity === undefined &&
      candidate.action === 'insert';
    if (
      !allowSnapshotInsert &&
      (candidate.action !== association.action ||
        candidate.matched_client_id !== association.matchedClientId)
    ) {
      throw new Error(
        `REVIEWED_RESOLUTION_CLIENT_DERIVED_STATE_MISMATCH: ${candidate.candidate_id}.`,
      );
    }
  }
}

function parseFinancialEvidence(
  value: unknown,
  label: string,
): ProjectCandidate['value_evidence'][number] {
  const evidence = runtimeRecord(value, label);
  runtimeExactKeys(
    evidence,
    [
      'raw_number',
      'decimal_round_trip_string',
      'formatted_text',
      'number_format',
      'coordinate',
      'row_hash',
      'mapping_status',
      'target_field',
    ],
    label,
  );
  const rawNumber = evidence['raw_number'];
  if (typeof rawNumber !== 'number' || !Number.isFinite(rawNumber)) {
    throw new Error(`Contrato inválido: ${label}.raw_number.`);
  }
  const formattedText = evidence['formatted_text'];
  const numberFormat = evidence['number_format'];
  const targetField = evidence['target_field'];
  if (formattedText !== null && typeof formattedText !== 'string') {
    throw new Error(`Contrato inválido: ${label}.formatted_text.`);
  }
  if (numberFormat !== null && typeof numberFormat !== 'string') {
    throw new Error(`Contrato inválido: ${label}.number_format.`);
  }
  if (targetField !== null && typeof targetField !== 'string') {
    throw new Error(`Contrato inválido: ${label}.target_field.`);
  }
  return {
    raw_number: rawNumber,
    decimal_round_trip_string: runtimeString(
      evidence['decimal_round_trip_string'],
      `${label}.decimal_round_trip_string`,
    ),
    formatted_text: formattedText,
    number_format: numberFormat,
    coordinate: runtimeString(evidence['coordinate'], `${label}.coordinate`),
    row_hash: runtimeSha256(evidence['row_hash'], `${label}.row_hash`),
    mapping_status: runtimeEnum(
      evidence['mapping_status'],
      MAPPING_STATUSES,
      `${label}.mapping_status`,
    ),
    target_field: targetField,
  };
}

function parseProjectLegacyReference(value: unknown): LegacyImportBatchReference | null {
  if (value === null) return null;
  const reference = runtimeRecord(value, 'project-lineage.project.legacy_import_batch_reference');
  if (reference['kind'] === 'existing') {
    runtimeExactKeys(
      reference,
      ['kind', 'import_batch_id'],
      'project-lineage.project.legacy_import_batch_reference',
    );
    const parsed: LegacyImportBatchReference = {
      kind: 'existing',
      import_batch_id: runtimeUuid(
        reference['import_batch_id'],
        'project-lineage.project.legacy_import_batch_reference.import_batch_id',
      ),
    };
    return assertLegacyImportBatchReference(parsed);
  }
  runtimeExactKeys(
    reference,
    ['kind', 'planned_key', 'idempotency_key', 'source_manifest_hash', 'source_hash'],
    'project-lineage.project.legacy_import_batch_reference',
  );
  runtimeEnum(
    reference['kind'],
    new Set(['planned']),
    'project-lineage.project.legacy_import_batch_reference.kind',
  );
  const parsed: LegacyImportBatchReference = {
    kind: 'planned',
    planned_key: runtimeString(
      reference['planned_key'],
      'project-lineage.project.legacy_import_batch_reference.planned_key',
    ),
    idempotency_key: runtimeString(
      reference['idempotency_key'],
      'project-lineage.project.legacy_import_batch_reference.idempotency_key',
    ),
    source_manifest_hash: runtimeSha256(
      reference['source_manifest_hash'],
      'project-lineage.project.legacy_import_batch_reference.source_manifest_hash',
    ),
    source_hash: runtimeSha256(
      reference['source_hash'],
      'project-lineage.project.legacy_import_batch_reference.source_hash',
    ),
  };
  return assertLegacyImportBatchReference(parsed);
}

function parseProjectCandidate(value: unknown): ProjectCandidate {
  const project = runtimeRecord(value, 'project-lineage.project');
  runtimeExactKeys(project, PROJECT_CANDIDATE_KEYS, 'project-lineage.project');
  const clientId = project['client_id'];
  const currency = project['currency'];
  const classification = project['classification'];
  const operationalStatus = project['operational_status'];
  const matchedBatchId = project['matched_legacy_import_batch_id'];
  if (clientId !== null && typeof clientId !== 'string') {
    throw new Error('Contrato inválido: project-lineage.project.client_id.');
  }
  if (typeof clientId === 'string') assertUuid(clientId, 'Project candidate client_id');
  if (currency !== null && (typeof currency !== 'string' || !CURRENCY_CODE.test(currency))) {
    throw new Error('Contrato inválido: project-lineage.project.currency.');
  }
  if (
    classification !== null &&
    (typeof classification !== 'string' || !PROJECT_CLASSIFICATIONS.has(classification))
  ) {
    throw new Error('Contrato inválido: project-lineage.project.classification.');
  }
  if (
    operationalStatus !== null &&
    (typeof operationalStatus !== 'string' || !PROJECT_STATUSES.has(operationalStatus))
  ) {
    throw new Error('Contrato inválido: project-lineage.project.operational_status.');
  }
  if (matchedBatchId !== null && typeof matchedBatchId !== 'string') {
    throw new Error('Contrato inválido: project-lineage.project.matched_legacy_import_batch_id.');
  }
  if (typeof matchedBatchId === 'string') {
    assertUuid(matchedBatchId, 'Project candidate matched_legacy_import_batch_id');
  }
  const valueEvidence = project['value_evidence'];
  const receiptEvidence = project['receipt_forecast_evidence'];
  const origins = project['origins'];
  if (!Array.isArray(valueEvidence) || !Array.isArray(receiptEvidence) || !Array.isArray(origins)) {
    throw new Error('Contrato inválido: project-lineage.project evidence/origins.');
  }
  return {
    candidate_id: canonicalCandidateIdentifier(
      project['candidate_id'],
      'project',
      'project-lineage.project.candidate_id',
    ),
    raw_codes: runtimeStringArray(project['raw_codes'], 'project-lineage.project.raw_codes'),
    project_code: runtimeString(project['project_code'], 'project-lineage.project.project_code'),
    raw_project_label: runtimeString(
      project['raw_project_label'],
      'project-lineage.project.raw_project_label',
    ),
    project_name_proposal: runtimeText(
      project['project_name_proposal'],
      'project-lineage.project.project_name_proposal',
    ),
    project_name_mapping_status: runtimeEnum(
      project['project_name_mapping_status'],
      MAPPING_STATUSES,
      'project-lineage.project.project_name_mapping_status',
    ),
    client_match_key: runtimeNullableText(
      project['client_match_key'],
      'project-lineage.project.client_match_key',
    ),
    client_candidate_id:
      project['client_candidate_id'] === null
        ? null
        : canonicalCandidateIdentifier(
            project['client_candidate_id'],
            'client',
            'project-lineage.project.client_candidate_id',
          ),
    client_id: clientId,
    currency,
    raw_classifications: runtimeStringArray(
      project['raw_classifications'],
      'project-lineage.project.raw_classifications',
    ),
    classification: classification as ProjectCandidate['classification'],
    operational_status: operationalStatus as ProjectCandidate['operational_status'],
    contract_value:
      project['contract_value'] === null
        ? null
        : canonicalContractValue(
            project['contract_value'],
            'project-lineage.project.contract_value',
          ),
    data_reference_date: runtimeDate(
      project['data_reference_date'],
      'project-lineage.project.data_reference_date',
    ),
    legacy_import_batch_reference: parseProjectLegacyReference(
      project['legacy_import_batch_reference'],
    ),
    matched_legacy_import_batch_id: matchedBatchId,
    value_evidence: valueEvidence.map((entry, index) =>
      parseFinancialEvidence(entry, `project-lineage.project.value_evidence[${index}]`),
    ),
    receipt_forecast_evidence: receiptEvidence.map((entry, index) =>
      parseFinancialEvidence(entry, `project-lineage.project.receipt_forecast_evidence[${index}]`),
    ),
    action: runtimeEnum(project['action'], PLAN_ACTIONS, 'project-lineage.project.action'),
    origins: origins.map((entry, index) =>
      parseProjectOrigin(entry, `project-lineage.project.origins[${index}]`),
    ),
    diagnostic_codes: runtimeStringArray(
      project['diagnostic_codes'],
      'project-lineage.project.diagnostic_codes',
    ),
    source_manifest_hash: runtimeSha256(
      project['source_manifest_hash'],
      'project-lineage.project.source_manifest_hash',
    ),
    hash: runtimeSha256(project['hash'], 'project-lineage.project.hash'),
  };
}

function assertProjectCandidateProvenance(project: ProjectCandidate): void {
  const workbookHash = assertCandidateOrigins(project.origins, project.candidate_id);
  if (
    project.raw_codes.length === 0 ||
    !project.raw_codes.some((rawCode) => rawCode.trim() === project.project_code)
  ) {
    throw new Error(`REVIEWED_RESOLUTION_PROJECT_PROVENANCE_UNPROVEN: ${project.candidate_id}.`);
  }
  if (project.contract_value !== null) {
    const valueIsProven = project.value_evidence.some(
      (evidence) =>
        evidence.mapping_status === 'mapped' &&
        evidence.target_field === 'projects.contract_value' &&
        evidence.decimal_round_trip_string === project.contract_value &&
        evidence.raw_number === Number(project.contract_value),
    );
    if (!valueIsProven) {
      throw new Error(
        `REVIEWED_RESOLUTION_PROJECT_VALUE_EVIDENCE_UNPROVEN: ${project.candidate_id}.`,
      );
    }
  }
  const reference = project.legacy_import_batch_reference;
  if (
    reference?.kind === 'planned' &&
    (reference.source_manifest_hash !== project.source_manifest_hash ||
      reference.source_hash !== workbookHash)
  ) {
    throw new Error(
      `REVIEWED_RESOLUTION_PROJECT_SOURCE_COUPLING_MISMATCH: ${project.candidate_id}.`,
    );
  }
}

function deriveProjectClassification(
  project: ProjectCandidate,
): ProjectCandidate['classification'] {
  const classifications = new Set(
    project.raw_classifications.map((value) =>
      value === 'demanda' ? 'demand' : value === 'saldo' ? 'opening_balance' : 'full_contract',
    ),
  );
  return classifications.size === 0
    ? 'full_contract'
    : classifications.size === 1
      ? ([...classifications][0] as ProjectCandidate['classification'])
      : null;
}

function projectHasRequiredFinalFields(project: ProjectCandidate): boolean {
  const canonicalProjectName = canonicalClientName(project.project_name_proposal);
  return (
    project.project_name_mapping_status === 'mapped' &&
    canonicalProjectName !== '' &&
    project.project_name_proposal === canonicalProjectName &&
    hasVisibleClientIdentity(canonicalProjectName) &&
    project.client_match_key !== null &&
    project.client_candidate_id !== null &&
    project.classification !== null &&
    project.operational_status !== null &&
    project.currency !== null &&
    project.contract_value !== null &&
    (project.data_reference_date !== null || project.legacy_import_batch_reference !== null)
  );
}

function projectHasMinimumInsertFields(project: ProjectCandidate): boolean {
  return projectHasRequiredFinalFields(project) && !hasHardProjectDiagnostic(project);
}

function projectHasBlockingDiagnostic(project: ProjectCandidate): boolean {
  return project.diagnostic_codes.some((code) => {
    if (!PROJECT_NON_BLOCKING_DIAGNOSTICS.has(code)) return true;
    return (
      code === 'PROJECT_DATA_REFERENCE_DATE_MISSING' &&
      (project.data_reference_date !== null || project.legacy_import_batch_reference === null)
    );
  });
}

function projectHasPendingFields(project: ProjectCandidate): boolean {
  return !projectHasMinimumInsertFields(project);
}

function projectHasRejectionDiagnostic(project: ProjectCandidate): boolean {
  return project.diagnostic_codes.some(
    (code) => PROJECT_DIAGNOSTIC_KINDS.get(code) === 'rejection',
  );
}

function projectClientIsResolved(
  project: ProjectCandidate,
  clientsById: Map<string, ClientCandidate>,
): boolean {
  if (project.client_candidate_id === null || project.client_match_key === null) return false;
  const client = clientsById.get(project.client_candidate_id);
  return (
    client !== undefined &&
    client.status === 'valid' &&
    ['insert', 'no_op'].includes(client.action) &&
    project.client_match_key === client.match_key &&
    project.client_id === client.matched_client_id
  );
}

function projectValueConflictIsEvidenced(project: ProjectCandidate): boolean {
  if (project.project_code === '2026-04-16531') {
    return (
      (project.contract_value !== null && project.contract_value !== '164000') ||
      project.value_evidence.some((evidence) => evidence.raw_number !== 164000)
    );
  }
  if (project.project_code === '2024-02-10990') {
    return !project.receipt_forecast_evidence.some(
      (evidence) =>
        evidence.raw_number === 369749.1735 && evidence.mapping_status === 'evidence_only',
    );
  }
  return false;
}

function deriveProjectRequiredDiagnostics(
  project: ProjectCandidate,
  clientsById: Map<string, ClientCandidate>,
): string[] {
  const diagnostics: string[] = [];
  if (!projectClientIsResolved(project, clientsById)) {
    diagnostics.push('PROJECT_CLIENT_UNRESOLVED');
  }
  if (project.currency === null) {
    diagnostics.push('PROJECT_CURRENCY_UNRESOLVED');
  }
  const derivedClassification = deriveProjectClassification(project);
  if (project.classification !== derivedClassification) {
    throw new Error(
      `REVIEWED_RESOLUTION_PROJECT_CLASSIFICATION_DERIVATION_MISMATCH: ${project.candidate_id}.`,
    );
  }
  if (derivedClassification === null) diagnostics.push('PROJECT_CLASSIFICATION_CONFLICT');
  if (projectValueConflictIsEvidenced(project)) diagnostics.push('PROJECT_VALUE_CONFLICT');
  if (project.data_reference_date === null) {
    diagnostics.push('PROJECT_DATA_REFERENCE_DATE_MISSING');
  }
  if (
    project.project_code === '2024-02-10990' &&
    project.receipt_forecast_evidence.some(
      (evidence) =>
        evidence.raw_number === 369749.1735 && evidence.mapping_status === 'evidence_only',
    )
  ) {
    diagnostics.push('RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE');
  }
  return [...new Set(diagnostics)].sort(compare);
}

function validateProjectCandidateSemantics(candidate: ProjectCandidate): ProjectCandidate {
  if (candidate.candidate_id !== createProjectCandidateId(candidate.project_code)) {
    throw new Error('REVIEWED_RESOLUTION_CANDIDATE_ID_DERIVATION_MISMATCH: project.');
  }
  const complete = projectHasMinimumInsertFields(candidate);
  const blockingDiagnostic = projectHasBlockingDiagnostic(candidate);
  const conflictDiagnostic = candidate.diagnostic_codes.some((code) =>
    PROJECT_CONFLICT_DIAGNOSTICS.has(code),
  );
  const rejectionDiagnostic = projectHasRejectionDiagnostic(candidate);
  const canonicalDiagnostics = [...new Set(candidate.diagnostic_codes)].sort(compare);
  const valid =
    canonicalDiagnostics.length === candidate.diagnostic_codes.length &&
    canonicalDiagnostics.every((code, index) => code === candidate.diagnostic_codes[index]) &&
    candidate.diagnostic_codes.every((code) => PROJECT_DIAGNOSTIC_KINDS.has(code)) &&
    ((candidate.action === 'insert' && complete && !blockingDiagnostic) ||
      (candidate.action === 'no_op' && complete && !blockingDiagnostic) ||
      (candidate.action === 'conflict' && blockingDiagnostic && conflictDiagnostic) ||
      (candidate.action === 'pending_decision' &&
        projectHasPendingFields(candidate) &&
        !rejectionDiagnostic &&
        !conflictDiagnostic) ||
      (candidate.action === 'rejected' && rejectionDiagnostic && !conflictDiagnostic));
  if (!valid) {
    throw new Error(`REVIEWED_RESOLUTION_PROJECT_SEMANTIC_INVARIANT: ${candidate.candidate_id}.`);
  }
  return candidate;
}

function validateCandidateHash<T extends ClientCandidate | ProjectCandidate>(
  candidate: T,
  entity: 'client' | 'project',
): T {
  const actualHash = hashCandidate(candidate);
  if (candidate.hash !== actualHash) {
    throw new Error(
      `REVIEWED_RESOLUTION_CANDIDATE_CONTENT_HASH_MISMATCH: ${entity}:${candidate.candidate_id}.`,
    );
  }
  return candidate;
}

function parseSemanticClientCandidate(value: unknown): ClientCandidate {
  return validateClientCandidateSemantics(parseClientCandidate(value));
}

function parseSemanticProjectCandidate(value: unknown): ProjectCandidate {
  return validateProjectCandidateSemantics(parseProjectCandidate(value));
}

function parseValidatedProjectCandidate(value: unknown): ProjectCandidate {
  const project = parseSemanticProjectCandidate(value);
  assertProjectCandidateProvenance(project);
  return validateCandidateHash(project, 'project');
}

function parseValidatedCandidateSetInternal(
  clients: unknown,
  projects: unknown,
  snapshot: ExistingSnapshot | undefined,
  context: CandidateValidationContext,
): { clients: ClientCandidate[]; projects: ProjectCandidate[] } {
  if (!Array.isArray(clients) || !Array.isArray(projects)) {
    throw new Error('Contrato inválido: candidate set exige arrays de clientes e projetos.');
  }
  const validatedSnapshot = snapshot === undefined ? undefined : parseExistingSnapshot(snapshot);
  const semanticClients = clients.map(parseSemanticClientCandidate);
  const semanticProjects = projects.map(parseSemanticProjectCandidate);
  const ids = new Set<string>();
  for (const candidate of [...semanticClients, ...semanticProjects]) {
    const candidateId = candidate.candidate_id.toLowerCase();
    if (ids.has(candidateId)) {
      throw new Error(`REVIEWED_RESOLUTION_CANDIDATE_ID_DUPLICATE: ${candidate.candidate_id}.`);
    }
    ids.add(candidateId);
  }
  const sourceManifestHashes = new Set(
    [...semanticClients, ...semanticProjects].map((candidate) => candidate.source_manifest_hash),
  );
  if (sourceManifestHashes.size > 1) {
    throw new Error('REVIEWED_RESOLUTION_CANDIDATE_SOURCE_MANIFEST_MISMATCH: candidate-set.');
  }
  if (
    context.p010ManifestHash !== undefined &&
    [...sourceManifestHashes].some((hash) => hash !== context.p010ManifestHash)
  ) {
    throw new Error('REVIEWED_RESOLUTION_CANDIDATE_SOURCE_MANIFEST_MISMATCH: binding.');
  }
  assertClientCandidateSetEvidence(semanticClients, validatedSnapshot, context);
  const clientsById = new Map(
    semanticClients.map((candidate) => [candidate.candidate_id, candidate]),
  );
  for (const project of semanticProjects) {
    assertProjectCandidateProvenance(project);
    assertProjectDerivedState(project, clientsById, validatedSnapshot, context);
  }
  const validatedClients = semanticClients.map((candidate) =>
    validateCandidateHash(candidate, 'client'),
  );
  const validatedProjects = semanticProjects.map((candidate) =>
    validateCandidateHash(candidate, 'project'),
  );
  return { clients: validatedClients, projects: validatedProjects };
}

/** @internal Shared candidate-integrity boundary for P011 programmatic entry points. */
export function parseValidatedCandidateSet(
  clients: unknown,
  projects: unknown,
  snapshot?: ExistingSnapshot,
): { clients: ClientCandidate[]; projects: ProjectCandidate[] } {
  return parseValidatedCandidateSetInternal(clients, projects, snapshot, {});
}

/** @internal Validates declared pre-snapshot state before canonical reconciliation. */
export function parseCandidateSetForSnapshotReconciliation(
  clients: unknown,
  projects: unknown,
  snapshot: ExistingSnapshot,
): { clients: ClientCandidate[]; projects: ProjectCandidate[] } {
  return parseValidatedCandidateSetInternal(clients, projects, snapshot, {
    allowSnapshotReconciliation: true,
  });
}

function projectHasEquivalentSnapshotTarget(
  project: ProjectCandidate,
  client: ClientCandidate | undefined,
  target: ExistingSnapshot['projects'][number] | undefined,
  snapshot: ExistingSnapshot,
): boolean {
  const lineage =
    target === undefined ? undefined : matchValidatedProjectLineage(project, target, snapshot);
  return (
    client?.status === 'valid' &&
    client.action === 'no_op' &&
    client.matched_client_id !== null &&
    project.client_match_key === client.match_key &&
    project.client_id === client.matched_client_id &&
    target !== undefined &&
    target.project_name === project.project_name_proposal &&
    target.client_id.toLowerCase() === project.client_id.toLowerCase() &&
    target.classification === project.classification &&
    target.status === project.operational_status &&
    target.base_currency === project.currency &&
    target.contract_value === project.contract_value &&
    (target.legacy_import_batch_id === null
      ? project.matched_legacy_import_batch_id === null
      : project.matched_legacy_import_batch_id?.toLowerCase() ===
        target.legacy_import_batch_id.toLowerCase()) &&
    lineage?.equivalent === true
  );
}

function deriveProjectAction(
  project: ProjectCandidate,
  clientsById: Map<string, ClientCandidate>,
  diagnostics: string[],
  snapshot: ExistingSnapshot | undefined,
): { action: ProjectCandidate['action']; diagnostics: string[] } {
  const client =
    project.client_candidate_id === null ? undefined : clientsById.get(project.client_candidate_id);
  const hardDiagnostic = diagnostics.some((code) => HARD_PROJECT_DIAGNOSTICS.has(code));
  const complete =
    projectHasRequiredFinalFields(project) &&
    projectClientIsResolved(project, clientsById) &&
    !hardDiagnostic;
  const derivedDiagnostics = [...diagnostics];
  let action: ProjectCandidate['action'];
  if (diagnostics.some((code) => PROJECT_DIAGNOSTIC_KINDS.get(code) === 'conflict')) {
    action = 'conflict';
  } else if (diagnostics.some((code) => PROJECT_DIAGNOSTIC_KINDS.get(code) === 'rejection')) {
    action = 'rejected';
  } else {
    action = complete ? 'insert' : 'pending_decision';
  }
  if (snapshot !== undefined) {
    const targets = snapshot.projects.filter(
      (candidate) =>
        candidate.project_code.toUpperCase() === project.project_code.toUpperCase() &&
        candidate.deleted_at === null,
    );
    if (targets.length > 1) {
      derivedDiagnostics.push('PROJECT_DUPLICATE_CONFLICT');
      action = 'conflict';
    } else if (targets.length === 1 && complete) {
      const equivalent = projectHasEquivalentSnapshotTarget(project, client, targets[0], snapshot);
      if (equivalent) {
        action = 'no_op';
      } else {
        derivedDiagnostics.push('PROTECTED_RECORD_CONFLICT');
        action = 'conflict';
      }
    }
  }
  return { action, diagnostics: [...new Set(derivedDiagnostics)].sort(compare) };
}

function assertProjectDerivedState(
  project: ProjectCandidate,
  clientsById: Map<string, ClientCandidate>,
  snapshot: ExistingSnapshot | undefined,
  context: CandidateValidationContext,
): void {
  const requiredDiagnostics = deriveProjectRequiredDiagnostics(project, clientsById);
  const useSnapshotState =
    snapshot !== undefined &&
    !(
      context.allowSnapshotReconciliation === true &&
      !['conflict', 'no_op'].includes(project.action)
    );
  const derived = deriveProjectAction(
    project,
    clientsById,
    requiredDiagnostics,
    useSnapshotState ? snapshot : undefined,
  );
  const diagnosticsMatch =
    project.diagnostic_codes.length === derived.diagnostics.length &&
    project.diagnostic_codes.every((code, index) => code === derived.diagnostics[index]);
  if (project.action === derived.action && diagnosticsMatch) return;
  if (project.action === 'conflict') {
    throw new Error(`REVIEWED_RESOLUTION_PROJECT_CONFLICT_UNPROVEN: ${project.candidate_id}.`);
  }
  if (project.action === 'no_op') {
    throw new Error(`REVIEWED_RESOLUTION_PROJECT_NO_OP_UNPROVEN: ${project.candidate_id}.`);
  }
  if (project.action === 'rejected') {
    throw new Error(`REVIEWED_RESOLUTION_PROJECT_DIAGNOSTIC_UNPROVEN: ${project.candidate_id}.`);
  }
  throw new Error(`REVIEWED_RESOLUTION_PROJECT_DERIVED_STATE_MISMATCH: ${project.candidate_id}.`);
}

function parseProjectTarget(
  value: unknown,
  snapshot: ExistingSnapshot,
): ExistingSnapshot['projects'][number] {
  const targetHash = sha256Canonical(value);
  const matches = snapshot.projects.filter((project) => sha256Canonical(project) === targetHash);
  if (matches.length !== 1) {
    throw new Error('Contrato inválido: project-lineage.target não pertence ao snapshot validado.');
  }
  return matches[0]!;
}

function parseExpectedReviewBinding(value: unknown): ReviewBinding {
  const binding = runtimeRecord(value, 'review-binding');
  runtimeExactKeys(
    binding,
    [
      'contract',
      'normalizer_version',
      'normalization_manifest_hash',
      'p010_manifest_hash',
      'input_hash',
      'snapshot_hash',
      'candidate_set_hash',
    ],
    'review-binding',
  );
  if (binding['contract'] !== REVIEW_BINDING_CONTRACT) {
    throw new Error('REVIEWED_RESOLUTION_BINDING_CONTRACT_MISMATCH: contract.');
  }
  if (binding['normalizer_version'] !== NORMALIZER_VERSION) {
    throw new Error('REVIEWED_RESOLUTION_RUNTIME_VERSION_MISMATCH: normalizer_version.');
  }
  return {
    contract: REVIEW_BINDING_CONTRACT,
    normalizer_version: NORMALIZER_VERSION,
    normalization_manifest_hash: runtimeSha256(
      binding['normalization_manifest_hash'],
      'review-binding.normalization_manifest_hash',
    ),
    p010_manifest_hash: runtimeSha256(
      binding['p010_manifest_hash'],
      'review-binding.p010_manifest_hash',
    ),
    input_hash: runtimeSha256(binding['input_hash'], 'review-binding.input_hash'),
    snapshot_hash: runtimeSha256(binding['snapshot_hash'], 'review-binding.snapshot_hash'),
    candidate_set_hash: runtimeSha256(
      binding['candidate_set_hash'],
      'review-binding.candidate_set_hash',
    ),
  };
}

function hashCandidate(candidate: ClientCandidate | ProjectCandidate): string {
  return sha256Canonical({ ...candidate, hash: undefined });
}

function canonicalSort<T>(values: T[]): T[] {
  return [...values].sort((left, right) => compare(sha256Canonical(left), sha256Canonical(right)));
}

function createValidatedSnapshotHash(snapshot: ExistingSnapshot): string {
  return sha256Canonical({
    contract: snapshot.contract,
    currencies: canonicalSort(snapshot.currencies),
    clients: canonicalSort(snapshot.clients),
    import_batches: canonicalSort(snapshot.import_batches),
    projects: canonicalSort(snapshot.projects),
  });
}

export function createSnapshotHash(snapshot: ExistingSnapshot): string {
  return createValidatedSnapshotHash(parseExistingSnapshot(snapshot));
}

function matchValidatedProjectLineage(
  project: ProjectCandidate,
  target: ExistingSnapshot['projects'][number],
  snapshot: ExistingSnapshot,
): ProjectLineageMatch {
  const reference = project.legacy_import_batch_reference;
  if (target.data_reference_date !== project.data_reference_date) {
    return { equivalent: false, resolvedReference: reference };
  }
  if (reference === null) {
    return {
      equivalent: target.legacy_import_batch_id === null,
      resolvedReference: null,
    };
  }
  if (reference.kind === 'existing') {
    return {
      equivalent:
        target.legacy_import_batch_id?.toLowerCase() === reference.import_batch_id.toLowerCase(),
      resolvedReference: reference,
    };
  }
  if (target.legacy_import_batch_id === null) {
    return { equivalent: false, resolvedReference: reference };
  }
  const targetId = target.legacy_import_batch_id.toLowerCase();
  const batchesById = snapshot.import_batches.filter(
    (batch) => batch.id.toLowerCase() === targetId,
  );
  const batchesByLineage = snapshot.import_batches.filter(
    (batch) =>
      batch.idempotency_key === reference.idempotency_key &&
      batch.source_hash === reference.source_hash,
  );
  const equivalent =
    batchesById.length === 1 &&
    batchesByLineage.length === 1 &&
    batchesByLineage[0]?.id.toLowerCase() === targetId;
  return {
    equivalent,
    resolvedReference: equivalent
      ? { kind: 'existing', import_batch_id: target.legacy_import_batch_id }
      : reference,
  };
}

export function matchProjectLineage(
  project: ProjectCandidate,
  target: ExistingSnapshot['projects'][number],
  snapshot: ExistingSnapshot,
): ProjectLineageMatch {
  const validatedProject = parseValidatedProjectCandidate(project);
  const validatedSnapshot = parseExistingSnapshot(snapshot);
  const validatedTarget = parseProjectTarget(target, validatedSnapshot);
  return matchValidatedProjectLineage(validatedProject, validatedTarget, validatedSnapshot);
}

function createValidatedCandidateSetHash(
  clients: ClientCandidate[],
  projects: ProjectCandidate[],
): string {
  return sha256Canonical({
    clients: clients
      .map((candidate) => ({
        candidate_id: candidate.candidate_id,
        candidate_hash: candidate.hash,
      }))
      .sort(
        (left, right) =>
          compare(left.candidate_id, right.candidate_id) ||
          compare(left.candidate_hash, right.candidate_hash),
      ),
    projects: projects
      .map((candidate) => ({
        candidate_id: candidate.candidate_id,
        candidate_hash: candidate.hash,
      }))
      .sort(
        (left, right) =>
          compare(left.candidate_id, right.candidate_id) ||
          compare(left.candidate_hash, right.candidate_hash),
      ),
  });
}

function createNormalizationManifestHash(
  normalizerVersion: string,
  p010ManifestHash: string,
  inputHash: string,
  snapshotHash: string,
  candidateSetHash: string,
): string {
  return sha256Canonical({
    artifact_contract: 'ltcm.p011.normalization-manifest.v2',
    normalizer_version: normalizerVersion,
    p010_manifest_hash: p010ManifestHash,
    input_hash: inputHash,
    snapshot_hash: snapshotHash,
    candidate_set_hash: candidateSetHash,
  });
}

export function createReviewBinding(...args: unknown[]): ReviewBinding {
  const [sourceProof, normalizerVersion, p010ManifestHash, inputHash, snapshot, clients, projects] =
    args.length === 7 ? args : [undefined, ...args];
  if (normalizerVersion !== NORMALIZER_VERSION) {
    throw new Error('REVIEWED_RESOLUTION_RUNTIME_VERSION_MISMATCH: normalizer_version.');
  }
  const validatedP010ManifestHash = runtimeSha256(
    p010ManifestHash,
    'review-binding.p010_manifest_hash',
  );
  const validatedInputHash = runtimeSha256(inputHash, 'review-binding.input_hash');
  const validatedSnapshot = parseExistingSnapshot(snapshot);
  if (!Array.isArray(clients) || !Array.isArray(projects)) {
    throw new Error('Contrato invÃ¡lido: candidate set exige arrays de clientes e projetos.');
  }
  const validatedCandidates = parseValidatedCandidateSetInternal(
    clients,
    projects,
    validatedSnapshot,
    {
      p010ManifestHash: validatedP010ManifestHash,
    },
  );
  assertSourceProvenCandidateProof(
    sourceProof,
    validatedP010ManifestHash,
    validatedInputHash,
    validatedSnapshot,
    validatedCandidates.clients,
    validatedCandidates.projects,
  );
  const snapshotHash = createValidatedSnapshotHash(validatedSnapshot);
  const candidateSetHash = createValidatedCandidateSetHash(
    validatedCandidates.clients,
    validatedCandidates.projects,
  );
  const normalizationManifestHash = createNormalizationManifestHash(
    NORMALIZER_VERSION,
    validatedP010ManifestHash,
    validatedInputHash,
    snapshotHash,
    candidateSetHash,
  );
  return {
    contract: REVIEW_BINDING_CONTRACT,
    normalizer_version: NORMALIZER_VERSION,
    normalization_manifest_hash: normalizationManifestHash,
    p010_manifest_hash: validatedP010ManifestHash,
    input_hash: validatedInputHash,
    snapshot_hash: snapshotHash,
    candidate_set_hash: candidateSetHash,
  };
}

function assertBinding(document: ReviewedResolutionDocument, expected: ReviewBinding): void {
  if (document.contract !== 'ltcm.p011.reviewed-resolutions.v1') {
    throw new Error('REVIEWED_RESOLUTION_CONTRACT_MISMATCH: contract.');
  }
  for (const field of [
    'normalizer_version',
    'p010_manifest_hash',
    'input_hash',
    'snapshot_hash',
    'candidate_set_hash',
    'normalization_manifest_hash',
  ] as const) {
    if (document[field] !== expected[field]) {
      throw new Error(`REVIEWED_RESOLUTION_BINDING_MISMATCH: ${field}.`);
    }
  }
}

function assertClientReviewable(candidate: ClientCandidate, resolution: ReviewedResolution): void {
  if (
    resolution.type !== 'client_identity' ||
    candidate.status !== 'ambiguous' ||
    !candidate.diagnostic_codes.includes('CLIENT_MATCH_AMBIGUOUS') ||
    candidate.diagnostic_codes.some((code) => code !== 'CLIENT_MATCH_AMBIGUOUS')
  ) {
    throw new Error(`REVIEWED_RESOLUTION_CLIENT_NOT_REVIEWABLE: ${candidate.candidate_id}.`);
  }
}

function assertExistingClient(
  candidate: ClientCandidate,
  clientId: string,
  snapshot: ExistingSnapshot,
): void {
  assertUuid(clientId, 'Identidade revisada de cliente');
  if (snapshot.clients.length === 0) {
    throw new Error(`REVIEWED_RESOLUTION_SNAPSHOT_INSUFFICIENT: ${candidate.candidate_id}.`);
  }
  const matches = snapshot.clients.filter(
    (client) => client.id.toLowerCase() === clientId.toLowerCase(),
  );
  if (matches.length === 0) {
    throw new Error(`REVIEWED_RESOLUTION_EXISTING_CLIENT_NOT_FOUND: ${candidate.candidate_id}.`);
  }
  const existing = matches.length === 1 ? matches[0] : undefined;
  const compatible =
    existing !== undefined &&
    existing.active === true &&
    existing.deleted_at === null &&
    [existing.legal_name, existing.display_name].some(
      (name) => typeof name === 'string' && canonicalClientMatchKey(name) === candidate.match_key,
    );
  if (!compatible) {
    throw new Error(`REVIEWED_RESOLUTION_EXISTING_CLIENT_INCOMPATIBLE: ${candidate.candidate_id}.`);
  }
}

function assertResolutionSet(
  document: ReviewedResolutionDocument,
  clientsById: Map<string, ClientCandidate>,
  projectsById: Map<string, ProjectCandidate>,
  snapshot: ExistingSnapshot,
): void {
  const seen = new Set<string>();
  for (const resolution of document.resolutions) {
    const key = `${resolution.type}:${resolution.candidate_id}`;
    if (seen.has(key)) throw new Error(`REVIEWED_RESOLUTION_DUPLICATE: ${key}.`);
    seen.add(key);
    const candidate =
      resolution.type === 'client_identity'
        ? clientsById.get(resolution.candidate_id)
        : projectsById.get(resolution.candidate_id);
    if (candidate === undefined) {
      throw new Error(`REVIEWED_RESOLUTION_CANDIDATE_NOT_FOUND: ${resolution.candidate_id}.`);
    }
    if (!SHA256.test(resolution.candidate_hash) || resolution.candidate_hash !== candidate.hash) {
      throw new Error(`REVIEWED_RESOLUTION_CANDIDATE_HASH_MISMATCH: ${resolution.candidate_id}.`);
    }
    if (resolution.type === 'client_identity') {
      const client = candidate as ClientCandidate;
      assertClientReviewable(client, resolution);
      if (resolution.identity.kind === 'use_existing') {
        assertExistingClient(client, resolution.identity.client_id, snapshot);
      }
    } else {
      const project = candidate as ProjectCandidate;
      if (
        resolution.approved_name !== undefined &&
        project.project_name_mapping_status !== 'pending_decision'
      ) {
        throw new Error(
          `REVIEWED_RESOLUTION_PROJECT_NAME_NOT_REVIEWABLE: ${resolution.candidate_id}.`,
        );
      }
      if (resolution.approved_status !== undefined && project.operational_status !== null) {
        throw new Error(
          `REVIEWED_RESOLUTION_PROJECT_STATUS_NOT_REVIEWABLE: ${resolution.candidate_id}.`,
        );
      }
    }
  }
}

function hasHardProjectDiagnostic(candidate: ProjectCandidate): boolean {
  return candidate.diagnostic_codes.some((code) => HARD_PROJECT_DIAGNOSTICS.has(code));
}

function linkResolvedClient(
  project: ProjectCandidate,
  clientsById: Map<string, ClientCandidate>,
): ClientCandidate | undefined {
  const client =
    project.client_candidate_id === null ? undefined : clientsById.get(project.client_candidate_id);
  if (
    client?.status === 'valid' &&
    ['insert', 'no_op'].includes(client.action) &&
    project.client_match_key === client.match_key
  ) {
    project.client_id = client.matched_client_id;
    project.diagnostic_codes = project.diagnostic_codes.filter(
      (code) => code !== 'PROJECT_CLIENT_UNRESOLVED',
    );
  }
  return client;
}

function projectIsComplete(
  project: ProjectCandidate,
  client: ClientCandidate | undefined,
): boolean {
  return (
    projectHasMinimumInsertFields(project) &&
    client?.status === 'valid' &&
    ['insert', 'no_op'].includes(client.action) &&
    project.client_match_key === client.match_key &&
    project.client_id === client.matched_client_id
  );
}

function reconcileProjectWithSnapshot(
  project: ProjectCandidate,
  client: ClientCandidate | undefined,
  snapshot: ExistingSnapshot,
): void {
  project.diagnostic_codes = project.diagnostic_codes.filter(
    (code) => !SNAPSHOT_PROJECT_DIAGNOSTICS.has(code),
  );
  const existing = snapshot.projects.filter(
    (candidate) =>
      candidate.project_code.toUpperCase() === project.project_code.toUpperCase() &&
      candidate.deleted_at === null,
  );
  if (existing.length > 1) {
    project.action = 'conflict';
    project.diagnostic_codes = [
      ...new Set([...project.diagnostic_codes, 'PROJECT_DUPLICATE_CONFLICT']),
    ].sort(compare);
    return;
  }
  if (existing.length === 0 || !projectIsComplete(project, client)) return;
  const target = existing[0];
  const lineage =
    target === undefined ? undefined : matchValidatedProjectLineage(project, target, snapshot);
  if (
    target !== undefined &&
    client?.action === 'no_op' &&
    project.client_id !== null &&
    target.project_name === project.project_name_proposal &&
    target.client_id === project.client_id &&
    target.classification === project.classification &&
    target.status === project.operational_status &&
    target.base_currency === project.currency &&
    target.contract_value === project.contract_value &&
    lineage?.equivalent === true
  ) {
    project.legacy_import_batch_reference = lineage.resolvedReference;
    project.matched_legacy_import_batch_id = target.legacy_import_batch_id;
    project.action = 'no_op';
    return;
  }
  project.action = 'conflict';
  project.diagnostic_codes = [
    ...new Set([...project.diagnostic_codes, 'PROTECTED_RECORD_CONFLICT']),
  ].sort(compare);
}

function refreshProjectEligibility(
  project: ProjectCandidate,
  client: ClientCandidate | undefined,
): void {
  if (project.action === 'no_op') {
    project.hash = hashCandidate(project);
    return;
  }
  if (project.diagnostic_codes.includes('PROJECT_CLIENT_UNRESOLVED')) {
    project.action = 'rejected';
  } else if (!hasHardProjectDiagnostic(project)) {
    project.action = projectIsComplete(project, client) ? 'insert' : 'pending_decision';
  }
  project.hash = hashCandidate(project);
}

export function applyReviewedResolutions(...args: unknown[]): AppliedReviewedResolutions {
  const [
    sourceProof,
    untrustedDocument,
    expectedBinding,
    snapshot,
    originalClients,
    originalProjects,
    originalMappings,
  ] = args.length === 7 ? args : [undefined, ...args];
  const binding = parseExpectedReviewBinding(expectedBinding);
  const validatedSnapshot = parseExistingSnapshot(snapshot);
  if (
    !Array.isArray(originalClients) ||
    !Array.isArray(originalProjects) ||
    !Array.isArray(originalMappings)
  ) {
    throw new Error('Contrato invÃ¡lido: candidate set/mappings exige arrays.');
  }
  const validatedCandidates = parseValidatedCandidateSetInternal(
    originalClients,
    originalProjects,
    validatedSnapshot,
    { p010ManifestHash: binding.p010_manifest_hash },
  );
  const actualSnapshotHash = createValidatedSnapshotHash(validatedSnapshot);
  if (binding.snapshot_hash !== actualSnapshotHash) {
    throw new Error('REVIEWED_RESOLUTION_BINDING_MISMATCH: snapshot_hash.');
  }
  const actualCandidateSetHash = createValidatedCandidateSetHash(
    validatedCandidates.clients,
    validatedCandidates.projects,
  );
  if (binding.candidate_set_hash !== actualCandidateSetHash) {
    throw new Error('REVIEWED_RESOLUTION_BINDING_MISMATCH: candidate_set_hash.');
  }
  const actualNormalizationManifestHash = createNormalizationManifestHash(
    binding.normalizer_version,
    binding.p010_manifest_hash,
    binding.input_hash,
    actualSnapshotHash,
    actualCandidateSetHash,
  );
  if (binding.normalization_manifest_hash !== actualNormalizationManifestHash) {
    throw new Error('REVIEWED_RESOLUTION_BINDING_MISMATCH: normalization_manifest_hash.');
  }
  const document = parseReviewedResolutionDocument(untrustedDocument);
  assertBinding(document, binding);
  const originalClientsById = new Map(
    validatedCandidates.clients.map((candidate) => [candidate.candidate_id, candidate]),
  );
  const originalProjectsById = new Map(
    validatedCandidates.projects.map((candidate) => [candidate.candidate_id, candidate]),
  );
  assertResolutionSet(document, originalClientsById, originalProjectsById, validatedSnapshot);
  assertSourceProvenCandidateProof(
    sourceProof,
    binding.p010_manifest_hash,
    binding.input_hash,
    validatedSnapshot,
    validatedCandidates.clients,
    validatedCandidates.projects,
  );

  const clients = structuredClone(validatedCandidates.clients);
  const projects = structuredClone(validatedCandidates.projects);
  const mappings = structuredClone(originalMappings as MappingEvidence[]);
  const clientsById = new Map(clients.map((candidate) => [candidate.candidate_id, candidate]));
  const projectsById = new Map(projects.map((candidate) => [candidate.candidate_id, candidate]));
  let appliedClientIdentities = 0;
  let appliedProjectNames = 0;
  let appliedProjectStatuses = 0;
  const resolvedClientIdentities = new Map<string, ResolvedClientIdentity>();

  for (const resolution of document.resolutions) {
    if (resolution.type !== 'client_identity') continue;
    const candidate = clientsById.get(resolution.candidate_id)!;
    candidate.status = 'valid';
    candidate.diagnostic_codes = [];
    candidate.possible_matches = [];
    if (resolution.identity.kind === 'use_existing') {
      candidate.action = 'no_op';
      candidate.matched_client_id = resolution.identity.client_id;
    } else {
      candidate.action = 'insert';
      candidate.matched_client_id = null;
    }
    resolvedClientIdentities.set(candidate.candidate_id, resolution.identity.kind);
    candidate.hash = hashCandidate(candidate);
    appliedClientIdentities += 1;
  }

  for (const resolution of document.resolutions) {
    if (resolution.type !== 'project') continue;
    const candidate = projectsById.get(resolution.candidate_id)!;
    if (resolution.approved_name !== undefined) {
      candidate.project_name_proposal = resolution.approved_name;
      candidate.project_name_mapping_status = 'mapped';
      for (const entry of mappings) {
        if (
          entry.entity === 'project' &&
          entry.entity_key === candidate.project_code &&
          entry.source_field === 'project_label'
        ) {
          entry.normalized_value = resolution.approved_name;
          entry.mapping_status = 'mapped';
          entry.mapping_reason = 'D71: nome explicitamente aprovado em decisão revisada vinculada.';
          entry.hash = sha256Canonical({ ...entry, hash: undefined });
        }
      }
      appliedProjectNames += 1;
    }
    if (resolution.approved_status !== undefined) {
      candidate.operational_status = resolution.approved_status;
      appliedProjectStatuses += 1;
    }
  }

  for (const project of projects) {
    const client = linkResolvedClient(project, clientsById);
    reconcileProjectWithSnapshot(project, client, validatedSnapshot);
    refreshProjectEligibility(project, client);
  }
  parseValidatedCandidateSetInternal(clients, projects, validatedSnapshot, {
    p010ManifestHash: binding.p010_manifest_hash,
    resolvedClientIdentities,
  });
  const diagnostics: ResolutionDiagnostic[] = [
    ...clients
      .filter((candidate) => candidate.status !== 'valid')
      .map((candidate) => ({
        code: 'REVIEWED_RESOLUTION_PARTIAL' as const,
        entity: 'client' as const,
        candidate_id: candidate.candidate_id,
      })),
    ...projects
      .filter((candidate) => !['insert', 'no_op'].includes(candidate.action))
      .map((candidate) => ({
        code: 'REVIEWED_RESOLUTION_PARTIAL' as const,
        entity: 'project' as const,
        candidate_id: candidate.candidate_id,
      })),
  ].sort(
    (left, right) =>
      compare(left.entity, right.entity) || compare(left.candidate_id, right.candidate_id),
  );
  return {
    clients,
    projects,
    mappings,
    summary: {
      contract: 'ltcm.p011.resolution-summary.v1',
      document_hash: sha256Canonical(document),
      binding_hash: sha256Canonical(binding),
      applied_client_identities: appliedClientIdentities,
      applied_project_names: appliedProjectNames,
      applied_project_statuses: appliedProjectStatuses,
      pending_clients: clients.filter((candidate) => candidate.status !== 'valid').length,
      pending_projects: projects.filter(
        (candidate) => !['insert', 'no_op'].includes(candidate.action),
      ).length,
      diagnostics,
    },
  };
}
