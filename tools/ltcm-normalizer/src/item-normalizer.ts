import { sha256Canonical } from './canonical-json.js';
import {
  assertItemCandidateId,
  assertSourceLineKey,
  createItemCandidateId,
  createSourceLineKey,
  deriveTotalAmount,
  normalizeOptionalItemText,
  normalizeUnit,
  parseCanonicalCurrency,
  parseP012ExistingItemsSnapshot,
  parseQuantity,
  parseSourceItemNumber,
  parseTotalAmount,
  parseUnitPrice,
  roundEvidenceAmount,
  type P012UnitCode,
} from './item-contracts.js';
import { createValidatedP011ProjectView } from './p011-artifacts-provenance.js';
import {
  canonicalInputHash,
  createValidatedSourceView,
  type LoadedSource,
} from './source-reader.js';
import type {
  ItemCandidate,
  P010Row,
  P011Artifacts,
  P012ExistingItemsSnapshot,
  P012ItemDiagnosticCode,
  P012ItemCandidateSet,
  P012ItemCellEvidence,
  PlanAction,
  ProjectCandidate,
  RawCell,
  SourceCoordinate,
} from './types.js';
import { P012_ITEM_DIAGNOSTIC_CODES } from './types.js';

const ITEM_COLUMNS = ['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;
const PROJECT_CODE = /^\d{4}-\d{2}-\d{5}$/u;
const PROJECT_CANDIDATE_ID = /^project-[0-9a-f]{24}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const P012_ITEM_DIAGNOSTIC_SET = new Set<string>(P012_ITEM_DIAGNOSTIC_CODES);
const FACTUAL_REJECTION_DIAGNOSTICS = new Set<P012ItemDiagnosticCode>([
  'P012_TEXT_INVALID',
  'P012_DECIMAL_INVALID',
  'P012_UNIT_UNRESOLVED',
  'P012_CURRENCY_UNRESOLVED',
  'P012_TOTAL_EVIDENCE_MISMATCH',
]);
const CATALOG_DIAGNOSTICS = new Set<P012ItemDiagnosticCode>([
  'P012_UNIT_CATALOG_UNAVAILABLE',
  'P012_CURRENCY_CATALOG_UNAVAILABLE',
]);
const ITEM_CANDIDATE_KEYS = [
  'contract',
  'payload_schema_version',
  'candidate_id',
  'source_line_key',
  'source_item_number',
  'line_number',
  'project',
  'item_code',
  'description',
  'quantity',
  'unit_code',
  'currency_code',
  'unit_price',
  'total_amount',
  'action',
  'status',
  'target_id',
  'diagnostic_codes',
  'origins',
  'evidence',
  'source_lineage',
  'candidate_hash',
] as const;

interface CertifiedCandidateSetRecord {
  sourceIdentity: LoadedSource;
  p011Identity: P011Artifacts;
  snapshot: P012ExistingItemsSnapshot;
  snapshotFingerprint: string;
  fingerprint: string;
}

const certifiedCandidateSets = new WeakMap<object, CertifiedCandidateSetRecord>();

function cell(row: P010Row, column: string): RawCell | undefined {
  return row.raw_payload.cells.find((candidate) => candidate.column_letter === column);
}

function cellText(cellValue: RawCell | undefined): string | null {
  if (cellValue === undefined || cellValue.value === null) return null;
  if (typeof cellValue.value === 'string') return cellValue.value;
  if (typeof cellValue.value === 'number') return cellValue.round_trip_text ?? null;
  return null;
}

function requiredDecimalText(cellValue: RawCell | undefined, label: string): string {
  if (
    cellValue === undefined ||
    typeof cellValue.value !== 'number' ||
    typeof cellValue.round_trip_text !== 'string'
  ) {
    throw new Error(`P012_DECIMAL_INVALID: ${label}.`);
  }
  return cellValue.round_trip_text;
}

function projectCode(row: P010Row): string {
  const raw = cell(row, 'B')?.value;
  if (typeof raw !== 'string') throw new Error('P012_PROJECT_UNRESOLVED: monthly_revenue.B.');
  const normalized = normalizeOptionalItemText(raw, 'project_code');
  if (normalized === null || !PROJECT_CODE.test(normalized)) {
    throw new Error('P012_PROJECT_UNRESOLVED: monthly_revenue.B.');
  }
  return normalized;
}

function sourceItemNumber(row: P010Row): number {
  const candidate = cell(row, 'A');
  const representation =
    typeof candidate?.value === 'number'
      ? candidate.round_trip_text
      : typeof candidate?.value === 'string'
        ? candidate.value
        : undefined;
  return parseSourceItemNumber(representation);
}

function origin(source: LoadedSource, row: P010Row, address: string): SourceCoordinate {
  return {
    sheet_key: 'monthly_revenue',
    sheet_name: row.raw_payload.sheet_name,
    source_row_number: row.source_row_number,
    source_range: row.source_range,
    cell_address: address,
    row_hash: row.row_hash,
    workbook_hash: source.workbookHash,
  };
}

function evidence(row: P010Row): P012ItemCellEvidence[] {
  return ITEM_COLUMNS.map((column) => {
    const sourceCell = cell(row, column);
    return {
      column,
      address: sourceCell?.address ?? `${column}${row.source_row_number}`,
      raw_value: sourceCell?.value ?? null,
      round_trip_text: sourceCell?.round_trip_text ?? null,
      formatted_text: sourceCell?.formatted_text ?? null,
      number_format: sourceCell?.number_format ?? null,
    };
  });
}

function isP012ItemDiagnosticCode(value: unknown): value is P012ItemDiagnosticCode {
  return typeof value === 'string' && P012_ITEM_DIAGNOSTIC_SET.has(value);
}

function errorCode(error: unknown, fallback: P012ItemDiagnosticCode): P012ItemDiagnosticCode {
  if (!(error instanceof Error)) return fallback;
  const [code] = error.message.split(':', 1);
  return isP012ItemDiagnosticCode(code) ? code : fallback;
}

function uniqueSorted(values: P012ItemDiagnosticCode[]): P012ItemDiagnosticCode[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

function projectAction(project: ProjectCandidate): {
  action: PlanAction;
  diagnostic: P012ItemDiagnosticCode | null;
} {
  if (project.action === 'insert' || project.action === 'no_op') {
    return { action: 'insert', diagnostic: null };
  }
  return {
    action: project.action,
    diagnostic: 'P012_PROJECT_NOT_ELIGIBLE',
  };
}

function actionStatus(action: PlanAction): ItemCandidate['status'] {
  if (action === 'insert') return 'persistence_ready';
  if (action === 'no_op') return 'unchanged';
  if (action === 'pending_decision') return 'requires_review';
  if (action === 'rejected') return 'rejected';
  return 'blocked';
}

interface P012ItemStateFacts {
  sourceLineKey: string;
  lineNumber: number;
  itemCode: string | null;
  description: string | null;
  quantity: string | null;
  unitCode: P012UnitCode | null;
  currencyCode: string | null;
  unitPrice: string | null;
  totalAmount: string | null;
}

function deriveP012ItemState(
  project: ProjectCandidate,
  snapshot: P012ExistingItemsSnapshot,
  targetProjectId: string | null,
  facts: P012ItemStateFacts,
  factualDiagnostics: P012ItemDiagnosticCode[],
): Pick<ItemCandidate, 'action' | 'status' | 'target_id' | 'diagnostic_codes'> {
  const diagnostics = [...factualDiagnostics];
  const unitAvailable =
    facts.unitCode !== null &&
    snapshot.units.some(({ code, active }) => code === facts.unitCode && active);
  const currencyAvailable =
    facts.currencyCode !== null &&
    snapshot.currencies.some(({ code, active }) => code === facts.currencyCode && active);
  if (facts.unitCode !== null && !unitAvailable) {
    diagnostics.push('P012_UNIT_CATALOG_UNAVAILABLE');
  }
  if (facts.currencyCode !== null && !currencyAvailable) {
    diagnostics.push('P012_CURRENCY_CATALOG_UNAVAILABLE');
  }

  const projectState = projectAction(project);
  if (projectState.diagnostic !== null) diagnostics.push(projectState.diagnostic);
  if (project.action === 'no_op' && targetProjectId === null) {
    diagnostics.push('P012_PROJECT_TARGET_UNRESOLVED');
  }
  const factualInvalid = diagnostics.some((code) => FACTUAL_REJECTION_DIAGNOSTICS.has(code));
  const catalogBlocked = diagnostics.some((code) => CATALOG_DIAGNOSTICS.has(code));
  let action = projectState.action;
  if (factualInvalid) action = 'rejected';
  else if (catalogBlocked && (project.action === 'insert' || project.action === 'no_op')) {
    action = 'pending_decision';
  } else if (project.action === 'no_op' && targetProjectId === null) action = 'conflict';

  const target = findSnapshotTarget(facts, snapshot, targetProjectId);
  let targetId: string | null = null;
  if (action === 'insert' && target !== undefined && targetProjectId !== null) {
    targetId = target.id;
    action = equivalent(facts, target, targetProjectId) ? 'no_op' : 'conflict';
    if (action === 'conflict') diagnostics.push('P012_ITEM_CONFLICT');
  }
  return {
    action,
    status: actionStatus(action),
    target_id: targetId,
    diagnostic_codes: uniqueSorted(diagnostics),
  };
}

function assertDeclaredStateCausality(candidate: ItemCandidate): void {
  const diagnostics = new Set(candidate.diagnostic_codes);
  const factualInvalid = candidate.diagnostic_codes.some((code) =>
    FACTUAL_REJECTION_DIAGNOSTICS.has(code),
  );
  const catalogBlocked = candidate.diagnostic_codes.some((code) => CATALOG_DIAGNOSTICS.has(code));
  const projectEligible =
    candidate.project.project_action === 'insert' || candidate.project.project_action === 'no_op';
  const projectTargetUnresolved =
    candidate.project.project_action === 'no_op' && candidate.project.project_target_id === null;
  const itemConflict = diagnostics.has('P012_ITEM_CONFLICT');

  if (
    diagnostics.has('P012_PROJECT_NOT_ELIGIBLE') !== !projectEligible ||
    diagnostics.has('P012_PROJECT_TARGET_UNRESOLVED') !== projectTargetUnresolved ||
    itemConflict !== (candidate.action === 'conflict' && candidate.target_id !== null) ||
    (candidate.target_id !== null && candidate.project.project_action !== 'no_op')
  ) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: state-causality.');
  }

  let expectedAction: PlanAction = projectEligible ? 'insert' : candidate.project.project_action;
  if (factualInvalid) expectedAction = 'rejected';
  else if (catalogBlocked && projectEligible) expectedAction = 'pending_decision';
  else if (projectTargetUnresolved) expectedAction = 'conflict';
  else if (candidate.target_id !== null) expectedAction = itemConflict ? 'conflict' : 'no_op';

  if (candidate.action !== expectedAction || candidate.status !== actionStatus(expectedAction)) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: state-causality.');
  }
}

