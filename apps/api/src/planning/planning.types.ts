import { BadRequestException } from '@nestjs/common';

export const P029_MONTHLY_PLANNING_CONTRACT = 'ltcm.p029.monthly-planning-editor.v1' as const;
export const P029_PLANNED_METRIC = 'billing_planned' as const;
export const P029_MAX_BATCH_ENTRIES = 5_000 as const;
export const P029_MAX_RANGE_MONTHS = 240 as const;
export const P030_FINANCIAL_CONTRACT = 'ltcm.p030.balance-distribution-validations.v1' as const;
export const P031_WORKFLOW_CONTRACT = 'ltcm.p031.version-approval-locking.v1' as const;

export interface PlanningProjectOption {
  readonly projectId: string;
  readonly code: string;
  readonly name: string;
  readonly currencyCode: string;
  readonly status: string;
}

export interface PlanningProjectsResponse {
  readonly contract: typeof P029_MONTHLY_PLANNING_CONTRACT;
  readonly projects: readonly PlanningProjectOption[];
}

export interface PlanningVersionOption {
  readonly versionId: string;
  readonly name: string;
  readonly status: string;
  readonly rowVersion: number;
  readonly contentRevision: number;
  readonly editable: boolean;
  readonly isBaseline: boolean;
  readonly approvedAt: string | null;
  readonly sourcePlanVersionId: string | null;
  readonly baselinePlanVersionId: string | null;
}

export interface PlanningVersionsResponse {
  readonly contract: typeof P029_MONTHLY_PLANNING_CONTRACT;
  readonly projectId: string;
  readonly versions: readonly PlanningVersionOption[];
}

export interface PlanningCompetence {
  readonly value: string;
  readonly label: string;
}

export interface PlanningItem {
  readonly itemId: string;
  readonly sourceLineKey: string;
  readonly itemCode: string | null;
  readonly description: string | null;
  readonly lineNumber: number;
  readonly active: boolean;
}

export interface PlanningEntry {
  readonly itemId: string;
  readonly competence: string;
  readonly amount: string;
  readonly rowVersion: number;
}

export interface PlanningMonthlyTotal {
  readonly competence: string;
  readonly amount: string;
}

export interface PlanningFinancialSummary {
  readonly contractValue: string;
  readonly actualPosted: string;
  readonly plannedDraft: string;
  readonly rawBalance: string;
  readonly distributableBalance: string;
  readonly unplannedBalance: string;
  readonly hasExcess: boolean;
  readonly currency: string;
  readonly canOverrideBalance: boolean;
}

export interface PlanningEditorResponse {
  readonly contract: typeof P029_MONTHLY_PLANNING_CONTRACT;
  readonly project: PlanningProjectOption;
  readonly version: PlanningVersionOption;
  readonly competences: readonly PlanningCompetence[];
  readonly items: readonly PlanningItem[];
  readonly entries: readonly PlanningEntry[];
  readonly projectTotals: readonly PlanningMonthlyTotal[];
  readonly financial: PlanningFinancialSummary;
  readonly range: { readonly from: string | null; readonly to: string | null };
}

export interface PlanningMonthEntryPayload {
  readonly itemId: string;
  readonly competence: string;
  readonly amount: string;
}

export interface PlanningBatchPayload {
  readonly expectedVersion: number;
  readonly justification: string;
  readonly entries: readonly PlanningMonthEntryPayload[];
}

export type PlanningWorkflowAction =
  'submit' | 'return' | 'approve' | 'lock' | 'archive' | 'reopen';

export interface PlanningWorkflowPayload {
  readonly expectedRowVersion: number;
  readonly justification?: string;
  readonly newName?: string;
}

export type PlanningMonthQuery = Readonly<{
  readonly versionId: string;
  readonly from?: string;
  readonly to?: string;
}>;

function invalid(code: string): never {
  throw new BadRequestException(code);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('P029_INVALID_PAYLOAD');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) invalid('P029_UNKNOWN_FIELD');
}

function uuid(value: unknown, code: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    invalid(code);
  }
  return value;
}

function positiveVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid('P029_EXPECTED_VERSION_INVALID');
  }
  return value;
}

function expectedRowVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid('P031_EXPECTED_ROW_VERSION_INVALID');
  }
  return value;
}

