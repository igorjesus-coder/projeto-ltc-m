import { BadRequestException } from '@nestjs/common';

export const P029_MONTHLY_PLANNING_CONTRACT = 'ltcm.p029.monthly-planning-editor.v1' as const;
export const P029_PLANNED_METRIC = 'billing_planned' as const;

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
  readonly editable: boolean;
  readonly isBaseline: boolean;
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

export interface PlanningEditorResponse {
  readonly contract: typeof P029_MONTHLY_PLANNING_CONTRACT;
  readonly project: PlanningProjectOption;
  readonly version: PlanningVersionOption;
  readonly competences: readonly PlanningCompetence[];
  readonly items: readonly PlanningItem[];
  readonly entries: readonly PlanningEntry[];
  readonly projectTotals: readonly PlanningMonthlyTotal[];
  readonly range: { readonly from: string | null; readonly to: string | null };
}

export interface PlanningMonthEntryPayload {
  readonly itemId: string;
  readonly competence: string;
  readonly amount: string;
}

export interface PlanningBatchPayload {
  readonly expectedVersion: number;
  readonly justification?: string | null;
  readonly entries: readonly PlanningMonthEntryPayload[];
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

function month(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-01$/u.test(value)) invalid(code);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) invalid(code);
  return value;
}

function amount(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/u.test(value)) {
    invalid('P029_INVALID_AMOUNT');
  }
  const [integer, fraction = ''] = value.split('.');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

function optionalJustification(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) {
    invalid('P029_INVALID_JUSTIFICATION');
  }
  return value.trim();
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
  return { versionId: parsedVersionId, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function parsePlanningBatchPayload(value: unknown): PlanningBatchPayload {
  const body = object(value);
  keys(body, new Set(['expectedVersion', 'justification', 'entries']));
  if (!Array.isArray(body['entries']) || body['entries'].length === 0) {
    invalid('P029_BATCH_EMPTY');
  }
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
  const parsedJustification = optionalJustification(body['justification']);
  return {
    expectedVersion: positiveVersion(body['expectedVersion']),
    ...(parsedJustification === undefined ? {} : { justification: parsedJustification }),
    entries,
  };
}