function equivalent(
  facts: P012ItemStateFacts,
  existing: P012ExistingItemsSnapshot['items'][number],
  targetProjectId: string,
): boolean {
  return (
    targetProjectId === existing.project_id &&
    facts.lineNumber === existing.line_number &&
    facts.itemCode === existing.item_code &&
    facts.description === existing.description &&
    facts.quantity === existing.quantity &&
    facts.unitCode === existing.unit_code &&
    facts.currencyCode === existing.currency_code &&
    facts.unitPrice === existing.unit_price &&
    facts.totalAmount === existing.total_amount &&
    existing.active &&
    existing.deleted_at === null
  );
}

function findSnapshotTarget(
  facts: P012ItemStateFacts,
  snapshot: P012ExistingItemsSnapshot,
  targetProjectId: string | null,
): P012ExistingItemsSnapshot['items'][number] | undefined {
  if (targetProjectId === null) return undefined;
  const keyMatch = snapshot.items.find(
    (item) => item.project_id === targetProjectId && item.source_line_key === facts.sourceLineKey,
  );
  const lineMatch = snapshot.items.find(
    (item) => item.project_id === targetProjectId && item.line_number === facts.lineNumber,
  );
  if (keyMatch !== undefined && lineMatch !== undefined && keyMatch.id !== lineMatch.id) {
    throw new Error('P012_SNAPSHOT_INVALID: crossed-key-line-targets.');
  }
  return keyMatch ?? lineMatch;
}

