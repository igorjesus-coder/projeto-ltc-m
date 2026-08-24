import {
  readP013CertifiedMonthlySourceFacts,
  type P013CertifiedMonthlySource,
  type P013MonthlySourceCellFacts,
} from '@ltcm/extractor/p013';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { sha256Canonical } from './canonical-json.js';
import { createSourceLineKey, parseSourceItemNumber } from './item-contracts.js';
import {
  createP013MonthlyBaselineIdempotencyKey,
  createP013MonthlyBaselineSemanticIdentity,
  type P013MonthlyDeclarationState,
} from './monthly-baseline.js';

export const P013_MONTHLY_SNAPSHOT_CONTRACT = 'ltcm.p013.monthly-baseline-snapshot.v1' as const;
export const P013_MONTHLY_PLAN_CONTRACT = 'ltcm.p013.monthly-baseline-plan.v1' as const;
export const P013_MONTHLY_DRY_RUN_RECEIPT_CONTRACT =
  'ltcm.p013.monthly-baseline-dry-run-receipt.v1' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PROJECT_CODE = /^\d{4}-\d{2}-\d{5}$/u;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])-01$/u;
const SOURCE_KEY = /^p012-item-v1:[0-9a-f]{64}$/u;

class P013BoundaryError extends Error {}

function sanitized(code: string): never {
  throw new P013BoundaryError(code);
}

export type P013MonthlyPlanStatus =
  'ready' | 'no_op_candidate' | 'conflict' | 'rejected' | 'pending_decision';

export interface P013SnapshotProject {
  id: string;
  project_code: string;
  status: string;
  deleted_at: string | null;
}

export interface P013SnapshotProjectItem {
  id: string;
  project_id: string;
  source_line_key: string;
  line_number: number;
  active: boolean;
  deleted_at: string | null;
}

export interface P013SnapshotPlanScope {
  project_id: string;
  metric_type: 'billing_planned';
  planning_level: 'item';
  currency_code: string;
}

interface P013SnapshotBaseline {
  id: string;
  plan_version_id: string;
  metric_type: 'billing_planned';
  planning_level: 'item';
  semantic_fingerprint: string;
}

interface P013SnapshotCell {
  baseline_id: string;
  project_id: string;
  project_item_id: string;
  competence_month: string;
  source_line_key: string;
  source_item_number: string;
  source_row_number: number;
  source_column: 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S';
  source_cell_reference: string;
  declaration_state: P013MonthlyDeclarationState;
  source_numeric_text: string | null;
  source_value_hash: string | null;
  canonical_amount: string | null;
  financial_plan_line_id: string | null;
}

interface P013SnapshotPlanLine {
  id: string;
  project_id: string;
  project_item_id: string;
  competence_month: string;
  amount: string;
  currency_code: string;
}

export interface P013MonthlySnapshot {
  contract: typeof P013_MONTHLY_SNAPSHOT_CONTRACT;
  target_plan_version: {
    id: string;
    status: string;
    is_baseline: boolean;
  } | null;
  projects: P013SnapshotProject[];
  project_items: P013SnapshotProjectItem[];
  plan_scopes: P013SnapshotPlanScope[];
  existing_baselines: P013SnapshotBaseline[];
  existing_cells: P013SnapshotCell[];
  existing_plan_lines: P013SnapshotPlanLine[];
  existing_artifacts: Array<{
    source_sha256: string;
    source_semantic_fingerprint: string;
  }>;
  existing_executions: Array<{
    source_sha256: string;
    baseline_id: string;
    baseline_semantic_fingerprint: string;
    plan_version_id: string;
  }>;
  read_scope: {
    project_codes: string[];
    target_plan_version_id: string;
  };
  snapshot_fingerprint: string;
}

export interface P013CanonicalPlanCell extends P013MonthlySourceCellFacts {
  project_id: string;
  project_item_id: string;
  source_line_key: string;
}

export interface P013MaterialPlanLine {
  line_key: string;
  plan_version_id: string;
  project_id: string;
  project_item_id: string;
  metric_type: 'billing_planned';
  planning_level: 'item';
  competence_month: string;
  amount: string;
  currency_code: string;
  source_cell_reference: string;
}

export interface P013MonthlyBaselinePlan {
  contract: typeof P013_MONTHLY_PLAN_CONTRACT;
  status: 'ready' | 'no_op_candidate' | 'conflict';
  source_artifact: {
    source_name: string;
    source_sha256: string;
    source_size_bytes: number;
    source_semantic_fingerprint: string;
  };
  snapshot_fingerprint: string;
  target_plan_version_id: string;
  metric_type: 'billing_planned';
  planning_level: 'item';
  baseline_semantic_fingerprint: string;
  idempotency_key: string;
  cells: P013CanonicalPlanCell[];
  material_lines: P013MaterialPlanLine[];
  item_reconciliation: Array<{
    project_item_id: string;
    position_count: number;
    blank_count: number;
    explicit_zero_count: number;
    non_zero_count: number;
    canonical_total: string;
    source_raw_rounded_total: string;
    rounding_residual: string;
    diagnostic_total_j: string | null;
    diagnostic_residual: string | null;
  }>;
  global_reconciliation: {
    position_count: number;
    blank_count: number;
    explicit_zero_count: number;
    non_zero_count: number;
    material_line_count: number;
    canonical_total: string;
    aggregate_raw_rounded_total: string;
    rounding_residual: string;
  };
  diagnostics: string[];
  plan_hash: string;
}

export interface P013MonthlyDryRunReceipt {
  contract: typeof P013_MONTHLY_DRY_RUN_RECEIPT_CONTRACT;
  status: P013MonthlyPlanStatus;
  source_sha256: string;
  source_semantic_fingerprint: string;
  snapshot_fingerprint: string;
  target_plan_version_id: string;
  baseline_semantic_fingerprint: string | null;
  plan_hash: string | null;
  position_count: number;
  blank_count: number;
  explicit_zero_count: number;
  non_zero_count: number;
  material_line_count: number;
  canonical_total: string;
  aggregate_raw_rounded_total: string;
  rounding_residual: string;
  select_statement_count: number;
  write_statement_count: number;
  transaction_read_only: true;
  statement_evidence: {
    transaction_control: number;
    set_role: number;
    runtime_attestation: number;
    actor_context: number;
    authorization_attestation: number;
    read_only_attestation: number;
    business_select: number;
    insert: number;
    update: number;
    delete: number;
    ddl: number;
  };
  diagnostics: string[];
}

export interface P013ActorContext {
  app_user_id: string;
  auth_subject: string;
  request_id: string;
  justification: string | null;
  source: 'import';
}

export interface P013LocalPostgresDryRunAdapter {
  readonly contract: 'ltcm.p013.local-postgres-dry-run-adapter.v1';
  close(): Promise<void>;
}

export interface P013MonthlyDryRunResult {
  plan: P013MonthlyBaselinePlan | null;
  receipt: P013MonthlyDryRunReceipt;
  snapshot: P013MonthlySnapshot;
}

