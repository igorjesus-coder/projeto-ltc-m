import { sha256Canonical } from './canonical-json.js';

export const P013_MONTHLY_BASELINE_SEMANTIC_CONTRACT =
  'ltcm.p013.monthly-baseline-semantic.v1' as const;
export const P013_MONTHLY_MONEY_CONTRACT = 'ltcm.p013.money.v1' as const;
export const P013_MONTHLY_PROVENANCE_CONTRACT = 'ltcm.p013.monthly-provenance.v1' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MONTH_START = /^\d{4}-(?:0[1-9]|1[0-2])-01$/u;
const SOURCE_LINE_KEY = /^p012-item-v1:[0-9a-f]{64}$/u;
const DECIMAL = /^([+-]?)(0|[1-9]\d*)(?:\.(\d{1,14}))?$/u;
const MAX_INTEGER_DIGITS = 18;

export type P013MonthlyDeclarationState = 'blank' | 'explicit_zero' | 'value';

export interface P013MonthlyCellInput {
  project_item_id: string;
  source_line_key: string;
  competence_month: string;
  declaration_state: P013MonthlyDeclarationState;
  raw_decimal: string | null;
}

export interface P013CanonicalMonthlyCell {
  project_item_id: string;
  competence_month: string;
  declaration_state: P013MonthlyDeclarationState;
  canonical_amount: string | null;
}

export interface P013MonthlyBaselineSemanticIdentity {
  contract: typeof P013_MONTHLY_BASELINE_SEMANTIC_CONTRACT;
  metric_type: 'billing_planned';
  planning_level: 'item';
  cells: P013CanonicalMonthlyCell[];
  semantic_fingerprint: string;
}

export interface P013SourceArtifactIdentity {
  contract: 'ltcm.p013.source-artifact.v1';
  source_sha256: string;
  source_semantic_fingerprint: string;
  source_size_bytes: number;
  source_mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  source_name: string;
  worksheet_key: 'monthly_revenue';
  worksheet_name: 'Prev. Receita Mensal';
  structural_range: 'A1:T52';
}

export interface P013ImportExecution {
  contract: 'ltcm.p013.import-execution.v1';
  id: string;
  import_batch_id: string;
  source_artifact_id: string;
  source_sha256: string;
  baseline_id: string;
  baseline_semantic_fingerprint: string;
  plan_version_id: string;
  idempotency_key: string;
}

export interface P013MonthlyCellProvenance {
  contract: typeof P013_MONTHLY_PROVENANCE_CONTRACT;
  baseline_id: string;
  import_batch_id: string;
  import_batch_sheet_id: string;
  import_staging_row_id: string;
  project_item_id: string;
  source_line_key: string;
  source_item_number: string;
  source_row_number: number;
  source_column: 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S';
  source_cell_reference: string;
  competence_month: string;
  declaration_state: P013MonthlyDeclarationState;
  source_numeric_text: string | null;
  source_value_hash: string | null;
  canonical_amount: string | null;
  financial_plan_line_id: string | null;
}

export interface P013MonthlyBaselineReceipt {
  contract: 'ltcm.p013.monthly-baseline-receipt.v1';
  import_batch_id: string;
  baseline_id: string;
  plan_version_id: string;
  semantic_fingerprint: string;
  idempotency_key: string;
  status: 'loaded';
}

function fail(reason: string): never {
  throw new Error(`P013_MONTHLY_CONTRACT_INVALID: ${reason}.`);
}

function incrementFixedDecimal(integer: string): string {
  return (BigInt(integer) + 1n).toString();
}