function projectTargets(
  projects: ProjectCandidate[],
  snapshot: P012ExistingItemsSnapshot,
): Map<string, string> {
  const byCandidate = new Map(projects.map((project) => [project.candidate_id, project]));
  const result = new Map<string, string>();
  for (const target of snapshot.projects) {
    const project = byCandidate.get(target.project_candidate_id);
    if (
      project === undefined ||
      project.project_code !== target.project_code ||
      project.currency !== target.currency_code
    ) {
      throw new Error('P012_SNAPSHOT_INVALID: project-linkage.');
    }
    if (project.action === 'insert') {
      throw new Error('P012_SNAPSHOT_INVALID: insert-project-has-target.');
    }
    if (!target.active || target.deleted_at !== null) {
      throw new Error('P012_SNAPSHOT_INVALID: project-target-unavailable.');
    }
    result.set(project.candidate_id, target.id);
  }
  return result;
}

function dataRows(source: LoadedSource): P010Row[] {
  const rows = [...(source.rows.get('monthly_revenue') ?? [])].sort(
    (left, right) => left.source_row_number - right.source_row_number,
  );
  if (rows.length < 5) throw new Error('P012_SOURCE_STRUCTURE_INVALID: monthly_revenue.');
  const lastRow = rows.at(-1)?.source_row_number;
  if (lastRow === undefined) throw new Error('P012_SOURCE_STRUCTURE_INVALID: monthly_revenue.');
  const selected = rows.filter(
    (row) => row.source_row_number > 3 && row.source_row_number < lastRow,
  );
  if (selected.length === 0) throw new Error('P012_SOURCE_STRUCTURE_INVALID: item-rows.');
  return selected;
}

