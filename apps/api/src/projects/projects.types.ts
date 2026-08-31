import { BadRequestException } from '@nestjs/common';

export const P023_PROJECT_PORTFOLIO_CONTRACT = 'ltcm.p023.project-portfolio-list.v1' as const;

export const PROJECT_STATUSES = ['draft', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_SORT_FIELDS = [
  'code',
  'client',
  'status',
  'contractValue',
  'unscheduledBalance',
  'updatedAt',
] as const;
export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];
export type SortOrder = 'asc' | 'desc';

export const UNSCHEDULED_BALANCE_STATUSES = [
  'available',
  'missing_contract',
  'no_official_plan',
  'ambiguous_official_plan',
  'insufficient_actual_data',
  'data_quality_issue',
] as const;
export type UnscheduledBalanceStatus = (typeof UNSCHEDULED_BALANCE_STATUSES)[number];

export interface ProjectPortfolioQuery {
  readonly search?: string;
  readonly status?: ProjectStatus;
  readonly sort: ProjectSortField;
  readonly order: SortOrder;
  readonly page: number;
  readonly pageSize: number;
}

export interface ProjectPortfolioItem {
  readonly projectId: string;
  readonly code: string;
  readonly clientName: string;
  readonly status: ProjectStatus;
  readonly currencyCode: string;
  readonly contractValue: string | null;
  readonly unscheduledBalance: string | null;
  readonly unscheduledBalanceStatus: UnscheduledBalanceStatus;
  readonly updatedAt: string;
  readonly alertCount: number;
  readonly alertsSummary?: string;
}

export interface ProjectPortfolioResponse {
  readonly contract: typeof P023_PROJECT_PORTFOLIO_CONTRACT;
  readonly items: readonly ProjectPortfolioItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface ProjectDetail {
  readonly contract: typeof P023_PROJECT_PORTFOLIO_CONTRACT;
  readonly projectId: string;
  readonly code: string;
  readonly name: string;
  readonly clientName: string;
  readonly status: ProjectStatus;
  readonly currencyCode: string;
  readonly contractValue: string | null;
  readonly updatedAt: string;
}

function invalidQuery(message: string): never {
  throw new BadRequestException(`P023_INVALID_QUERY_${message}`);
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

export function parseProjectPortfolioQuery(
  input: Readonly<Record<string, unknown>>,
): ProjectPortfolioQuery {
  const allowed = new Set(['search', 'status', 'sort', 'order', 'page', 'pageSize']);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) invalidQuery(`UNKNOWN_PARAMETER_${unknown.toUpperCase()}`);

  const searchValue = singleValue(input['search'], 'search')?.trim();
  if (searchValue && searchValue.length > 120) invalidQuery('SEARCH_TOO_LONG');

  const statusValue = singleValue(input['status'], 'status');
  if (statusValue && !(PROJECT_STATUSES as readonly string[]).includes(statusValue)) {
    invalidQuery('STATUS_INVALID');
  }

  const sortValue = singleValue(input['sort'], 'sort') ?? 'code';
  if (!(PROJECT_SORT_FIELDS as readonly string[]).includes(sortValue)) {
    invalidQuery('SORT_INVALID');
  }

  const orderValue = singleValue(input['order'], 'order') ?? 'asc';
  if (orderValue !== 'asc' && orderValue !== 'desc') invalidQuery('ORDER_INVALID');

  const pageSize = positiveInteger(singleValue(input['pageSize'], 'pageSize'), 'pageSize', 25);
  if (pageSize > 100) invalidQuery('PAGESIZE_INVALID');
  const page = positiveInteger(singleValue(input['page'], 'page'), 'page', 1);
  if (!Number.isSafeInteger((page - 1) * pageSize)) invalidQuery('PAGE_OFFSET_INVALID');

  const query: ProjectPortfolioQuery = {
    ...(searchValue ? { search: searchValue } : {}),
    ...(statusValue ? { status: statusValue as ProjectStatus } : {}),
    sort: sortValue as ProjectSortField,
    order: orderValue as 'asc' | 'desc',
    page,
    pageSize,
  };
  return query;
}

export function parseProjectId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    invalidQuery('PROJECT_ID_INVALID');
  }
  return value;
}