function month(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-01$/u.test(value)) invalid(code);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) invalid(code);
  return value;
}

function rangeMonths(from: string, to: string): number {
  return (
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(to.slice(5, 7)) -
    Number(from.slice(5, 7)) +
    1
  );
}

function amount(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/u.test(value)) {
    invalid('P029_INVALID_AMOUNT');
  }
  const [integer, fraction = ''] = value.split('.');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

function justification(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) {
    invalid('P029_JUSTIFICATION_REQUIRED');
  }
  return value.trim();
}

function optionalJustification(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return justification(value);
}

export function parsePlanningProjectId(value: string): string {
  return uuid(value, 'P029_PROJECT_ID_INVALID');
}

export function parsePlanningVersionId(value: string): string {
  return uuid(value, 'P029_VERSION_ID_INVALID');
}

export function parsePlanningMonthQuery(
  versionId: string,
  query: Readonly<Record<string, unknown>>,
): PlanningMonthQuery {
  const allowed = new Set(['versionId', 'from', 'to']);
  keys(query, allowed);
  const parsedVersionId = parsePlanningVersionId(versionId);
  const from = query['from'] === undefined ? undefined : month(query['from'], 'P029_INVALID_RANGE');
  const to = query['to'] === undefined ? undefined : month(query['to'], 'P029_INVALID_RANGE');
  if (from && to && from > to) invalid('P029_INVALID_RANGE');
  if (from && to && rangeMonths(from, to) > P029_MAX_RANGE_MONTHS) invalid('P029_RANGE_TOO_LARGE');
  return { versionId: parsedVersionId, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function parsePlanningBatchPayload(value: unknown): PlanningBatchPayload {
  const body = object(value);
  keys(body, new Set(['expectedVersion', 'justification', 'entries']));
  if (!Array.isArray(body['entries']) || body['entries'].length === 0) {
    invalid('P029_BATCH_EMPTY');
  }
  if (body['entries'].length > P029_MAX_BATCH_ENTRIES) invalid('P029_BATCH_TOO_LARGE');
  const seen = new Set<string>();
  const entries = body['entries'].map((entry, index) => {
    const item = object(entry);
    keys(item, new Set(['itemId', 'competence', 'amount']));
    const parsed = {
      itemId: uuid(item['itemId'], `P029_ITEM_ID_INVALID_${index}`),
      competence: month(item['competence'], `P029_INVALID_COMPETENCE_${index}`),
      amount: amount(item['amount']),
    };
    const identity = `${parsed.itemId}\u0000${parsed.competence}`;
    if (seen.has(identity)) invalid('P029_DUPLICATE_ENTRY');
    seen.add(identity);
    return parsed;
  });
  return {
    expectedVersion: positiveVersion(body['expectedVersion']),
    justification: justification(body['justification']),
    entries,
  };
}

export function parsePlanningWorkflowPayload(
  value: unknown,
  action: PlanningWorkflowAction,
): PlanningWorkflowPayload {
  const body = object(value);
  const required =
    action === 'return' || action === 'lock' || action === 'archive' || action === 'reopen';
  const allowsJustification = required || action === 'approve';
  const allowed = new Set([
    'expectedRowVersion',
    ...(allowsJustification ? ['justification'] : []),
    ...(action === 'reopen' ? ['newName'] : []),
  ]);
  keys(body, allowed);
  const parsed: PlanningWorkflowPayload = {
    expectedRowVersion: expectedRowVersion(body['expectedRowVersion']),
  };
  if (action === 'reopen') {
    const name = body['newName'];
    if (typeof name !== 'string' || !name.trim() || name.length > 200)
      invalid('P031_NEW_NAME_INVALID');
    if (body['justification'] === undefined) invalid('P031_JUSTIFICATION_REQUIRED');
    return {
      ...parsed,
      justification: justification(body['justification']),
      newName: name.trim(),
    };
  }
  if (allowsJustification && body['justification'] !== undefined) {
    const parsedJustification = optionalJustification(body['justification']);
    if (parsedJustification !== undefined) return { ...parsed, justification: parsedJustification };
  }
  if (required) invalid('P031_JUSTIFICATION_REQUIRED');
  return parsed;
}