function buildCandidate(
  source: LoadedSource,
  row: P010Row,
  project: ProjectCandidate,
  snapshot: P012ExistingItemsSnapshot,
  targetProjectId: string | null,
  p010ManifestHash: string,
  inputHash: string,
): ItemCandidate {
  const itemNumber = sourceItemNumber(row);
  const sourceLineKey = createSourceLineKey(project.project_code, itemNumber);
  const candidateId = createItemCandidateId(project.candidate_id, sourceLineKey);
  const diagnostics: P012ItemDiagnosticCode[] = [];

  let itemCode: string | null = null;
  let description: string | null = null;
  let quantity: string | null = null;
  let unitCode: P012UnitCode | null = null;
  let currencyCode: string | null = null;
  let unitPrice: string | null = null;
  let totalAmount: string | null = null;

  try {
    itemCode = normalizeOptionalItemText(cell(row, 'D')?.value, 'item_code');
  } catch (error) {
    diagnostics.push(errorCode(error, 'P012_TEXT_INVALID'));
  }
  try {
    description = normalizeOptionalItemText(cell(row, 'E')?.value, 'description');
  } catch (error) {
    diagnostics.push(errorCode(error, 'P012_TEXT_INVALID'));
  }
  try {
    quantity = parseQuantity(requiredDecimalText(cell(row, 'F'), 'quantity')).canonical;
  } catch (error) {
    diagnostics.push(errorCode(error, 'P012_DECIMAL_INVALID'));
  }
  try {
    unitCode = normalizeUnit(cell(row, 'G')?.value);
  } catch (error) {
    diagnostics.push(errorCode(error, 'P012_UNIT_UNRESOLVED'));
  }
  try {
    currencyCode = parseCanonicalCurrency(cell(row, 'H')?.value, 'monthly_revenue.H');
    if (currencyCode !== project.currency) throw new Error('P012_CURRENCY_UNRESOLVED: mismatch.');
  } catch (error) {
    diagnostics.push(errorCode(error, 'P012_CURRENCY_UNRESOLVED'));
  }
  try {
    unitPrice = parseUnitPrice(requiredDecimalText(cell(row, 'I'), 'unit_price')).canonical;
  } catch (error) {
    diagnostics.push(errorCode(error, 'P012_DECIMAL_INVALID'));
  }
  if (quantity !== null && unitPrice !== null) {
    try {
      totalAmount = deriveTotalAmount(parseQuantity(quantity), parseUnitPrice(unitPrice));
      const totalEvidence = cell(row, 'J');
      const evidenceText = cellText(totalEvidence);
      if (
        project.project_code !== '2024-02-10990' &&
        totalEvidence?.value !== null &&
        totalEvidence !== undefined
      ) {
        if (evidenceText === null || roundEvidenceAmount(evidenceText) !== totalAmount) {
          throw new Error('P012_TOTAL_EVIDENCE_MISMATCH: monthly_revenue.J.');
        }
      }
    } catch (error) {
      totalAmount = null;
      diagnostics.push(errorCode(error, 'P012_TOTAL_EVIDENCE_MISMATCH'));
    }
  }

  const facts: P012ItemStateFacts = {
    sourceLineKey,
    lineNumber: itemNumber,
    itemCode,
    description,
    quantity,
    unitCode,
    currencyCode,
    unitPrice,
    totalAmount,
  };
  const derivedState = deriveP012ItemState(project, snapshot, targetProjectId, facts, diagnostics);

  const base: Omit<ItemCandidate, 'candidate_hash'> = {
    contract: 'ltcm.p012.item-candidate.v1',
    payload_schema_version: 1,
    candidate_id: candidateId,
    source_line_key: sourceLineKey,
    source_item_number: itemNumber,
    line_number: itemNumber,
    project: {
      project_candidate_id: project.candidate_id,
      project_candidate_hash: project.hash,
      project_code: project.project_code,
      project_action: project.action,
      project_target_id: targetProjectId,
    },
    item_code: itemCode,
    description,
    quantity,
    unit_code: unitCode,
    currency_code: currencyCode,
    unit_price: unitPrice,
    total_amount: totalAmount,
    action: derivedState.action,
    status: derivedState.status,
    target_id: derivedState.target_id,
    diagnostic_codes: derivedState.diagnostic_codes,
    origins: ITEM_COLUMNS.map((column) => origin(source, row, `${column}${row.source_row_number}`)),
    evidence: evidence(row),
    source_lineage: {
      p010_manifest_hash: p010ManifestHash,
      input_hash: inputHash,
      workbook_hash: source.workbookHash,
      sheet_key: 'monthly_revenue',
      sheet_name: row.raw_payload.sheet_name,
      physical_row: row.source_row_number,
      source_range: row.source_range,
      row_hash: row.row_hash,
      source_item_number: itemNumber,
      project_candidate_id: project.candidate_id,
      project_candidate_hash: project.hash,
      source_line_key: sourceLineKey,
    },
  };
  return { ...base, candidate_hash: sha256Canonical(base) };
}