export interface P013MonthlyBaselinePreview {
  plan: P013MonthlyBaselinePlan | null;
  status: P013MonthlyPlanStatus;
  diagnostics: string[];
  snapshot: P013MonthlySnapshot;
}

const certifiedSnapshots = new WeakMap<object, string>();
const snapshotBindings = new WeakMap<
  object,
  { source: P013CertifiedMonthlySource; adapter: P013LocalPostgresDryRunAdapter }
>();
const snapshotStatementEvidence = new WeakMap<
  object,
  P013MonthlyDryRunReceipt['statement_evidence']
>();
const certifiedPlans = new WeakMap<
  object,
  {
    plan: P013MonthlyBaselinePlan;
    source: P013CertifiedMonthlySource;
    snapshot: P013MonthlySnapshot;
  }
>();
const adapterStates = new WeakMap<object, { pool: Pool; database_name: string; closed: boolean }>();

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`P013_SNAPSHOT_INVALID:${label}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  if (
    keys.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    throw new Error(`P013_SNAPSHOT_INVALID:${label}`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`P013_SNAPSHOT_INVALID:${label}`);
  return value;
}

function uuid(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!UUID.test(parsed)) throw new Error(`P013_SNAPSHOT_INVALID:${label}`);
  return parsed;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  const parsed = string(value, label);
  const date = new Date(parsed);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== parsed) {
    throw new Error(`P013_SNAPSHOT_INVALID:${label}`);
  }
  return parsed;
}

function money(value: unknown, label: string): string {
  const parsed = string(value, label);
  const matched = /^(0|[1-9]\d*)\.(\d{2})$/u.exec(parsed);
  if (matched === null || (matched[1]?.length ?? 0) > 18) {
    throw new Error(`P013_SNAPSHOT_INVALID:${label}`);
  }
  return parsed;
}

function nullableUuid(value: unknown, label: string): string | null {
  return value === null ? null : uuid(value, label);
}

function nullableSha256(value: unknown, label: string): string | null {
  if (value === null) return null;
  const parsed = string(value, label);
  if (!SHA256.test(parsed)) throw new Error(`P013_SNAPSHOT_INVALID:${label}`);
  return parsed;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`P013_SNAPSHOT_INVALID:${label}`);
  }
  return Number(value);
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`P013_SNAPSHOT_INVALID:${label}`);
  return value;
}

function compare(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`P013_SNAPSHOT_INVALID:${label}`);
}

function parseP013MonthlySnapshotInternal(
  value: unknown,
  verifyFingerprint: boolean,
): P013MonthlySnapshot {
  const source = record(value, 'root');
  exactKeys(
    source,
    [
      'contract',
      'target_plan_version',
      'projects',
      'project_items',
      'plan_scopes',
      'existing_baselines',
      'existing_cells',
      'existing_plan_lines',
      'existing_artifacts',
      'existing_executions',
      'read_scope',
      'snapshot_fingerprint',
    ],
    'root',
  );
  if (source['contract'] !== P013_MONTHLY_SNAPSHOT_CONTRACT)
    sanitized('P013_SNAPSHOT_INVALID:contract');
  const targetRaw = source['target_plan_version'];
  const target =
    targetRaw === null
      ? null
      : (() => {
          const item = record(targetRaw, 'target_plan_version');
          exactKeys(item, ['id', 'status', 'is_baseline'], 'target_plan_version');
          if (typeof item['is_baseline'] !== 'boolean')
            sanitized('P013_SNAPSHOT_INVALID:target_plan_version');
          return {
            id: uuid(item['id'], 'target.id'),
            status: string(item['status'], 'target.status'),
            is_baseline: item['is_baseline'],
          };
        })();
  const projects = array(source['projects'], 'projects').map((raw, index) => {
    const item = record(raw, `projects[${index}]`);
    exactKeys(item, ['id', 'project_code', 'status', 'deleted_at'], `projects[${index}]`);
    const projectCode = string(item['project_code'], `projects[${index}].project_code`);
    if (!PROJECT_CODE.test(projectCode)) sanitized('P013_SNAPSHOT_INVALID:project-code');
    return {
      id: uuid(item['id'], 'project.id'),
      project_code: projectCode,
      status: string(item['status'], 'project.status'),
      deleted_at: nullableTimestamp(item['deleted_at'], 'project.deleted_at'),
    };
  });
  const items = array(source['project_items'], 'project_items').map((raw, index) => {
    const item = record(raw, `project_items[${index}]`);
    exactKeys(
      item,
      ['id', 'project_id', 'source_line_key', 'line_number', 'active', 'deleted_at'],
      `project_items[${index}]`,
    );
    const lineNumber = item['line_number'];
    const sourceLineKey = string(item['source_line_key'], 'item.source_line_key');
    if (
      !Number.isSafeInteger(lineNumber) ||
      Number(lineNumber) <= 0 ||
      typeof item['active'] !== 'boolean' ||
      !SOURCE_KEY.test(sourceLineKey)
    )
      sanitized('P013_SNAPSHOT_INVALID:item');
    return {
      id: uuid(item['id'], 'item.id'),
      project_id: uuid(item['project_id'], 'item.project_id'),
      source_line_key: sourceLineKey,
      line_number: Number(lineNumber),
      active: item['active'],
      deleted_at: nullableTimestamp(item['deleted_at'], 'item.deleted_at'),
    };
  });
  const scopes = array(source['plan_scopes'], 'plan_scopes').map((raw) => {
    const item = record(raw, 'scope');
    exactKeys(item, ['project_id', 'metric_type', 'planning_level', 'currency_code'], 'scope');
    if (
      item['metric_type'] !== 'billing_planned' ||
      item['planning_level'] !== 'item' ||
      typeof item['currency_code'] !== 'string' ||
      !/^[A-Z]{3}$/u.test(item['currency_code'])
    )
      sanitized('P013_SNAPSHOT_INVALID:scope');
    return {
      project_id: uuid(item['project_id'], 'scope.project_id'),
      metric_type: 'billing_planned' as const,
      planning_level: 'item' as const,
      currency_code: item['currency_code'],
    };
  });
  const baselines = array(source['existing_baselines'], 'existing_baselines').map((raw) => {
    const item = record(raw, 'baseline');
    exactKeys(
      item,
      ['id', 'plan_version_id', 'metric_type', 'planning_level', 'semantic_fingerprint'],
      'baseline',
    );
    const fingerprint = string(item['semantic_fingerprint'], 'baseline.semantic_fingerprint');
    if (
      !SHA256.test(fingerprint) ||
      item['metric_type'] !== 'billing_planned' ||
      item['planning_level'] !== 'item'
    ) {
      sanitized('P013_SNAPSHOT_INVALID:baseline');
    }
    return {
      id: uuid(item['id'], 'baseline.id'),
      plan_version_id: uuid(item['plan_version_id'], 'baseline.plan_version_id'),
      metric_type: 'billing_planned' as const,
      planning_level: 'item' as const,
      semantic_fingerprint: fingerprint,
    };
  });
  const cells = array(source['existing_cells'], 'existing_cells').map((raw) => {
    const item = record(raw, 'existing_cell');
    exactKeys(
      item,
      [
        'baseline_id',
        'project_id',
        'project_item_id',
        'competence_month',
        'source_line_key',
        'source_item_number',
        'source_row_number',
        'source_column',
        'source_cell_reference',
        'declaration_state',
        'source_numeric_text',
        'source_value_hash',
        'canonical_amount',
        'financial_plan_line_id',
      ],
      'existing_cell',
    );
    const state = item['declaration_state'];
    const month = string(item['competence_month'], 'cell.month');
    const sourceLineKey = string(item['source_line_key'], 'cell.source_line_key');
    const sourceItemNumber = string(item['source_item_number'], 'cell.source_item_number');
    const sourceColumn = string(item['source_column'], 'cell.source_column');
    const sourceRowNumber = positiveInteger(item['source_row_number'], 'cell.source_row_number');
    const sourceCellReference = string(item['source_cell_reference'], 'cell.source_cell_reference');
    if (
      !MONTH.test(month) ||
      !['blank', 'explicit_zero', 'value'].includes(String(state)) ||
      !SOURCE_KEY.test(sourceLineKey) ||
      !/^[1-9]\d*$/u.test(sourceItemNumber) ||
      !['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'].includes(sourceColumn) ||
      sourceRowNumber < 4 ||
      sourceRowNumber > 51 ||
      sourceCellReference !== `${sourceColumn}${sourceRowNumber}`
    ) {
      sanitized('P013_SNAPSHOT_INVALID:cell');
    }
    const amount =
      item['canonical_amount'] === null ? null : money(item['canonical_amount'], 'cell.amount');
    const sourceNumericText =
      item['source_numeric_text'] === null
        ? null
        : string(item['source_numeric_text'], 'cell.source_numeric_text');
    const sourceValueHash = nullableSha256(item['source_value_hash'], 'cell.source_value_hash');
    const financialPlanLineId = nullableUuid(
      item['financial_plan_line_id'],
      'cell.financial_plan_line_id',
    );
    const blank = state === 'blank';
    const zero = state === 'explicit_zero';
    if (
      blank !== (amount === null) ||
      blank !== (sourceNumericText === null) ||
      blank !== (sourceValueHash === null) ||
      blank !== (financialPlanLineId === null) ||
      (zero && amount !== '0.00') ||
      (state === 'value' && (amount === null || amount === '0.00'))
    ) {
      sanitized('P013_SNAPSHOT_INVALID:cell-state');
    }
    return {
      baseline_id: uuid(item['baseline_id'], 'cell.baseline_id'),
      project_id: uuid(item['project_id'], 'cell.project_id'),
      project_item_id: uuid(item['project_item_id'], 'cell.item_id'),
      competence_month: month,
      source_line_key: sourceLineKey,
      source_item_number: sourceItemNumber,
      source_row_number: sourceRowNumber,
      source_column: sourceColumn as P013SnapshotCell['source_column'],
      source_cell_reference: sourceCellReference,
      declaration_state: state as P013MonthlyDeclarationState,
      source_numeric_text: sourceNumericText,
      source_value_hash: sourceValueHash,
      canonical_amount: amount,
      financial_plan_line_id: financialPlanLineId,
    };
  });
  const lines = array(source['existing_plan_lines'], 'existing_plan_lines').map((raw) => {
    const item = record(raw, 'existing_line');
    exactKeys(
      item,
      ['id', 'project_id', 'project_item_id', 'competence_month', 'amount', 'currency_code'],
      'existing_line',
    );
    const month = string(item['competence_month'], 'line.month');
    const currencyCode = string(item['currency_code'], 'line.currency_code');
    if (!MONTH.test(month) || !/^[A-Z]{3}$/u.test(currencyCode)) {
      sanitized('P013_SNAPSHOT_INVALID:line');
    }
    return {
      id: uuid(item['id'], 'line.id'),
      project_id: uuid(item['project_id'], 'line.project_id'),
      project_item_id: uuid(item['project_item_id'], 'line.item_id'),
      competence_month: month,
      amount: money(item['amount'], 'line.amount'),
      currency_code: currencyCode,
    };
  });
  const artifacts = array(source['existing_artifacts'], 'existing_artifacts').map((raw) => {
    const item = record(raw, 'artifact');
    exactKeys(item, ['source_sha256', 'source_semantic_fingerprint'], 'artifact');
    const sourceSha = string(item['source_sha256'], 'artifact.sha');
    const semantic = string(item['source_semantic_fingerprint'], 'artifact.semantic');
    if (!SHA256.test(sourceSha) || !SHA256.test(semantic))
      sanitized('P013_SNAPSHOT_INVALID:artifact');
    return { source_sha256: sourceSha, source_semantic_fingerprint: semantic };
  });
  const executions = array(source['existing_executions'], 'existing_executions').map((raw) => {
    const item = record(raw, 'execution');
    exactKeys(
      item,
      ['source_sha256', 'baseline_id', 'baseline_semantic_fingerprint', 'plan_version_id'],
      'execution',
    );
    const sourceSha = string(item['source_sha256'], 'execution.sha');
    const semantic = string(item['baseline_semantic_fingerprint'], 'execution.semantic');
    if (!SHA256.test(sourceSha) || !SHA256.test(semantic))
      sanitized('P013_SNAPSHOT_INVALID:execution');
    return {
      source_sha256: sourceSha,
      baseline_id: uuid(item['baseline_id'], 'execution.baseline_id'),
      baseline_semantic_fingerprint: semantic,
      plan_version_id: uuid(item['plan_version_id'], 'execution.plan_version_id'),
    };
  });
  const scopeRaw = record(source['read_scope'], 'read_scope');
  exactKeys(scopeRaw, ['project_codes', 'target_plan_version_id'], 'read_scope');
  const projectCodes = array(scopeRaw['project_codes'], 'read_scope.project_codes').map((entry) =>
    string(entry, 'read_scope.project_code'),
  );
  if (projectCodes.some((code) => !PROJECT_CODE.test(code)))
    sanitized('P013_SNAPSHOT_INVALID:read-scope');
  const readScope = {
    project_codes: [...projectCodes].sort(compare),
    target_plan_version_id: uuid(scopeRaw['target_plan_version_id'], 'read_scope.plan'),
  };
  const fingerprint = string(source['snapshot_fingerprint'], 'snapshot_fingerprint');
  if (!SHA256.test(fingerprint)) sanitized('P013_SNAPSHOT_INVALID:fingerprint');
  projects.sort((a, b) => compare(`${a.project_code}\0${a.id}`, `${b.project_code}\0${b.id}`));
  items.sort((a, b) =>
    compare(
      `${a.project_id}\0${a.source_line_key}\0${a.id}`,
      `${b.project_id}\0${b.source_line_key}\0${b.id}`,
    ),
  );
  scopes.sort((a, b) => compare(a.project_id, b.project_id));
  baselines.sort((a, b) => compare(a.id, b.id));
  cells.sort((a, b) =>
    compare(
      `${a.baseline_id}\0${a.project_item_id}\0${a.competence_month}`,
      `${b.baseline_id}\0${b.project_item_id}\0${b.competence_month}`,
    ),
  );
  lines.sort((a, b) =>
    compare(
      `${a.project_item_id}\0${a.competence_month}\0${a.id}`,
      `${b.project_item_id}\0${b.competence_month}\0${b.id}`,
    ),
  );
  artifacts.sort((a, b) => compare(a.source_sha256, b.source_sha256));
  executions.sort((a, b) =>
    compare(
      `${a.baseline_id}\0${a.source_sha256}\0${a.baseline_semantic_fingerprint}`,
      `${b.baseline_id}\0${b.source_sha256}\0${b.baseline_semantic_fingerprint}`,
    ),
  );
  unique(
    projects.map(({ id }) => id),
    'project-id',
  );
  unique(
    items.map(({ id }) => id),
    'item-id',
  );
  unique(
    scopes.map(({ project_id }) => project_id),
    'scope-project',
  );
  unique(
    baselines.map(({ id }) => id),
    'baseline-id',
  );
  unique(
    cells.map((cell) => `${cell.baseline_id}\0${cell.project_item_id}\0${cell.competence_month}`),
    'cell-grain',
  );
  unique(
    cells.map(({ source_cell_reference }) => source_cell_reference),
    'cell-source-reference',
  );
  unique(
    lines.map(({ id }) => id),
    'line-id',
  );
  unique(
    lines.map((line) => `${line.project_item_id}\0${line.competence_month}`),
    'line-grain',
  );
  const projectIds = new Set(projects.map(({ id }) => id));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const baselineIds = new Set(baselines.map(({ id }) => id));
  if (
    items.some((item) => !projectIds.has(item.project_id)) ||
    scopes.some((scope) => !projectIds.has(scope.project_id)) ||
    baselines.some(
      (baseline) =>
        baseline.plan_version_id !== readScope.target_plan_version_id ||
        baseline.metric_type !== 'billing_planned' ||
        baseline.planning_level !== 'item',
    ) ||
    cells.some((cell) => {
      const item = itemById.get(cell.project_item_id);
      return (
        !baselineIds.has(cell.baseline_id) ||
        item === undefined ||
        item.project_id !== cell.project_id ||
        item.source_line_key !== cell.source_line_key ||
        item.line_number !== Number(cell.source_item_number)
      );
    }) ||
    lines.some((line) => itemById.get(line.project_item_id)?.project_id !== line.project_id) ||
    executions.some(
      (execution) =>
        !baselineIds.has(execution.baseline_id) ||
        execution.plan_version_id !== readScope.target_plan_version_id,
    ) ||
    (target !== null && target.id !== readScope.target_plan_version_id)
  ) {
    sanitized('P013_SNAPSHOT_INVALID:crossed-identity');
  }
  const payload = {
    contract: P013_MONTHLY_SNAPSHOT_CONTRACT,
    target_plan_version: target,
    projects,
    project_items: items,
    plan_scopes: scopes,
    existing_baselines: baselines,
    existing_cells: cells,
    existing_plan_lines: lines,
    existing_artifacts: artifacts,
    existing_executions: executions,
    read_scope: readScope,
  };
  const canonicalFingerprint = sha256Canonical(payload);
  if (verifyFingerprint && canonicalFingerprint !== fingerprint)
    sanitized('P013_SNAPSHOT_STALE_OR_FORGED');
  return deepFreeze({ ...payload, snapshot_fingerprint: canonicalFingerprint });
}

export function parseP013MonthlySnapshot(value: unknown): P013MonthlySnapshot {
  return parseP013MonthlySnapshotInternal(value, true);
}

const SNAPSHOT_SQL = `
select jsonb_build_object(
  'contract', 'ltcm.p013.monthly-baseline-snapshot.v1',
  'target_plan_version', (
    select jsonb_build_object('id', id::text, 'status', status::text, 'is_baseline', is_baseline)
      from ltc_m.plan_versions where id = $1::uuid
  ),
  'projects', coalesce((
    select jsonb_agg(jsonb_build_object('id', id::text, 'project_code', project_code,
      'status', status::text, 'deleted_at', case when deleted_at is null then null else to_char(deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end)
      order by project_code collate "C", id)
      from ltc_m.projects where project_code = any($2::text[])
  ), '[]'::jsonb),
  'project_items', coalesce((
    select jsonb_agg(jsonb_build_object('id', items.id::text, 'project_id', items.project_id::text,
      'source_line_key', items.source_line_key, 'line_number', items.line_number,
      'active', items.active, 'deleted_at', case when items.deleted_at is null then null else to_char(items.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end)
      order by items.project_id, items.source_line_key collate "C", items.id)
      from ltc_m.project_items as items join ltc_m.projects as projects on projects.id = items.project_id
     where projects.project_code = any($2::text[])
  ), '[]'::jsonb),
  'plan_scopes', coalesce((
    select jsonb_agg(jsonb_build_object('project_id', project_id::text, 'metric_type', metric_type::text,
      'planning_level', planning_level::text, 'currency_code', currency_code) order by project_id)
      from ltc_m.financial_plan_scopes
     where plan_version_id = $1::uuid and metric_type = 'billing_planned'
       and project_id in (select id from ltc_m.projects where project_code = any($2::text[]))
  ), '[]'::jsonb),
  'existing_baselines', coalesce((
    select jsonb_agg(jsonb_build_object('id', id::text, 'plan_version_id', plan_version_id::text,
      'metric_type', metric_type::text, 'planning_level', planning_level::text,
      'semantic_fingerprint', semantic_fingerprint) order by id)
      from ltc_m.monthly_plan_baselines where plan_version_id = $1::uuid and metric_type = 'billing_planned'
  ), '[]'::jsonb),
  'existing_cells', coalesce((
    select jsonb_agg(jsonb_build_object('baseline_id', baseline_id::text,
      'project_id', project_id::text, 'project_item_id', project_item_id::text,
      'competence_month', competence_month::text, 'source_line_key', source_line_key,
      'source_item_number', source_item_number, 'source_row_number', source_row_number,
      'source_column', source_column, 'source_cell_reference', source_cell_reference,
      'declaration_state', declaration_state, 'source_numeric_text', source_numeric_text,
      'source_value_hash', source_value_hash, 'canonical_amount', canonical_amount::text,
      'financial_plan_line_id', financial_plan_line_id::text)
      order by baseline_id, project_item_id, competence_month)
      from ltc_m.monthly_plan_cells where plan_version_id = $1::uuid and metric_type = 'billing_planned'
  ), '[]'::jsonb),
  'existing_plan_lines', coalesce((
    select jsonb_agg(jsonb_build_object('id', id::text, 'project_id', project_id::text,
      'project_item_id', project_item_id::text, 'competence_month', competence_month::text,
      'amount', amount::text, 'currency_code', currency_code) order by project_item_id, competence_month)
      from ltc_m.financial_plan_lines where plan_version_id = $1::uuid and metric_type = 'billing_planned'
  ), '[]'::jsonb),
  'existing_artifacts', coalesce((
    select jsonb_agg(jsonb_build_object('source_sha256', source_sha256,
      'source_semantic_fingerprint', source_semantic_fingerprint) order by source_sha256)
      from ltc_m.monthly_source_artifacts where source_sha256 = $3::text or source_semantic_fingerprint = $4::text
  ), '[]'::jsonb),
  'existing_executions', coalesce((
    select jsonb_agg(jsonb_build_object('source_sha256', source_sha256,
      'baseline_id', baseline_id::text, 'baseline_semantic_fingerprint', baseline_semantic_fingerprint,
      'plan_version_id', plan_version_id::text) order by source_sha256)
      from ltc_m.monthly_plan_import_executions where plan_version_id = $1::uuid
  ), '[]'::jsonb),
  'read_scope', jsonb_build_object('project_codes', to_jsonb($2::text[]), 'target_plan_version_id', $1::text)
) as snapshot`;

const LOCAL_DATABASE = /^ltcm_test$/u;

function rawHostname(value: string): string {
  const protocolEnd = value.indexOf('://');
  const authorityEndCandidates = [
    value.indexOf('/', protocolEnd + 3),
    value.indexOf('?', protocolEnd + 3),
    value.indexOf('#', protocolEnd + 3),
  ].filter((index) => index >= 0);
  const authorityEnd =
    authorityEndCandidates.length === 0 ? value.length : Math.min(...authorityEndCandidates);
  const authority = value.slice(protocolEnd + 3, authorityEnd);
  const hostAndPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostAndPort.startsWith('[')) {
    const closingBracket = hostAndPort.indexOf(']');
    return closingBracket < 0 ? hostAndPort : hostAndPort.slice(0, closingBracket + 1);
  }
  const colon = hostAndPort.lastIndexOf(':');
  return colon < 0 ? hostAndPort : hostAndPort.slice(0, colon);
}

function localDatabaseTarget(value: string): { database_name: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    sanitized('P013_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
  const hostname = parsed.hostname.toLowerCase();
  const suppliedHostname = rawHostname(value).toLowerCase();
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const port = parsed.port === '' ? 5432 : Number(parsed.port);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(hostname) ||
    suppliedHostname !== hostname ||
    !LOCAL_DATABASE.test(databaseName) ||
    parsed.pathname !== `/${encodeURIComponent(databaseName)}` ||
    port !== 5432 ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    sanitized('P013_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
  return { database_name: databaseName };
}

function assertActor(actor: P013ActorContext): void {
  if (
    !UUID.test(actor.app_user_id) ||
    actor.auth_subject.trim() === '' ||
    actor.auth_subject.length > 200 ||
    actor.request_id.trim() === '' ||
    actor.request_id.length > 200 ||
    actor.source !== 'import' ||
    (actor.justification !== null && actor.justification.length > 2000)
  ) {
    sanitized('P013_ACTOR_CONTEXT_INVALID');
  }
}

function assertLoopbackPeer(client: PoolClient): void {
  const remoteAddress = (
    client as PoolClient & { connection?: { stream?: { remoteAddress?: unknown } } }
  ).connection?.stream?.remoteAddress;
  if (
    typeof remoteAddress !== 'string' ||
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress.toLowerCase())
  ) {
    sanitized('P013_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
}

function rowValue(row: QueryResultRow | undefined, key: string): unknown {
  return row?.[key];
}

async function attestAdapterSession(
  client: PoolClient,
  expectedDatabaseName: string,
): Promise<void> {
  assertLoopbackPeer(client);
  const result = await client.query(`select current_database() as database_name,
    current_user, session_user, current_setting('server_version_num') as server_version_num,
    roles.rolsuper, roles.rolbypassrls,
    pg_catalog.pg_has_role(session_user, 'ltc_m_runtime', 'set') as can_set_runtime
    from pg_catalog.pg_roles as roles where roles.rolname = session_user`);
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    rowValue(row, 'database_name') !== expectedDatabaseName ||
    rowValue(row, 'current_user') !== rowValue(row, 'session_user') ||
    !String(rowValue(row, 'server_version_num')).startsWith('17') ||
    rowValue(row, 'rolsuper') !== false ||
    rowValue(row, 'rolbypassrls') !== false ||
    rowValue(row, 'can_set_runtime') !== true
  ) {
    sanitized('P013_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
}

export function createP013LocalPostgresDryRunAdapter(options: {
  databaseUrl: string;
}): P013LocalPostgresDryRunAdapter {
  try {
    const databaseUrl = options.databaseUrl;
    const target = localDatabaseTarget(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const adapter: P013LocalPostgresDryRunAdapter = Object.freeze({
      contract: 'ltcm.p013.local-postgres-dry-run-adapter.v1' as const,
      close: async (): Promise<void> => {
        const state = adapterStates.get(adapter);
        if (state === undefined) sanitized('P013_ADAPTER_AUTHORITY_REQUIRED');
        if (!state.closed) {
          state.closed = true;
          await state.pool.end().catch(() => sanitized('P013_ADAPTER_CLOSE_FAILED'));
        }
      },
    });
    adapterStates.set(adapter, { pool, database_name: target.database_name, closed: false });
    return adapter;
  } catch (error) {
    if (error instanceof P013BoundaryError) throw error;
    sanitized('P013_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
}

async function readCertifiedSnapshot(options: {
  adapter: P013LocalPostgresDryRunAdapter;
  source: P013CertifiedMonthlySource;
  actor: P013ActorContext;
  targetPlanVersionId: string;
  projectCodes: readonly string[];
}): Promise<P013MonthlySnapshot> {
  if (!UUID.test(options.targetPlanVersionId)) sanitized('P013_TARGET_PLAN_VERSION_INVALID');
  assertActor(options.actor);
  const adapterState = adapterStates.get(options.adapter);
  if (adapterState === undefined || adapterState.closed) {
    sanitized('P013_ADAPTER_AUTHORITY_REQUIRED');
  }
  let client: PoolClient | undefined;
  let transactionOpen = false;
  const statementEvidence: P013MonthlyDryRunReceipt['statement_evidence'] = {
    transaction_control: 0,
    set_role: 0,
    runtime_attestation: 0,
    actor_context: 0,
    authorization_attestation: 0,
    read_only_attestation: 0,
    business_select: 0,
    insert: 0,
    update: 0,
    delete: 0,
    ddl: 0,
  };
  try {
    client = await adapterState.pool.connect();
    await attestAdapterSession(client, adapterState.database_name);
    statementEvidence.runtime_attestation += 1;
    await client.query('begin transaction isolation level repeatable read read only');
    statementEvidence.transaction_control += 1;
    transactionOpen = true;
    await client.query('set local role ltc_m_runtime');
    statementEvidence.set_role += 1;
    const runtime = await client.query(
      `select current_user, roles.rolsuper, roles.rolbypassrls
         from pg_catalog.pg_roles as roles where roles.rolname = current_user`,
    );
    statementEvidence.runtime_attestation += 1;
    if (
      runtime.rowCount !== 1 ||
      rowValue(runtime.rows[0], 'current_user') !== 'ltc_m_runtime' ||
      rowValue(runtime.rows[0], 'rolsuper') !== false ||
      rowValue(runtime.rows[0], 'rolbypassrls') !== false
    ) {
      sanitized('P013_RUNTIME_ROLE_INVALID');
    }
    await client.query(
      `select ltc_m.set_actor_context(
        $1::uuid, $2::text, $3::text, $4::text, $5::text, false
      )`,
      [
        options.actor.app_user_id,
        options.actor.auth_subject,
        options.actor.request_id,
        options.actor.justification,
        options.actor.source,
      ],
    );
    statementEvidence.actor_context += 1;
    const authorization = await client.query(
      `select app_user_id::text as app_user_id, app_role::text as app_role
         from ltc_m.authorization_context()`,
    );
    statementEvidence.authorization_attestation += 1;
    if (
      authorization.rowCount !== 1 ||
      rowValue(authorization.rows[0], 'app_user_id') !== options.actor.app_user_id ||
      !['editor', 'admin'].includes(String(rowValue(authorization.rows[0], 'app_role')))
    ) {
      sanitized('P013_ACTOR_NOT_AUTHORIZED');
    }
    const readOnly = await client.query(
      `select current_setting('transaction_read_only') as transaction_read_only`,
    );
    statementEvidence.read_only_attestation += 1;
    if (rowValue(readOnly.rows[0], 'transaction_read_only') !== 'on') {
      sanitized('P013_TRANSACTION_NOT_READ_ONLY');
    }
    const result = await client.query(SNAPSHOT_SQL, [
      options.targetPlanVersionId,
      options.projectCodes,
      options.source.source_sha256,
      options.source.source_semantic_fingerprint,
    ]);
    statementEvidence.business_select += 1;
    const raw = result.rows[0]?.['snapshot'];
    const withoutFingerprint = record(raw, 'database-result');
    const canonical = { ...withoutFingerprint, snapshot_fingerprint: '0'.repeat(64) };
    const parsed = parseP013MonthlySnapshotInternal(canonical, false);
    certifiedSnapshots.set(parsed, parsed.snapshot_fingerprint);
    snapshotBindings.set(parsed, { source: options.source, adapter: options.adapter });
    await client.query('rollback');
    statementEvidence.transaction_control += 1;
    transactionOpen = false;
    snapshotStatementEvidence.set(parsed, deepFreeze({ ...statementEvidence }));
    return parsed;
  } catch (error) {
    if (transactionOpen && client !== undefined) {
      await client.query('rollback').catch(() => undefined);
    }
    if (error instanceof P013BoundaryError) throw error;
    return sanitized('P013_DRY_RUN_FAILED');
  } finally {
    client?.release();
  }
}

function cents(value: string): bigint {
  const [integer = '0', fraction = '00'] = value.split('.');
  return BigInt(integer) * 100n + BigInt(fraction);
}

function fromCents(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

function signedFromCents(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function scaled14(value: string): bigint {
  const [integer = '0', fraction = ''] = value.split('.');
  return BigInt(integer) * 100_000_000_000_000n + BigInt(fraction.padEnd(14, '0'));
}

function roundedScaled14(value: bigint): bigint {
  return (value + 500_000_000_000n) / 1_000_000_000_000n;
}

function hashPlan(plan: Omit<P013MonthlyBaselinePlan, 'plan_hash'>): P013MonthlyBaselinePlan {
  const planHash = sha256Canonical(plan);
  return deepFreeze({ ...plan, plan_hash: planHash });
}

export function assertP013CertifiedMonthlyBaselinePlan(options: {
  plan: P013MonthlyBaselinePlan;
  source: P013CertifiedMonthlySource;
  snapshot: P013MonthlySnapshot;
}): void {
  try {
    const certified = certifiedPlans.get(options.plan);
    if (
      certified === undefined ||
      certified.source !== options.source ||
      certified.snapshot !== options.snapshot ||
      certified.plan.plan_hash !== sha256Canonical({ ...certified.plan, plan_hash: undefined })
    ) {
      sanitized('P013_PLAN_AUTHORITY_REQUIRED');
    }
  } catch {
    sanitized('P013_PLAN_AUTHORITY_REQUIRED');
  }
}

function sameOptional(left: string | null, right: string | null): boolean {
  return left === right;
}

function existingBaselineMatches(options: {
  source: P013CertifiedMonthlySource;
  snapshot: P013MonthlySnapshot;
  semanticFingerprint: string;
  cells: readonly P013CanonicalPlanCell[];
  materialLines: readonly P013MaterialPlanLine[];
}): boolean {
  const { source, snapshot, semanticFingerprint, cells, materialLines } = options;
  if (snapshot.existing_baselines.length !== 1) return false;
  const baseline = snapshot.existing_baselines[0]!;
  if (
    baseline.plan_version_id !== snapshot.read_scope.target_plan_version_id ||
    baseline.metric_type !== 'billing_planned' ||
    baseline.planning_level !== 'item' ||
    baseline.semantic_fingerprint !== semanticFingerprint ||
    snapshot.existing_cells.length !== cells.length ||
    snapshot.existing_plan_lines.length !== materialLines.length
  ) {
    return false;
  }
  const expectedCellByGrain = new Map(
    cells.map((cell) => [`${cell.project_item_id}\0${cell.competence_month}`, cell]),
  );
  const expectedLineByGrain = new Map(
    materialLines.map((line) => [`${line.project_item_id}\0${line.competence_month}`, line]),
  );
  const existingLineById = new Map(snapshot.existing_plan_lines.map((line) => [line.id, line]));
  const linkedLineIds = new Set<string>();
  for (const existing of snapshot.existing_cells) {
    const expected = expectedCellByGrain.get(
      `${existing.project_item_id}\0${existing.competence_month}`,
    );
    if (
      expected === undefined ||
      existing.baseline_id !== baseline.id ||
      existing.project_id !== expected.project_id ||
      existing.source_line_key !== expected.source_line_key ||
      existing.source_item_number !== expected.source_item_number ||
      existing.source_row_number !== expected.source_row_number ||
      existing.source_column !== expected.source_column ||
      existing.source_cell_reference !== expected.source_cell_reference ||
      existing.declaration_state !== expected.declaration_state ||
      !sameOptional(existing.source_numeric_text, expected.source_numeric_text) ||
      !sameOptional(existing.source_value_hash, expected.source_value_hash) ||
      !sameOptional(existing.canonical_amount, expected.canonical_amount)
    ) {
      return false;
    }
    if (expected.declaration_state === 'blank') {
      if (existing.financial_plan_line_id !== null) return false;
      continue;
    }
    if (existing.financial_plan_line_id === null) return false;
    const line = existingLineById.get(existing.financial_plan_line_id);
    const expectedLine = expectedLineByGrain.get(
      `${existing.project_item_id}\0${existing.competence_month}`,
    );
    if (
      line === undefined ||
      expectedLine === undefined ||
      linkedLineIds.has(line.id) ||
      line.project_id !== expectedLine.project_id ||
      line.project_item_id !== expectedLine.project_item_id ||
      line.competence_month !== expectedLine.competence_month ||
      line.amount !== expectedLine.amount ||
      line.currency_code !== expectedLine.currency_code
    ) {
      return false;
    }
    linkedLineIds.add(line.id);
  }
  if (linkedLineIds.size !== snapshot.existing_plan_lines.length) return false;
  return snapshot.existing_executions.some(
    (execution) =>
      execution.baseline_id === baseline.id &&
      execution.baseline_semantic_fingerprint === baseline.semantic_fingerprint &&
      execution.plan_version_id === baseline.plan_version_id &&
      snapshot.existing_artifacts.some(
        (artifact) =>
          artifact.source_sha256 === execution.source_sha256 &&
          artifact.source_semantic_fingerprint === source.source_semantic_fingerprint,
      ),
  );
}

function buildPlan(
  source: P013CertifiedMonthlySource,
  snapshot: P013MonthlySnapshot,
): { plan: P013MonthlyBaselinePlan | null; status: P013MonthlyPlanStatus; diagnostics: string[] } {
  const sourceFacts = readP013CertifiedMonthlySourceFacts(source);
  const diagnostics: string[] = [];
  if (snapshot.target_plan_version === null) diagnostics.push('P013_TARGET_PLAN_VERSION_NOT_FOUND');
  else if (
    snapshot.target_plan_version.status !== 'draft' ||
    !snapshot.target_plan_version.is_baseline
  )
    diagnostics.push('P013_TARGET_PLAN_VERSION_NOT_DRAFT_BASELINE');
  const resolutions = new Map<
    string,
    { project_id: string; project_item_id: string; source_line_key: string }
  >();
  const identities = new Map<string, P013MonthlySourceCellFacts>();
  for (const cell of sourceFacts.cells)
    identities.set(`${cell.project_code}\0${cell.source_item_number}`, cell);
  for (const [identity, cell] of [...identities.entries()].sort(([left], [right]) =>
    compare(left, right),
  )) {
    const itemNumber = parseSourceItemNumber(cell.source_item_number);
    const sourceLineKey = createSourceLineKey(cell.project_code, itemNumber);
    const projects = snapshot.projects.filter(
      (project) =>
        project.project_code === cell.project_code &&
        project.status === 'active' &&
        project.deleted_at === null,
    );
    if (projects.length !== 1) {
      diagnostics.push(`P013_NB01_PROJECT_UNRESOLVED:${cell.project_code}`);
      continue;
    }
    const project = projects[0]!;
    const items = snapshot.project_items.filter(
      (item) =>
        item.project_id === project.id &&
        item.source_line_key === sourceLineKey &&
        item.line_number === itemNumber &&
        item.active &&
        item.deleted_at === null,
    );
    if (items.length !== 1) {
      diagnostics.push(`P013_NB01_ITEM_UNRESOLVED:${cell.project_code}:${cell.source_item_number}`);
      continue;
    }
    if (
      !snapshot.plan_scopes.some(
        (scope) =>
          scope.project_id === project.id &&
          scope.metric_type === 'billing_planned' &&
          scope.planning_level === 'item',
      )
    ) {
      diagnostics.push(`P013_PLAN_SCOPE_MISSING:${cell.project_code}`);
      continue;
    }
    resolutions.set(identity, {
      project_id: project.id,
      project_item_id: items[0]!.id,
      source_line_key: sourceLineKey,
    });
  }
  const uniqueDiagnostics = [...new Set(diagnostics)].sort(compare);
  if (uniqueDiagnostics.length > 0)
    return { plan: null, status: 'pending_decision', diagnostics: uniqueDiagnostics };
  const cells: P013CanonicalPlanCell[] = sourceFacts.cells
    .map((cell) => {
      const resolution = resolutions.get(`${cell.project_code}\0${cell.source_item_number}`);
      if (resolution === undefined) sanitized('P013_RESOLUTION_INTERNAL_ERROR');
      return deepFreeze({ ...cell, ...resolution });
    })
    .sort((left, right) =>
      compare(
        `${left.project_item_id}\0${left.competence_month}`,
        `${right.project_item_id}\0${right.competence_month}`,
      ),
    );
  const semantic = createP013MonthlyBaselineSemanticIdentity(
    cells.map((cell) => ({
      project_item_id: cell.project_item_id,
      source_line_key: cell.source_line_key,
      competence_month: cell.competence_month,
      declaration_state: cell.declaration_state,
      raw_decimal: cell.source_numeric_text,
    })),
  );
  const materialLines: P013MaterialPlanLine[] = cells
    .filter((cell) => cell.declaration_state !== 'blank')
    .map((cell) => {
      const scope = snapshot.plan_scopes.find(({ project_id }) => project_id === cell.project_id);
      if (scope === undefined) sanitized('P013_PLAN_SCOPE_INTERNAL_ERROR');
      return deepFreeze({
        line_key: `p013-line-v1:${sha256Canonical({ plan_version_id: snapshot.read_scope.target_plan_version_id, project_item_id: cell.project_item_id, competence_month: cell.competence_month, metric_type: 'billing_planned' })}`,
        plan_version_id: snapshot.read_scope.target_plan_version_id,
        project_id: cell.project_id,
        project_item_id: cell.project_item_id,
        metric_type: 'billing_planned' as const,
        planning_level: 'item' as const,
        competence_month: cell.competence_month,
        amount: cell.canonical_amount!,
        currency_code: scope.currency_code,
        source_cell_reference: cell.source_cell_reference,
      });
    });
  const groups = new Map<string, P013CanonicalPlanCell[]>();
  for (const cell of cells)
    groups.set(cell.project_item_id, [...(groups.get(cell.project_item_id) ?? []), cell]);
  const itemReconciliation = [...groups.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([projectItemId, itemCells]) => {
      const canonicalTotalCents = itemCells.reduce(
        (sum, cell) => sum + cents(cell.canonical_amount ?? '0.00'),
        0n,
      );
      const rawRoundedCents = roundedScaled14(
        itemCells.reduce(
          (sum, cell) =>
            sum + (cell.source_numeric_text === null ? 0n : scaled14(cell.source_numeric_text)),
          0n,
        ),
      );
      const diagnostic = itemCells[0]!.source_item_total_canonical_amount;
      return deepFreeze({
        project_item_id: projectItemId,
        position_count: itemCells.length,
        blank_count: itemCells.filter(({ declaration_state }) => declaration_state === 'blank')
          .length,
        explicit_zero_count: itemCells.filter(
          ({ declaration_state }) => declaration_state === 'explicit_zero',
        ).length,
        non_zero_count: itemCells.filter(({ declaration_state }) => declaration_state === 'value')
          .length,
        canonical_total: fromCents(canonicalTotalCents),
        source_raw_rounded_total: fromCents(rawRoundedCents),
        rounding_residual: signedFromCents(canonicalTotalCents - rawRoundedCents),
        diagnostic_total_j: diagnostic,
        diagnostic_residual:
          diagnostic === null ? null : signedFromCents(canonicalTotalCents - cents(diagnostic)),
      });
    });
  let status: 'ready' | 'no_op_candidate' | 'conflict' = 'ready';
  const planDiagnostics: string[] = [];
  if (snapshot.existing_baselines.length > 0) {
    if (
      !existingBaselineMatches({
        source,
        snapshot,
        semanticFingerprint: semantic.semantic_fingerprint,
        cells,
        materialLines,
      })
    ) {
      status = 'conflict';
      planDiagnostics.push('P013_EXISTING_BASELINE_CONFLICT');
    } else {
      status = 'no_op_candidate';
    }
  } else if (
    snapshot.existing_cells.length > 0 ||
    snapshot.existing_plan_lines.length > 0 ||
    snapshot.existing_executions.length > 0
  ) {
    status = 'conflict';
    planDiagnostics.push('P013_ORPHAN_EXISTING_BASELINE_STATE');
  }
  const plan = hashPlan({
    contract: P013_MONTHLY_PLAN_CONTRACT,
    status,
    source_artifact: {
      source_name: source.source_name,
      source_sha256: source.source_sha256,
      source_size_bytes: source.source_size_bytes,
      source_semantic_fingerprint: source.source_semantic_fingerprint,
    },
    snapshot_fingerprint: snapshot.snapshot_fingerprint,
    target_plan_version_id: snapshot.read_scope.target_plan_version_id,
    metric_type: 'billing_planned',
    planning_level: 'item',
    baseline_semantic_fingerprint: semantic.semantic_fingerprint,
    idempotency_key: createP013MonthlyBaselineIdempotencyKey(
      snapshot.read_scope.target_plan_version_id,
      semantic.semantic_fingerprint,
    ),
    cells,
    material_lines: materialLines,
    item_reconciliation: itemReconciliation,
    global_reconciliation: {
      position_count: cells.length,
      blank_count: source.blank_count,
      explicit_zero_count: source.explicit_zero_count,
      non_zero_count: source.non_zero_count,
      material_line_count: materialLines.length,
      canonical_total: source.canonical_total,
      aggregate_raw_rounded_total: source.aggregate_raw_rounded_total,
      rounding_residual: source.rounding_residual,
    },
    diagnostics: planDiagnostics.sort(compare),
  });
  return { plan, status, diagnostics: plan.diagnostics };
}

/** Test-only derivation surface. It never registers snapshot or plan authority. */
export function deriveP013MonthlyBaselinePreviewForTest(options: {
  source: P013CertifiedMonthlySource;
  snapshot: unknown;
}): P013MonthlyBaselinePreview {
  const withoutFingerprint = record(options.snapshot, 'preview-snapshot');
  const parsed = parseP013MonthlySnapshotInternal(
    { ...withoutFingerprint, snapshot_fingerprint: '0'.repeat(64) },
    false,
  );
  const result = buildPlan(options.source, parsed);
  return deepFreeze({ ...result, snapshot: parsed });
}

export async function runP013MonthlyBaselineDryRun(options: {
  source: P013CertifiedMonthlySource;
  adapter: P013LocalPostgresDryRunAdapter;
  actor: P013ActorContext;
  targetPlanVersionId: string;
}): Promise<P013MonthlyDryRunResult> {
  try {
    const sourceFacts = readP013CertifiedMonthlySourceFacts(options.source);
    const projectCodes = [
      ...new Set(sourceFacts.cells.map(({ project_code }) => project_code)),
    ].sort(compare);
    const snapshot = await readCertifiedSnapshot({
      adapter: options.adapter,
      source: options.source,
      actor: options.actor,
      targetPlanVersionId: options.targetPlanVersionId,
      projectCodes,
    });
    const binding = snapshotBindings.get(snapshot);
    if (
      certifiedSnapshots.get(snapshot) !== snapshot.snapshot_fingerprint ||
      binding?.source !== options.source ||
      binding.adapter !== options.adapter
    ) {
      sanitized('P013_SNAPSHOT_AUTHORITY_REQUIRED');
    }
    const result = buildPlan(options.source, snapshot);
    if (result.plan !== null) {
      certifiedPlans.set(result.plan, { plan: result.plan, source: options.source, snapshot });
    }
    const statementEvidence = snapshotStatementEvidence.get(snapshot);
    if (statementEvidence === undefined) sanitized('P013_STATEMENT_EVIDENCE_REQUIRED');
    const writeStatementCount =
      statementEvidence.insert +
      statementEvidence.update +
      statementEvidence.delete +
      statementEvidence.ddl;
    const selectStatementCount =
      statementEvidence.runtime_attestation +
      statementEvidence.actor_context +
      statementEvidence.authorization_attestation +
      statementEvidence.read_only_attestation +
      statementEvidence.business_select;
    const receipt = deepFreeze({
      contract: P013_MONTHLY_DRY_RUN_RECEIPT_CONTRACT,
      status: result.status,
      source_sha256: options.source.source_sha256,
      source_semantic_fingerprint: options.source.source_semantic_fingerprint,
      snapshot_fingerprint: snapshot.snapshot_fingerprint,
      target_plan_version_id: options.targetPlanVersionId,
      baseline_semantic_fingerprint: result.plan?.baseline_semantic_fingerprint ?? null,
      plan_hash: result.plan?.plan_hash ?? null,
      position_count: options.source.cell_count,
      blank_count: options.source.blank_count,
      explicit_zero_count: options.source.explicit_zero_count,
      non_zero_count: options.source.non_zero_count,
      material_line_count: options.source.explicit_zero_count + options.source.non_zero_count,
      canonical_total: options.source.canonical_total,
      aggregate_raw_rounded_total: options.source.aggregate_raw_rounded_total,
      rounding_residual: options.source.rounding_residual,
      select_statement_count: selectStatementCount,
      write_statement_count: writeStatementCount,
      transaction_read_only: true as const,
      statement_evidence: statementEvidence,
      diagnostics: result.diagnostics,
    });
    return deepFreeze({ plan: result.plan, receipt, snapshot });
  } catch (error) {
    if (error instanceof P013BoundaryError) throw error;
    sanitized('P013_DRY_RUN_FAILED');
  }
}
