import type { ProjectStatus } from './project-portfolio.types';

export const PROJECT_STATUSES = ['draft', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export type PortfolioStatus = (typeof PROJECT_STATUSES)[number];

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

export interface PortfolioQuery {
  readonly search?: string;
  readonly status?: PortfolioStatus;
  readonly sort: ProjectSortField;
  readonly order: SortOrder;
  readonly page: number;
  readonly pageSize: number;
}

export interface ProjectPortfolioItem {
  readonly projectId: string;
  readonly code: string;
  readonly clientName: string;
  readonly status: PortfolioStatus;
  readonly currencyCode: string;
  readonly contractValue: string | null;
  readonly unscheduledBalance: string | null;
  readonly unscheduledBalanceStatus: UnscheduledBalanceStatus;
  readonly updatedAt: string;
  readonly alertCount: number;
  readonly alertsSummary?: string;
}

export interface ProjectPortfolioResponse {
  readonly contract: 'ltcm.p023.project-portfolio-list.v1';
  readonly items: readonly ProjectPortfolioItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface ProjectDetail {
  readonly contract: 'ltcm.p023.project-portfolio-list.v1';
  readonly projectId: string;
  readonly code: string;
  readonly name: string;
  readonly clientName: string;
  readonly status: PortfolioStatus;
  readonly currencyCode: string;
  readonly contractValue: string | null;
  readonly updatedAt: string;
}

const CONTRACT = 'ltcm.p023.project-portfolio-list.v1' as const;

export const DEFAULT_PORTFOLIO_QUERY: PortfolioQuery = Object.freeze({
  sort: 'code',
  order: 'asc',
  page: 1,
  pageSize: 25,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^-?[0-9]+(?:\.[0-9]+)?$/u.test(value);
}

function isStatus(value: unknown): value is PortfolioStatus {
  return typeof value === 'string' && (PROJECT_STATUSES as readonly string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isUnscheduledBalanceStatus(value: unknown): value is UnscheduledBalanceStatus {
  return (
    typeof value === 'string' && (UNSCHEDULED_BALANCE_STATUSES as readonly string[]).includes(value)
  );
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('P023_RESPONSE_INVALID');
  return value;
}

function nullableDecimal(value: unknown): string | null {
  if (value === null) return null;
  if (!isDecimal(value)) throw new Error('P023_RESPONSE_INVALID');
  return value;
}

function parseItem(value: unknown): ProjectPortfolioItem {
  if (!isRecord(value)) throw new Error('P023_RESPONSE_INVALID');
  const status = value['status'];
  const alertCount = value['alertCount'];
  const balanceStatus = value['unscheduledBalanceStatus'];
  if (
    !isStatus(status) ||
    typeof alertCount !== 'number' ||
    !Number.isSafeInteger(alertCount) ||
    alertCount < 0 ||
    !isUnscheduledBalanceStatus(balanceStatus)
  ) {
    throw new Error('P023_RESPONSE_INVALID');
  }
  const alertsSummary = value['alertsSummary'];
  if (alertsSummary !== undefined && typeof alertsSummary !== 'string') {
    throw new Error('P023_RESPONSE_INVALID');
  }
  return {
    projectId: requiredString(value['projectId']),
    code: requiredString(value['code']),
    clientName: requiredString(value['clientName']),
    status,
    currencyCode: requiredString(value['currencyCode']),
    contractValue: nullableDecimal(value['contractValue']),
    unscheduledBalance: nullableDecimal(value['unscheduledBalance']),
    unscheduledBalanceStatus: balanceStatus,
    updatedAt: requiredString(value['updatedAt']),
    alertCount,
    ...(alertsSummary ? { alertsSummary } : {}),
  };
}

export function parsePortfolioResponse(value: unknown): ProjectPortfolioResponse {
  if (!isRecord(value) || value['contract'] !== CONTRACT || !Array.isArray(value['items'])) {
    throw new Error('P023_RESPONSE_INVALID');
  }
  const page = value['page'];
  const pageSize = value['pageSize'];
  const totalItems = value['totalItems'];
  const totalPages = value['totalPages'];
  if (
    !isNonNegativeInteger(page) ||
    !isNonNegativeInteger(pageSize) ||
    !isNonNegativeInteger(totalItems) ||
    !isNonNegativeInteger(totalPages) ||
    page === 0 ||
    pageSize === 0
  ) {
    throw new Error('P023_RESPONSE_INVALID');
  }
  return {
    contract: CONTRACT,
    items: value['items'].map(parseItem),
    page,
    pageSize,
    totalItems,
    totalPages,
  };
}

export function parseProjectDetail(value: unknown): ProjectDetail {
  if (!isRecord(value) || value['contract'] !== CONTRACT || !isStatus(value['status'])) {
    throw new Error('P023_RESPONSE_INVALID');
  }
  return {
    contract: CONTRACT,
    projectId: requiredString(value['projectId']),
    code: requiredString(value['code']),
    name: requiredString(value['name']),
    clientName: requiredString(value['clientName']),
    status: value['status'],
    currencyCode: requiredString(value['currencyCode']),
    contractValue: nullableDecimal(value['contractValue']),
    updatedAt: requiredString(value['updatedAt']),
  };
}

export function readPortfolioQuery(search: string): PortfolioQuery {
  const params = new URLSearchParams(search);
  const searchValue = params.get('search')?.trim();
  const statusValue = params.get('status');
  const status: PortfolioStatus | undefined =
    statusValue && isStatus(statusValue) ? statusValue : undefined;
  const sort = params.get('sort');
  const order = params.get('order');
  const page = Number(params.get('page') ?? DEFAULT_PORTFOLIO_QUERY.page);
  const pageSize = Number(params.get('pageSize') ?? DEFAULT_PORTFOLIO_QUERY.pageSize);
  return {
    ...(searchValue ? { search: searchValue } : {}),
    ...(status ? { status } : {}),
    sort:
      sort && (PROJECT_SORT_FIELDS as readonly string[]).includes(sort)
        ? (sort as ProjectSortField)
        : DEFAULT_PORTFOLIO_QUERY.sort,
    order: order === 'desc' ? 'desc' : DEFAULT_PORTFOLIO_QUERY.order,
    page: Number.isSafeInteger(page) && page > 0 ? page : DEFAULT_PORTFOLIO_QUERY.page,
    pageSize:
      Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100
        ? pageSize
        : DEFAULT_PORTFOLIO_QUERY.pageSize,
  };
}

export function serializePortfolioQuery(query: PortfolioQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.sort !== DEFAULT_PORTFOLIO_QUERY.sort) params.set('sort', query.sort);
  if (query.order !== DEFAULT_PORTFOLIO_QUERY.order) params.set('order', query.order);
  if (query.page !== DEFAULT_PORTFOLIO_QUERY.page) params.set('page', String(query.page));
  if (query.pageSize !== DEFAULT_PORTFOLIO_QUERY.pageSize) {
    params.set('pageSize', String(query.pageSize));
  }
  return params.toString();
}

export function isFiltered(query: PortfolioQuery): boolean {
  return Boolean(query.search || query.status);
}

export function formatMoney(value: string | null, currencyCode: string): string {
  if (value === null) return 'Indisponível';
  const parts = value.split('.');
  const integerPart = parts[0] ?? '0';
  const fractionPart = parts[1] ?? '';
  const negative = integerPart.startsWith('-');
  const unsigned = negative ? integerPart.slice(1) : integerPart;
  const grouped = unsigned.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  const fraction = fractionPart.padEnd(2, '0').slice(0, 2);
  const symbol = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode,
  })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value;
  return `${negative ? '-' : ''}${symbol ?? currencyCode} ${grouped},${fraction}`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Indisponível';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date);
}

export function statusLabel(status: ProjectStatus): string {
  return {
    draft: 'Rascunho',
    active: 'Ativo',
    on_hold: 'Em espera',
    completed: 'Concluído',
    cancelled: 'Cancelado',
  }[status];
}