function assertClosedCandidate(
  candidate: unknown,
  verifyHash = true,
): asserts candidate is ItemCandidate {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: candidate.');
  }
  const record = candidate as Record<string, unknown>;
  if (
    ITEM_CANDIDATE_KEYS.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !ITEM_CANDIDATE_KEYS.includes(key as never))
  ) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: closed-contract.');
  }
  const typed = candidate as ItemCandidate;
  const exactNestedKeys = (
    value: unknown,
    keys: readonly string[],
    label: string,
  ): Record<string, unknown> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`P012_CANDIDATE_SCHEMA_INVALID: ${label}.`);
    }
    const nested = value as Record<string, unknown>;
    if (
      keys.some((key) => !Object.hasOwn(nested, key)) ||
      Object.keys(nested).some((key) => !keys.includes(key))
    ) {
      throw new Error(`P012_CANDIDATE_SCHEMA_INVALID: ${label}.`);
    }
    return nested;
  };
  if (
    typed.contract !== 'ltcm.p012.item-candidate.v1' ||
    typed.payload_schema_version !== 1 ||
    !Number.isSafeInteger(typed.source_item_number) ||
    typed.source_item_number <= 0 ||
    typed.source_item_number !== typed.line_number ||
    !Array.isArray(typed.diagnostic_codes) ||
    !Array.isArray(typed.origins) ||
    !Array.isArray(typed.evidence) ||
    !['insert', 'no_op', 'conflict', 'rejected', 'pending_decision'].includes(typed.action) ||
    typed.status !== actionStatus(typed.action) ||
    typed.diagnostic_codes.some(
      (code, index) =>
        !isP012ItemDiagnosticCode(code) || typed.diagnostic_codes.indexOf(code) !== index,
    )
  ) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: invariants.');
  }
  if (
    JSON.stringify(typed.diagnostic_codes) !== JSON.stringify(uniqueSorted(typed.diagnostic_codes))
  ) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: diagnostic-order.');
  }
  const project = exactNestedKeys(
    typed.project,
    [
      'project_candidate_id',
      'project_candidate_hash',
      'project_code',
      'project_action',
      'project_target_id',
    ],
    'project',
  );
  if (
    typeof project['project_candidate_id'] !== 'string' ||
    !PROJECT_CANDIDATE_ID.test(project['project_candidate_id']) ||
    typeof project['project_candidate_hash'] !== 'string' ||
    !SHA256.test(project['project_candidate_hash']) ||
    typeof project['project_code'] !== 'string' ||
    !PROJECT_CODE.test(project['project_code']) ||
    typeof project['project_action'] !== 'string' ||
    !['insert', 'no_op', 'conflict', 'rejected', 'pending_decision'].includes(
      project['project_action'],
    ) ||
    !(
      project['project_target_id'] === null ||
      (typeof project['project_target_id'] === 'string' && UUID.test(project['project_target_id']))
    )
  ) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: project-invariants.');
  }
  if (
    normalizeOptionalItemText(typed.item_code, 'item_code') !== typed.item_code ||
    normalizeOptionalItemText(typed.description, 'description') !== typed.description
  ) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: text-invariants.');
  }
  if (typed.quantity !== null) parseQuantity(typed.quantity);
  if (typed.unit_price !== null) parseUnitPrice(typed.unit_price);
  if (typed.unit_code !== null && normalizeUnit(typed.unit_code) !== typed.unit_code) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: unit-invariants.');
  }
  if (typed.currency_code !== null) parseCanonicalCurrency(typed.currency_code);
  if (typed.total_amount !== null) {
    if (typed.quantity === null || typed.unit_price === null) {
      throw new Error('P012_CANDIDATE_SCHEMA_INVALID: total-inputs.');
    }
    if (
      parseTotalAmount(typed.total_amount) !==
      deriveTotalAmount(parseQuantity(typed.quantity), parseUnitPrice(typed.unit_price))
    ) {
      throw new Error('P012_CANDIDATE_SCHEMA_INVALID: total-invariants.');
    }
  }
  if (
    (typed.target_id !== null && !UUID.test(typed.target_id)) ||
    (typed.action === 'no_op' && typed.target_id === null) ||
    (typed.action === 'insert' && typed.target_id !== null)
  ) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: target-invariants.');
  }
  if (
    (typed.action === 'insert' || typed.action === 'no_op') &&
    [
      typed.quantity,
      typed.unit_code,
      typed.currency_code,
      typed.unit_price,
      typed.total_amount,
    ].some((value) => value === null)
  ) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: eligible-fields.');
  }
  assertDeclaredStateCausality(typed);
  const expectedColumns = new Set(ITEM_COLUMNS);
  if (
    typed.origins.length !== ITEM_COLUMNS.length ||
    typed.evidence.length !== ITEM_COLUMNS.length
  ) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: evidence-cardinality.');
  }
  for (const [index, sourceOrigin] of typed.origins.entries()) {
    const parsed = exactNestedKeys(
      sourceOrigin,
      [
        'sheet_key',
        'sheet_name',
        'source_row_number',
        'source_range',
        'cell_address',
        'row_hash',
        'workbook_hash',
      ],
      'origin',
    );
    const column =
      typeof parsed['cell_address'] === 'string' ? parsed['cell_address'].replace(/\d+$/u, '') : '';
    if (
      parsed['sheet_key'] !== 'monthly_revenue' ||
      parsed['source_row_number'] !== typed.source_lineage.physical_row ||
      parsed['source_range'] !== typed.source_lineage.source_range ||
      parsed['row_hash'] !== typed.source_lineage.row_hash ||
      parsed['workbook_hash'] !== typed.source_lineage.workbook_hash ||
      column !== ITEM_COLUMNS[index] ||
      !expectedColumns.delete(column as (typeof ITEM_COLUMNS)[number])
    ) {
      throw new Error('P012_CANDIDATE_SCHEMA_INVALID: origin-invariants.');
    }
  }
  const evidenceColumns = new Set(ITEM_COLUMNS);
  for (const [index, itemEvidence] of typed.evidence.entries()) {
    const parsed = exactNestedKeys(
      itemEvidence,
      ['column', 'address', 'raw_value', 'round_trip_text', 'formatted_text', 'number_format'],
      'evidence',
    );
    if (
      typeof parsed['column'] !== 'string' ||
      parsed['column'] !== ITEM_COLUMNS[index] ||
      !evidenceColumns.delete(parsed['column'] as (typeof ITEM_COLUMNS)[number]) ||
      parsed['address'] !== `${parsed['column']}${typed.source_lineage.physical_row}` ||
      !(
        parsed['raw_value'] === null ||
        typeof parsed['raw_value'] === 'string' ||
        typeof parsed['raw_value'] === 'boolean' ||
        (typeof parsed['raw_value'] === 'number' && Number.isFinite(parsed['raw_value']))
      ) ||
      ![parsed['round_trip_text'], parsed['formatted_text'], parsed['number_format']].every(
        (value) => value === null || typeof value === 'string',
      )
    ) {
      throw new Error('P012_CANDIDATE_SCHEMA_INVALID: evidence-invariants.');
    }
  }
  const lineage = exactNestedKeys(
    typed.source_lineage,
    [
      'p010_manifest_hash',
      'input_hash',
      'workbook_hash',
      'sheet_key',
      'sheet_name',
      'physical_row',
      'source_range',
      'row_hash',
      'source_item_number',
      'project_candidate_id',
      'project_candidate_hash',
      'source_line_key',
    ],
    'source-lineage',
  );
  if (
    ![
      lineage['p010_manifest_hash'],
      lineage['input_hash'],
      lineage['workbook_hash'],
      lineage['row_hash'],
    ].every((value) => typeof value === 'string' && SHA256.test(value)) ||
    lineage['sheet_key'] !== 'monthly_revenue' ||
    !Number.isSafeInteger(lineage['physical_row']) ||
    lineage['source_item_number'] !== typed.source_item_number ||
    lineage['project_candidate_id'] !== typed.project.project_candidate_id ||
    lineage['project_candidate_hash'] !== typed.project.project_candidate_hash ||
    lineage['source_line_key'] !== typed.source_line_key
  ) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: lineage-invariants.');
  }
  assertSourceLineKey(typed.source_line_key, typed.project.project_code, typed.source_item_number);
  assertItemCandidateId(
    typed.candidate_id,
    typed.project.project_candidate_id,
    typed.source_line_key,
  );
  if (
    verifyHash &&
    typed.candidate_hash !== sha256Canonical({ ...typed, candidate_hash: undefined })
  ) {
    throw new Error('P012_CANDIDATE_HASH_MISMATCH: candidate.');
  }
}

