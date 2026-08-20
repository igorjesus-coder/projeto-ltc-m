import { sha256Canonical } from './canonical-json.js';
import {
  parseP012ExistingItemsSnapshot,
  parseQuantity,
  parseTotalAmount,
  parseUnitPrice,
} from './item-contracts.js';
import { createValidatedP012CandidateView, normalizeP012Items } from './item-normalizer.js';
import { createValidatedP011ProjectView } from './normalizer.js';
import type { LoadedSource } from './source-reader.js';
import type {
  ItemCandidate,
  P011Artifacts,
  P012ExistingItemsSnapshot,
  P012ItemCandidateSet,
} from './types.js';

export const P012_PERSISTENCE_PLAN_CONTRACT = 'ltcm.p012.persistence-plan.v1' as const;
export const P012_PERSISTENCE_RECEIPT_CONTRACT = 'ltcm.p012.persistence-receipt.v1' as const;
export const P012_MAX_TRANSACTION_ATTEMPTS = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BATCH_KEY = /^ltcm-p011:[0-9a-f]{64}$/u;

export type P012LogicalEnvironment = 'local' | 'test';
export type P012PersistenceErrorCode =
  | 'P012_PERSISTENCE_NOT_AUTHORIZED'
  | 'P012_PERSISTENCE_PLAN_MISMATCH'
  | 'P012_PERSISTENCE_SNAPSHOT_CHANGED'
  | 'P012_PERSISTENCE_IDENTITY_CONFLICT'
  | 'P012_PERSISTENCE_STAGING_MISMATCH'
  | 'P012_PERSISTENCE_SERIALIZATION_RETRY_EXHAUSTED'
  | 'P012_PERSISTENCE_TRANSACTION_FAILED'
  | 'P012_PERSISTENCE_RESULT_MISMATCH'
  | 'P012_PROJECT_TARGET_UNRESOLVED'
  | 'P012_UNIT_TARGET_UNRESOLVED';

export class P012PersistenceError extends Error {
  readonly code: P012PersistenceErrorCode;

  constructor(code: P012PersistenceErrorCode) {
    super(code);
    this.name = 'P012PersistenceError';
    this.code = code;
  }
}

export interface P012ActorContext {
  appUserId: string;
  authSubject: string;
  requestId: string;
  justification: string | null;
  source: 'import';
}

export interface P012ImportBatchBinding {
  id: string;
  idempotency_key: string;
  source_hash: string;
}

export interface P012SnapshotProjectScope {
  project_candidate_id: string;
  project_code: string;
  expected_id: string | null;
}

export interface P012SnapshotScope {
  projects: P012SnapshotProjectScope[];
}

export interface P012PersistenceOperation {
  order: number;
  action: 'insert' | 'no_op';
  candidate_id: string;
  candidate_hash: string;
  project_candidate_id: string;
  project_id: string;
  source_line_key: string;
  line_number: number;
  item_code: string | null;
  description: string | null;
  quantity: string;
  unit_code: 'UN' | 'SERV' | 'US';
  currency_code: string;
  unit_price: string;
  total_amount: string;
  expected_target_id: string | null;
  expected_row_version: number | null;
  staging: {
    sheet_key: 'monthly_revenue';
    source_row_number: number;
    row_hash: string;
  };
}

export interface P012PersistenceCounts {
  attempted: number;
  insert: number;
  no_op: number;
  conflict: number;
  rejected: number;
  pending: number;
}

export interface P012PersistencePlan {
  contract: typeof P012_PERSISTENCE_PLAN_CONTRACT;
  payload_schema_version: 1;
  logical_environment: P012LogicalEnvironment;
  batch: P012ImportBatchBinding;
  p010_manifest_hash: string;
  input_hash: string;
  workbook_hash: string;
  p011_artifacts_hash: string;
  p012_candidate_set_hash: string;
  snapshot_hash: string;
  project_targets: Array<{
    project_candidate_id: string;
    project_id: string;
  }>;
  operations: P012PersistenceOperation[];
  expected_counts: P012PersistenceCounts;
  plan_hash: string;
}

export interface P012PersistedTarget {
  candidate_id: string;
  outcome: 'inserted' | 'no_op';
  target_id: string;
}