export function canonicalizeP013MonthlyMoney(rawDecimal: string): string {
  const matched = DECIMAL.exec(rawDecimal);
  if (matched === null) fail('decimal');
  const sign = matched[1] ?? '';
  let integer = matched[2] ?? '0';
  const fraction = matched[3] ?? '';
  if (sign !== '' && (integer !== '0' || /[1-9]/u.test(fraction))) fail('negative-or-signed');
  let cents = fraction.padEnd(2, '0').slice(0, 2);
  const discarded = fraction.slice(2);
  if (discarded !== '' && discarded[0]! >= '5') {
    const rounded = BigInt(cents) + 1n;
    if (rounded === 100n) {
      integer = incrementFixedDecimal(integer);
      cents = '00';
    } else {
      cents = rounded.toString().padStart(2, '0');
    }
  }
  if (integer.length > MAX_INTEGER_DIGITS) fail('overflow');
  return `${integer}.${cents}`;
}

function canonicalCell(cell: P013MonthlyCellInput): P013CanonicalMonthlyCell {
  if (!UUID.test(cell.project_item_id)) fail('project-item-id');
  if (!SOURCE_LINE_KEY.test(cell.source_line_key)) fail('source-line-key');
  if (!MONTH_START.test(cell.competence_month)) fail('competence-month');
  switch (cell.declaration_state) {
    case 'blank':
      if (cell.raw_decimal !== null) fail('blank-has-value');
      return {
        project_item_id: cell.project_item_id,
        competence_month: cell.competence_month,
        declaration_state: 'blank',
        canonical_amount: null,
      };
    case 'explicit_zero': {
      if (cell.raw_decimal === null) fail('declaration-without-value');
      const canonicalAmount = canonicalizeP013MonthlyMoney(cell.raw_decimal);
      if (canonicalAmount !== '0.00') fail('explicit-zero-nonzero');
      return {
        project_item_id: cell.project_item_id,
        competence_month: cell.competence_month,
        declaration_state: 'explicit_zero',
        canonical_amount: canonicalAmount,
      };
    }
    case 'value': {
      if (cell.raw_decimal === null) fail('declaration-without-value');
      const canonicalAmount = canonicalizeP013MonthlyMoney(cell.raw_decimal);
      if (canonicalAmount === '0.00') fail('value-is-zero');
      return {
        project_item_id: cell.project_item_id,
        competence_month: cell.competence_month,
        declaration_state: 'value',
        canonical_amount: canonicalAmount,
      };
    }
    default:
      fail('declaration-state');
  }
}

export function createP013MonthlyBaselineSemanticIdentity(
  inputCells: readonly P013MonthlyCellInput[],
): P013MonthlyBaselineSemanticIdentity {
  const cells = inputCells.map(canonicalCell).sort((left, right) => {
    const item = left.project_item_id.localeCompare(right.project_item_id, 'en');
    return item === 0 ? left.competence_month.localeCompare(right.competence_month, 'en') : item;
  });
  const keys = cells.map((cell) => `${cell.project_item_id}\u0000${cell.competence_month}`);
  if (new Set(keys).size !== keys.length) fail('duplicate-item-month');
  const semantic = {
    contract: P013_MONTHLY_BASELINE_SEMANTIC_CONTRACT,
    metric_type: 'billing_planned' as const,
    planning_level: 'item' as const,
    cells,
  };
  return Object.freeze({
    ...semantic,
    cells: Object.freeze(
      cells.map((cell) => Object.freeze({ ...cell })),
    ) as P013CanonicalMonthlyCell[],
    semantic_fingerprint: sha256Canonical(semantic),
  });
}

export function createP013MonthlyBaselineIdempotencyKey(
  planVersionId: string,
  semanticFingerprint: string,
): string {
  if (!UUID.test(planVersionId) || !SHA256.test(semanticFingerprint)) {
    fail('idempotency-input');
  }
  return `p013-baseline-v1:${sha256Canonical({
    contract: 'ltcm.p013.monthly-baseline-idempotency.v1',
    metric_type: 'billing_planned',
    plan_version_id: planVersionId,
    planning_level: 'item',
    semantic_fingerprint: semanticFingerprint,
  })}`;
}