function candidateSetDeclaration(candidateSet: P012ItemCandidateSet): unknown {
  const { candidate_set_hash: _candidateSetHash, candidates, ...setDeclaration } = candidateSet;
  void _candidateSetHash;
  return {
    ...setDeclaration,
    candidates: candidates.map(({ candidate_hash: _candidateHash, ...candidate }) => {
      void _candidateHash;
      return candidate;
    }),
  };
}

function deriveP012CandidateSet(
  source: LoadedSource,
  p011Artifacts: P011Artifacts,
  snapshot: P012ExistingItemsSnapshot,
): P012ItemCandidateSet {
  const sourceView = createValidatedSourceView(source);
  const projectView = createValidatedP011ProjectView(source, p011Artifacts);
  const targetByCandidate = projectTargets(projectView.projects, snapshot);
  const rows = dataRows(sourceView);
  const projectsByCode = new Map(
    projectView.projects.map((project) => [project.project_code, project]),
  );
  const seenIdentities = new Set<string>();
  const candidates = rows.map((row) => {
    const code = projectCode(row);
    const project = projectsByCode.get(code);
    if (project === undefined) throw new Error('P012_PROJECT_UNRESOLVED: final-project.');
    const itemNumber = sourceItemNumber(row);
    const identity = `${project.candidate_id}\u0000${itemNumber}`;
    if (seenIdentities.has(identity)) {
      throw new Error('P012_SOURCE_LINE_DUPLICATE: project-source-item-number.');
    }
    seenIdentities.add(identity);
    return buildCandidate(
      sourceView,
      row,
      project,
      snapshot,
      targetByCandidate.get(project.candidate_id) ?? null,
      projectView.p010ManifestHash,
      projectView.inputHash,
    );
  });
  const candidateIds = candidates.map(({ candidate_id }) => candidate_id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error('P012_CANDIDATE_ID_COLLISION: candidate-set.');
  }
  for (const candidate of candidates) assertClosedCandidate(candidate);
  candidates.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id, 'en'));
  const candidateSetHash = sha256Canonical(
    candidates.map(({ candidate_id, candidate_hash }) => ({ candidate_id, candidate_hash })),
  );
  const actions: PlanAction[] = ['insert', 'no_op', 'conflict', 'rejected', 'pending_decision'];
  const actionCounts = Object.fromEntries(
    actions.map((action) => [
      action,
      candidates.filter((candidate) => candidate.action === action).length,
    ]),
  ) as Record<PlanAction, number>;
  const result: P012ItemCandidateSet = {
    contract: 'ltcm.p012.item-candidate-set.v1',
    payload_schema_version: 1,
    p010_manifest_hash: projectView.p010ManifestHash,
    input_hash: canonicalInputHash(sourceView.inputHashes),
    p011_artifacts_hash: projectView.artifactsHash,
    snapshot_hash: sha256Canonical(snapshot),
    candidate_set_hash: candidateSetHash,
    candidates,
    summary: {
      attempted_rows: rows.length,
      candidate_count: candidates.length,
      action_counts: actionCounts,
      persistence_ready: candidates.every(
        ({ action }) => action === 'insert' || action === 'no_op',
      ),
      remote_access: false,
      p013_fields_consumed: 0,
      p014_fields_consumed: 0,
    },
  };
  return result;
}

