import { sha256Canonical } from './canonical-json.js';
import { assertUuid, parseReviewedResolutionDocument } from './contracts.js';
import type {
  ClientCandidate,
  ExistingSnapshot,
  MappingEvidence,
  ProjectCandidate,
  ReviewBinding,
  ReviewedResolution,
  ReviewedResolutionDocument,
  ResolutionDiagnostic,
  ResolutionSummary,
} from './types.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const HARD_PROJECT_DIAGNOSTICS = new Set([
  'PROJECT_CODE_INVALID',
  'PROJECT_DUPLICATE_CONFLICT',
  'PROJECT_CURRENCY_MISSING',
  'PROJECT_CURRENCY_AMBIGUOUS',
  'PROJECT_VALUE_CONFLICT',
  'PROJECT_CLASSIFICATION_CONFLICT',
  'PROTECTED_RECORD_CONFLICT',
]);
const SNAPSHOT_PROJECT_DIAGNOSTICS = new Set([
  'PROJECT_DUPLICATE_CONFLICT',
  'PROTECTED_RECORD_CONFLICT',
]);

interface AppliedReviewedResolutions {
  clients: ClientCandidate[];
  projects: ProjectCandidate[];
  mappings: MappingEvidence[];
  summary: ResolutionSummary;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hashCandidate(candidate: ClientCandidate | ProjectCandidate): string {
  return sha256Canonical({ ...candidate, hash: undefined });
}

function canonicalSort<T>(values: T[]): T[] {
  return [...values].sort((left, right) => compare(sha256Canonical(left), sha256Canonical(right)));
}

export function createSnapshotHash(snapshot: ExistingSnapshot): string {
  return sha256Canonical({
    contract: snapshot.contract,
    currencies: canonicalSort(snapshot.currencies),
    clients: canonicalSort(snapshot.clients),
    projects: canonicalSort(snapshot.projects),
  });
}

export function createReviewBinding(
  normalizerVersion: string,
  p010ManifestHash: string,
  inputHash: string,
  snapshot: ExistingSnapshot,
  clients: ClientCandidate[],
  projects: ProjectCandidate[],
): ReviewBinding {
  const snapshotHash = createSnapshotHash(snapshot);
  const candidateSetHash = sha256Canonical({
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
  const normalizationManifestHash = sha256Canonical({
    artifact_contract: 'ltcm.p011.normalization-manifest.v2',
    normalizer_version: normalizerVersion,
    p010_manifest_hash: p010ManifestHash,
    input_hash: inputHash,
    snapshot_hash: snapshotHash,
    candidate_set_hash: candidateSetHash,
  });
  return {
    contract: 'ltcm.p011.review-binding.v1',
    normalizer_version: normalizerVersion,
    normalization_manifest_hash: normalizationManifestHash,
    p010_manifest_hash: p010ManifestHash,
    input_hash: inputHash,
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

function clientMatchKey(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
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
      (name) => typeof name === 'string' && clientMatchKey(name) === candidate.match_key,
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
  if (client?.status === 'valid' && ['insert', 'no_op'].includes(client.action)) {
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
    project.project_name_mapping_status === 'mapped' &&
    client?.status === 'valid' &&
    ['insert', 'no_op'].includes(client.action) &&
    project.classification !== null &&
    project.operational_status !== null &&
    project.currency !== null &&
    project.contract_value !== null &&
    (project.data_reference_date !== null || project.legacy_import_batch_reference !== null)
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
  const candidateLegacyBatchId =
    project.legacy_import_batch_reference?.kind === 'existing'
      ? project.legacy_import_batch_reference.import_batch_id
      : null;
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
    target.data_reference_date === project.data_reference_date &&
    target.legacy_import_batch_id === candidateLegacyBatchId
  ) {
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

export function applyReviewedResolutions(
  untrustedDocument: ReviewedResolutionDocument,
  expectedBinding: ReviewBinding,
  snapshot: ExistingSnapshot,
  originalClients: ClientCandidate[],
  originalProjects: ProjectCandidate[],
  originalMappings: MappingEvidence[],
): AppliedReviewedResolutions {
  const document = parseReviewedResolutionDocument(untrustedDocument);
  assertBinding(document, expectedBinding);
  const originalClientsById = new Map(
    originalClients.map((candidate) => [candidate.candidate_id, candidate]),
  );
  const originalProjectsById = new Map(
    originalProjects.map((candidate) => [candidate.candidate_id, candidate]),
  );
  assertResolutionSet(document, originalClientsById, originalProjectsById, snapshot);

  const clients = structuredClone(originalClients);
  const projects = structuredClone(originalProjects);
  const mappings = structuredClone(originalMappings);
  const clientsById = new Map(clients.map((candidate) => [candidate.candidate_id, candidate]));
  const projectsById = new Map(projects.map((candidate) => [candidate.candidate_id, candidate]));
  let appliedClientIdentities = 0;
  let appliedProjectNames = 0;
  let appliedProjectStatuses = 0;

  for (const resolution of document.resolutions) {
    if (resolution.type !== 'client_identity') continue;
    const candidate = clientsById.get(resolution.candidate_id)!;
    candidate.status = 'valid';
    candidate.diagnostic_codes = [];
    if (resolution.identity.kind === 'use_existing') {
      candidate.action = 'no_op';
      candidate.matched_client_id = resolution.identity.client_id;
    } else {
      candidate.action = 'insert';
      candidate.matched_client_id = null;
    }
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
    reconcileProjectWithSnapshot(project, client, snapshot);
    refreshProjectEligibility(project, client);
  }
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
      binding_hash: sha256Canonical(expectedBinding),
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
