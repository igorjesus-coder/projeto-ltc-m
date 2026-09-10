import { BadRequestException } from '@nestjs/common';

export const P034_DATA_QUALITY_CONTRACT = 'ltcm.p034.data-quality-center.v3' as const;

export const QUALITY_SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'BLOCKING'] as const;
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number];

export const QUALITY_RULES = [
  'PROJECT_VALUE_MISMATCH',
  'UNPLANNED_BALANCE',
  'MISSING_REQUIRED_FIELD',
  'PROJECT_DATA_STALE',
  'DUPLICATE_PROJECT_SOURCE_IDENTITY',
  'DUPLICATE_ITEM_SOURCE_IDENTITY',
  'GRAIN_MISMATCH',
] as const;
export type QualityRuleCode = (typeof QUALITY_RULES)[number];

export const QUALITY_ORIGINS = [
  'project',
  'project_item',
  'plan_version',
  'actual_event',
  'import',
] as const;
export type QualityOriginEntity = (typeof QUALITY_ORIGINS)[number];

export const QUALITY_SORT_FIELDS = ['severity', 'project', 'rule', 'origin', 'id'] as const;
export type QualitySortField = (typeof QUALITY_SORT_FIELDS)[number];
export type QualitySortOrder = 'asc' | 'desc';

export interface QualityQuery {
  readonly projectId?: string;
  readonly rule?: QualityRuleCode;
  readonly severity?: QualitySeverity;
  readonly origin?: QualityOriginEntity;
  readonly search?: string;
  readonly sort: QualitySortField;
  readonly order: QualitySortOrder;
  readonly page: number;
  readonly pageSize: number;
}

export interface QualityReference {
  readonly kind: 'source' | 'database';
  readonly locator: string;
  readonly fingerprint: string;
}

export interface QualityNavigationAction {
  readonly target: 'project' | 'project_item' | 'planning' | 'realized_event' | 'master_data';
  readonly projectId?: string;
  readonly entityId?: string;
  readonly entityCode?: string;
}

export interface QualityFinding {
  readonly id: string;
  readonly project: { readonly id: string; readonly code?: string; readonly name?: string };
  readonly rule: { readonly code: QualityRuleCode; readonly label: string };
  readonly severity: QualitySeverity;
  readonly expectedValue?: string | null;
  readonly observedValue?: string | null;
  readonly delta?: string | null;
  readonly currencyCode?: string | null;
  readonly origin: {
    readonly findingOrigin?: string | null;
    readonly entity: QualityOriginEntity;
    readonly sourceReferences?: readonly QualityReference[];
    readonly databaseReferences?: readonly QualityReference[];
  };
  readonly evidence?: Readonly<Record<string, unknown>>;
  readonly explanation?: string;
  readonly remediation?: string;
  readonly navigationAction?: QualityNavigationAction;
}

export interface QualityResponse {
  readonly contract: typeof P034_DATA_QUALITY_CONTRACT;
  readonly items: readonly QualityFinding[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function invalidQuery(code: string): never {
  throw new BadRequestException(`P034_INVALID_QUERY_${code}`);
}

function singleValue(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalidQuery(`${name.toUpperCase()}_TYPE`);
  return value;
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9][0-9]*$/u.test(value)) invalidQuery(`${name.toUpperCase()}_INVALID`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalidQuery(`${name.toUpperCase()}_INVALID`);
  return parsed;
}

export function parseQualityQuery(input: Readonly<Record<string, unknown>>): QualityQuery {
  const allowed = new Set([
    'projectId',
    'rule',
    'severity',
    'origin',
    'search',
    'sort',
    'order',
    'page',
    'pageSize',
  ]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) invalidQuery(`UNKNOWN_PARAMETER_${unknown.toUpperCase()}`);

  const projectId = singleValue(input['projectId'], 'projectId');
  if (projectId && !UUID_PATTERN.test(projectId)) invalidQuery('PROJECT_ID_INVALID');
  const rule = singleValue(input['rule'], 'rule');
  if (rule && !(QUALITY_RULES as readonly string[]).includes(rule)) invalidQuery('RULE_INVALID');
  const severity = singleValue(input['severity'], 'severity');
  if (severity && !(QUALITY_SEVERITIES as readonly string[]).includes(severity)) {
    invalidQuery('SEVERITY_INVALID');
  }
  const origin = singleValue(input['origin'], 'origin');
  if (origin && !(QUALITY_ORIGINS as readonly string[]).includes(origin)) {
    invalidQuery('ORIGIN_INVALID');
  }
  const search = singleValue(input['search'], 'search')?.trim();
  if (search && search.length > 120) invalidQuery('SEARCH_TOO_LONG');
  const sort = singleValue(input['sort'], 'sort') ?? 'project';
  if (!(QUALITY_SORT_FIELDS as readonly string[]).includes(sort)) invalidQuery('SORT_INVALID');
  const order = singleValue(input['order'], 'order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') invalidQuery('ORDER_INVALID');
  const pageSize = positiveInteger(singleValue(input['pageSize'], 'pageSize'), 'pageSize', 25);
  if (pageSize > 100) invalidQuery('PAGESIZE_INVALID');
  const page = positiveInteger(singleValue(input['page'], 'page'), 'page', 1);
  if (!Number.isSafeInteger((page - 1) * pageSize)) invalidQuery('PAGE_OFFSET_INVALID');

  return {
    ...(projectId ? { projectId } : {}),
    ...(rule ? { rule: rule as QualityRuleCode } : {}),
    ...(severity ? { severity: severity as QualitySeverity } : {}),
    ...(origin ? { origin: origin as QualityOriginEntity } : {}),
    ...(search ? { search } : {}),
    sort: sort as QualitySortField,
    order: order as QualitySortOrder,
    page,
    pageSize,
  };
}