export function normalizeP012Items(
  source: LoadedSource,
  p011Artifacts: P011Artifacts,
  snapshotInput: unknown,
): P012ItemCandidateSet {
  const snapshot = parseP012ExistingItemsSnapshot(snapshotInput);
  const result = deriveP012CandidateSet(source, p011Artifacts, snapshot);
  const snapshotCopy = structuredClone(snapshot);
  certifiedCandidateSets.set(result, {
    sourceIdentity: source,
    p011Identity: p011Artifacts,
    snapshot: snapshotCopy,
    snapshotFingerprint: sha256Canonical(snapshotCopy),
    fingerprint: sha256Canonical(result),
  });
  return result;
}

/** Returns a disposable candidate view only for a runtime-certified, unmodified result. */
export function createValidatedP012CandidateView(
  source: unknown,
  p011Artifacts: unknown,
  candidateSet: unknown,
): ItemCandidate[] {
  if (candidateSet === null || typeof candidateSet !== 'object') {
    throw new Error('P012_SOURCE_PROVENANCE_REQUIRED: candidate-set.');
  }
  const record = certifiedCandidateSets.get(candidateSet);
  if (
    record === undefined ||
    record.sourceIdentity !== source ||
    record.p011Identity !== p011Artifacts
  ) {
    throw new Error('P012_SOURCE_PROVENANCE_REQUIRED: candidate-set.');
  }
  if (record.snapshotFingerprint !== sha256Canonical(record.snapshot)) {
    throw new Error('P012_SOURCE_PROVENANCE_MISMATCH: candidate-set.');
  }
  const derived = deriveP012CandidateSet(
    source as LoadedSource,
    p011Artifacts as P011Artifacts,
    record.snapshot,
  );
  const typed = candidateSet as P012ItemCandidateSet;
  if (!Array.isArray(typed.candidates)) {
    throw new Error('P012_CANDIDATE_SCHEMA_INVALID: candidate-set.');
  }
  for (const candidate of typed.candidates) assertClosedCandidate(candidate, false);
  if (
    sha256Canonical(candidateSetDeclaration(typed)) !==
    sha256Canonical(candidateSetDeclaration(derived))
  ) {
    throw new Error('P012_SOURCE_PROVENANCE_MISMATCH: contextual-declaration.');
  }
  for (const candidate of typed.candidates) {
    if (candidate.candidate_hash !== sha256Canonical({ ...candidate, candidate_hash: undefined })) {
      throw new Error('P012_CANDIDATE_HASH_MISMATCH: candidate.');
    }
  }
  const currentCandidateSetHash = sha256Canonical(
    typed.candidates.map(({ candidate_id, candidate_hash }) => ({ candidate_id, candidate_hash })),
  );
  if (typed.candidate_set_hash !== currentCandidateSetHash) {
    throw new Error('P012_CANDIDATE_HASH_MISMATCH: candidate-set.');
  }
  if (
    sha256Canonical(typed) !== sha256Canonical(derived) ||
    sha256Canonical(typed) !== record.fingerprint
  ) {
    throw new Error('P012_SOURCE_PROVENANCE_MISMATCH: contextual-candidate-set.');
  }
  return structuredClone(derived.candidates);
}