export interface P012PersistenceReceipt {
  contract: typeof P012_PERSISTENCE_RECEIPT_CONTRACT;
  payload_schema_version: 1;
  plan_hash: string;
  snapshot_hash: string;
  batch_id: string;
  request_id: string;
  attempted: number;
  inserted: number;
  no_op: number;
  conflict: number;
  rejected: number;
  pending: number;
  committed: true;
  targets: P012PersistedTarget[];
}

export interface P012StagingRecord {
  candidate_id: string;
  staging_row_id: string;
  target_table: string | null;
  target_record_id: string | null;
}

export interface P012PersistenceTransaction {
  acquireProjectLocks(projectIds: string[]): Promise<void>;
  readExistingItemsSnapshot(scope: P012SnapshotScope): Promise<unknown>;
  validateBatchAndStaging(plan: P012PersistencePlan): Promise<P012StagingRecord[]>;
  insertItem(operation: P012PersistenceOperation): Promise<unknown>;
  linkStaging(stagingRowId: string, itemId: string): Promise<void>;
}

export interface P012PersistencePort {
  readExistingItemsSnapshot(scope: P012SnapshotScope, actor: P012ActorContext): Promise<unknown>;
  serializableTransaction<T>(
    environment: P012LogicalEnvironment,
    actor: P012ActorContext,
    work: (transaction: P012PersistenceTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface P012DryRunResult {
  snapshot: P012ExistingItemsSnapshot;
  candidateSet: P012ItemCandidateSet;
  plan: P012PersistencePlan;
}

function assertUuid(value: string): void {
  if (!UUID.test(value)) throw new P012PersistenceError('P012_PERSISTENCE_PLAN_MISMATCH');
}

function assertHash(value: string): void {
  if (!SHA256.test(value)) throw new P012PersistenceError('P012_PERSISTENCE_PLAN_MISMATCH');
}

function counts(candidateSet: P012ItemCandidateSet): P012PersistenceCounts {
  const action = candidateSet.summary.action_counts;
  return {
    attempted: candidateSet.summary.attempted_rows,
    insert: action.insert,
    no_op: action.no_op,
    conflict: action.conflict,
    rejected: action.rejected,
    pending: action.pending_decision,
  };
}

function requiredCandidateFacts(candidate: ItemCandidate): asserts candidate is ItemCandidate & {
  quantity: string;
  unit_code: 'UN' | 'SERV' | 'US';
  currency_code: string;
  unit_price: string;
  total_amount: string;
  project: ItemCandidate['project'] & { project_target_id: string };
} {
  if (candidate.project.project_target_id === null) {
    throw new P012PersistenceError('P012_PROJECT_TARGET_UNRESOLVED');
  }
  if (candidate.unit_code === null) {
    throw new P012PersistenceError('P012_UNIT_TARGET_UNRESOLVED');
  }
  if (
    candidate.quantity === null ||
    candidate.currency_code === null ||
    candidate.unit_price === null ||
    candidate.total_amount === null
  ) {
    throw new P012PersistenceError('P012_PERSISTENCE_PLAN_MISMATCH');
  }
  parseQuantity(candidate.quantity);
  parseUnitPrice(candidate.unit_price);
  parseTotalAmount(candidate.total_amount);
  assertUuid(candidate.project.project_target_id);
}

function operationFor(
  candidate: ItemCandidate,
  snapshot: P012ExistingItemsSnapshot,
): Omit<P012PersistenceOperation, 'order'> | null {
  if (candidate.action !== 'insert' && candidate.action !== 'no_op') return null;
  requiredCandidateFacts(candidate);
  const existing =
    candidate.target_id === null
      ? undefined
      : snapshot.items.find(({ id }) => id === candidate.target_id);
  if (
    (candidate.action === 'insert' && (candidate.target_id !== null || existing !== undefined)) ||
    (candidate.action === 'no_op' &&
      (candidate.target_id === null ||
        existing === undefined ||
        existing.project_id !== candidate.project.project_target_id))
  ) {
    throw new P012PersistenceError('P012_PERSISTENCE_PLAN_MISMATCH');
  }
  return {
    action: candidate.action,
    candidate_id: candidate.candidate_id,
    candidate_hash: candidate.candidate_hash,
    project_candidate_id: candidate.project.project_candidate_id,
    project_id: candidate.project.project_target_id,
    source_line_key: candidate.source_line_key,
    line_number: candidate.source_item_number,
    item_code: candidate.item_code,
    description: candidate.description,
    quantity: candidate.quantity,
    unit_code: candidate.unit_code,
    currency_code: candidate.currency_code,
    unit_price: candidate.unit_price,
    total_amount: candidate.total_amount,
    expected_target_id: existing?.id ?? null,
    expected_row_version: existing?.row_version ?? null,
    staging: {
      sheet_key: 'monthly_revenue',
      source_row_number: candidate.source_lineage.physical_row,
      row_hash: candidate.source_lineage.row_hash,
    },
  };
}

export function computeP012PersistencePlanHash(
  plan: Omit<P012PersistencePlan, 'plan_hash'> | P012PersistencePlan,
): string {
  const { plan_hash: _planHash, ...preimage } = plan as P012PersistencePlan;
  void _planHash;
  return sha256Canonical(preimage);
}

export function createP012SnapshotScope(
  source: LoadedSource,
  p011Artifacts: P011Artifacts,
): P012SnapshotScope {
  const projectView = createValidatedP011ProjectView(source, p011Artifacts);
  const projects = projectView.projects
    .filter(({ action }) => action !== 'insert')
    .map(({ candidate_id, project_code }) => ({
      project_candidate_id: candidate_id,
      project_code,
      expected_id: null,
    }))
    .sort((left, right) =>
      left.project_candidate_id.localeCompare(right.project_candidate_id, 'en'),
    );
  return { projects };
}

export function prepareP012PersistencePlan(
  source: LoadedSource,
  p011Artifacts: P011Artifacts,
  candidateSet: P012ItemCandidateSet,
  snapshotInput: unknown,
  options: {
    logicalEnvironment: P012LogicalEnvironment;
    batch: P012ImportBatchBinding;
  },
): P012PersistencePlan {
  const candidates = createValidatedP012CandidateView(source, p011Artifacts, candidateSet);
  const snapshot = parseP012ExistingItemsSnapshot(snapshotInput);
  if (sha256Canonical(snapshot) !== candidateSet.snapshot_hash) {
    throw new P012PersistenceError('P012_PERSISTENCE_SNAPSHOT_CHANGED');
  }
  assertUuid(options.batch.id);
  assertHash(options.batch.source_hash);
  if (
    !BATCH_KEY.test(options.batch.idempotency_key) ||
    options.batch.idempotency_key !== `ltcm-p011:${candidateSet.p010_manifest_hash}`
  ) {
    throw new P012PersistenceError('P012_PERSISTENCE_PLAN_MISMATCH');
  }
  const workbookHashes = new Set(
    candidates.map(({ source_lineage }) => source_lineage.workbook_hash),
  );
  if (workbookHashes.size !== 1 || !workbookHashes.has(options.batch.source_hash)) {
    throw new P012PersistenceError('P012_PERSISTENCE_PLAN_MISMATCH');
  }
  const operations = candidates
    .map((candidate) => operationFor(candidate, snapshot))
    .filter((operation): operation is Omit<P012PersistenceOperation, 'order'> => operation !== null)
    .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id, 'en'))
    .map((operation, index) => ({ ...operation, order: index + 1 }));
  const projectTargets = [
    ...new Map(
      operations.map((operation) => [
        operation.project_candidate_id,
        {
          project_candidate_id: operation.project_candidate_id,
          project_id: operation.project_id,
        },
      ]),
    ).values(),
  ].sort((left, right) =>
    left.project_candidate_id.localeCompare(right.project_candidate_id, 'en'),
  );
  const preimage: Omit<P012PersistencePlan, 'plan_hash'> = {
    contract: P012_PERSISTENCE_PLAN_CONTRACT,
    payload_schema_version: 1,
    logical_environment: options.logicalEnvironment,
    batch: structuredClone(options.batch),
    p010_manifest_hash: candidateSet.p010_manifest_hash,
    input_hash: candidateSet.input_hash,
    workbook_hash: options.batch.source_hash,
    p011_artifacts_hash: candidateSet.p011_artifacts_hash,
    p012_candidate_set_hash: candidateSet.candidate_set_hash,
    snapshot_hash: candidateSet.snapshot_hash,
    project_targets: projectTargets,
    operations,
    expected_counts: counts(candidateSet),
  };
  return { ...preimage, plan_hash: computeP012PersistencePlanHash(preimage) };
}

export function assertP012PersistencePlan(plan: P012PersistencePlan): void {
  assertHash(plan.plan_hash);
  const { plan_hash: planHash, ...preimage } = plan;
  if (
    plan.contract !== P012_PERSISTENCE_PLAN_CONTRACT ||
    plan.payload_schema_version !== 1 ||
    !['local', 'test'].includes(plan.logical_environment) ||
    planHash !== computeP012PersistencePlanHash(preimage) ||
    plan.operations.some((operation, index) => operation.order !== index + 1)
  ) {
    throw new P012PersistenceError('P012_PERSISTENCE_PLAN_MISMATCH');
  }
  if (plan.expected_counts.conflict > 0) {
    throw new P012PersistenceError('P012_PERSISTENCE_IDENTITY_CONFLICT');
  }
}

export async function createP012PersistenceDryRun(
  port: P012PersistencePort,
  source: LoadedSource,
  p011Artifacts: P011Artifacts,
  actor: P012ActorContext,
  options: {
    logicalEnvironment: P012LogicalEnvironment;
    batch: P012ImportBatchBinding;
  },
): Promise<P012DryRunResult> {
  const snapshot = parseP012ExistingItemsSnapshot(
    await port.readExistingItemsSnapshot(createP012SnapshotScope(source, p011Artifacts), actor),
  );
  const candidateSet = normalizeP012Items(source, p011Artifacts, snapshot);
  return {
    snapshot,
    candidateSet,
    plan: prepareP012PersistencePlan(source, p011Artifacts, candidateSet, snapshot, options),
  };
}

function freshScope(
  source: LoadedSource,
  p011Artifacts: P011Artifacts,
  plan: P012PersistencePlan,
): P012SnapshotScope {
  const base = createP012SnapshotScope(source, p011Artifacts);
  const expectedByCandidate = new Map(
    plan.project_targets.map(({ project_candidate_id, project_id }) => [
      project_candidate_id,
      project_id,
    ]),
  );
  return {
    projects: base.projects.map((project) => ({
      ...project,
      expected_id: expectedByCandidate.get(project.project_candidate_id) ?? null,
    })),
  };
}

function equivalentInserted(
  operation: P012PersistenceOperation,
  item: P012ExistingItemsSnapshot['items'][number],
): boolean {
  return (
    item.project_id === operation.project_id &&
    item.source_line_key === operation.source_line_key &&
    item.line_number === operation.line_number &&
    item.item_code === operation.item_code &&
    item.description === operation.description &&
    item.quantity === operation.quantity &&
    item.unit_code === operation.unit_code &&
    item.currency_code === operation.currency_code &&
    item.unit_price === operation.unit_price &&
    item.total_amount === operation.total_amount &&
    item.active &&
    item.deleted_at === null
  );
}

function postgresCode(error: unknown): string | null {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export async function applyP012PersistencePlan(
  port: P012PersistencePort,
  source: LoadedSource,
  p011Artifacts: P011Artifacts,
  reviewedPlan: P012PersistencePlan,
  actor: P012ActorContext,
): Promise<P012PersistenceReceipt> {
  assertP012PersistencePlan(reviewedPlan);
  const projectIds = reviewedPlan.project_targets
    .map(({ project_id }) => project_id)
    .sort((left, right) => left.localeCompare(right, 'en'));
  for (let attempt = 1; attempt <= P012_MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await port.serializableTransaction(
        reviewedPlan.logical_environment,
        actor,
        async (transaction) => {
          await transaction.acquireProjectLocks(projectIds);
          const rawSnapshot = await transaction.readExistingItemsSnapshot(
            freshScope(source, p011Artifacts, reviewedPlan),
          );
          const freshSnapshot = parseP012ExistingItemsSnapshot(rawSnapshot);
          const freshCandidateSet = normalizeP012Items(source, p011Artifacts, freshSnapshot);
          const freshPlan = prepareP012PersistencePlan(
            source,
            p011Artifacts,
            freshCandidateSet,
            freshSnapshot,
            {
              logicalEnvironment: reviewedPlan.logical_environment,
              batch: reviewedPlan.batch,
            },
          );
          if (freshPlan.plan_hash !== reviewedPlan.plan_hash) {
            throw new P012PersistenceError('P012_PERSISTENCE_SNAPSHOT_CHANGED');
          }
          const staging = await transaction.validateBatchAndStaging(freshPlan);
          const stagingByCandidate = new Map(staging.map((row) => [row.candidate_id, row]));
          const parsedItems = [...freshSnapshot.items];
          const targets: P012PersistedTarget[] = [];
          for (const operation of freshPlan.operations) {
            const stagingRow = stagingByCandidate.get(operation.candidate_id);
            if (stagingRow === undefined) {
              throw new P012PersistenceError('P012_PERSISTENCE_STAGING_MISMATCH');
            }
            let item: P012ExistingItemsSnapshot['items'][number];
            let outcome: P012PersistedTarget['outcome'];
            if (operation.action === 'no_op') {
              item = parsedItems.find(({ id }) => id === operation.expected_target_id)!;
              if (
                item === undefined ||
                item.row_version !== operation.expected_row_version ||
                !equivalentInserted(operation, item)
              ) {
                throw new P012PersistenceError('P012_PERSISTENCE_IDENTITY_CONFLICT');
              }
              outcome = 'no_op';
            } else {
              const inserted = await transaction.insertItem(operation);
              const parsed = parseP012ExistingItemsSnapshot({
                ...freshSnapshot,
                items: [...parsedItems, inserted],
              });
              item = parsed.items.find(
                ({ project_id, source_line_key }) =>
                  project_id === operation.project_id &&
                  source_line_key === operation.source_line_key,
              )!;
              if (item === undefined || !equivalentInserted(operation, item)) {
                throw new P012PersistenceError('P012_PERSISTENCE_RESULT_MISMATCH');
              }
              parsedItems.push(item);
              outcome = 'inserted';
            }
            if (
              stagingRow.target_table !== null &&
              (stagingRow.target_table !== 'project_items' ||
                stagingRow.target_record_id !== item.id)
            ) {
              throw new P012PersistenceError('P012_PERSISTENCE_STAGING_MISMATCH');
            }
            await transaction.linkStaging(stagingRow.staging_row_id, item.id);
            targets.push({ candidate_id: operation.candidate_id, outcome, target_id: item.id });
          }
          return {
            contract: P012_PERSISTENCE_RECEIPT_CONTRACT,
            payload_schema_version: 1,
            plan_hash: freshPlan.plan_hash,
            snapshot_hash: freshPlan.snapshot_hash,
            batch_id: freshPlan.batch.id,
            request_id: actor.requestId,
            attempted: freshPlan.expected_counts.attempted,
            inserted: targets.filter(({ outcome }) => outcome === 'inserted').length,
            no_op: targets.filter(({ outcome }) => outcome === 'no_op').length,
            conflict: freshPlan.expected_counts.conflict,
            rejected: freshPlan.expected_counts.rejected,
            pending: freshPlan.expected_counts.pending,
            committed: true,
            targets,
          } satisfies P012PersistenceReceipt;
        },
      );
    } catch (error) {
      if (error instanceof P012PersistenceError) throw error;
      const code = postgresCode(error);
      if (code === '23505') {
        throw new P012PersistenceError('P012_PERSISTENCE_IDENTITY_CONFLICT');
      }
      if (code === '40001' || code === '40P01') {
        if (attempt < P012_MAX_TRANSACTION_ATTEMPTS) continue;
        throw new P012PersistenceError('P012_PERSISTENCE_SERIALIZATION_RETRY_EXHAUSTED');
      }
      throw new P012PersistenceError('P012_PERSISTENCE_TRANSACTION_FAILED');
    }
  }
  throw new P012PersistenceError('P012_PERSISTENCE_SERIALIZATION_RETRY_EXHAUSTED');
}
