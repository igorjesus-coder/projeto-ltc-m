import { getSafeReturnTo } from '../auth/navigation';

export const P034_DATA_QUALITY_CONTRACT = 'ltcm.p034.data-quality-center.v1' as const;
export const QUALITY_SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'BLOCKING'] as const;
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number];
export const QUALITY_RULES = [
  'PROJECT_VALUE_MISMATCH',
  'ACTUAL_STATUS_UNRESOLVED',
  'UNPLANNED_BALANCE',
  'MISSING_REQUIRED_FIELD',
  'PROJECT_DATA_STALE',
  'DUPLICATE_PROJECT_SOURCE_IDENTITY',
  'DUPLICATE_ITEM_SOURCE_IDENTITY',
  'IMPORT_DUPLICATION',
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
export interface QualityQuery {
  readonly projectId?: string;
  readonly rule?: QualityRuleCode;
  readonly severity?: QualitySeverity;
  readonly origin?: QualityOriginEntity;
  readonly search?: string;
  readonly sort: QualitySortField;
  readonly order: 'asc' | 'desc';
  readonly page: number;
  readonly pageSize: number;
}
export const DEFAULT_QUALITY_QUERY: QualityQuery = {
  sort: 'project',
  order: 'asc',
  page: 1,
  pageSize: 25,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('P034_RESPONSE_INVALID');
  return value;
}
function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}
function oneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}
function parseReference(value: unknown): QualityReference {
  if (!isRecord(value) || !oneOf(value['kind'], ['source', 'database'] as const))
    throw new Error('P034_RESPONSE_INVALID');
  return {
    kind: value['kind'],
    locator: requiredString(value['locator']),
    fingerprint: requiredString(value['fingerprint']),
  };
}
function parseAction(value: unknown): QualityNavigationAction {
  if (
    !isRecord(value) ||
    !oneOf(value['target'], [
      'project',
      'project_item',
      'planning',
      'realized_event',
      'master_data',
    ] as const)
  )
    throw new Error('P034_RESPONSE_INVALID');
  return {
    target: value['target'],
    ...(value['projectId'] === undefined ? {} : { projectId: requiredString(value['projectId']) }),
    ...(value['entityId'] === undefined ? {} : { entityId: requiredString(value['entityId']) }),
    ...(value['entityCode'] === undefined
      ? {}
      : { entityCode: requiredString(value['entityCode']) }),
  };
}
function parseFinding(value: unknown): QualityFinding {
  if (
    !isRecord(value) ||
    !oneOf(value['severity'], QUALITY_SEVERITIES) ||
    !isRecord(value['project']) ||
    !isRecord(value['rule']) ||
    !isRecord(value['origin'])
  )
    throw new Error('P034_RESPONSE_INVALID');
  const project = value['project'];
  const rule = value['rule'];
  const origin = value['origin'];
  if (
    !oneOf(rule['code'], QUALITY_RULES) ||
    typeof rule['label'] !== 'string' ||
    !oneOf(origin['entity'], QUALITY_ORIGINS)
  )
    throw new Error('P034_RESPONSE_INVALID');
  const references = (field: string) => {
    const entry = origin[field];
    if (entry === undefined) return undefined;
    if (!Array.isArray(entry)) throw new Error('P034_RESPONSE_INVALID');
    return entry.map(parseReference);
  };
  const optionalValue = (field: string) =>
    value[field] === undefined ? undefined : nullableString(value[field]);
  const sourceReferences = references('sourceReferences');
  const databaseReferences = references('databaseReferences');
  const expectedValue = optionalValue('expectedValue');
  const observedValue = optionalValue('observedValue');
  const delta = optionalValue('delta');
  return {
    id: requiredString(value['id']),
    project: {
      id: requiredString(project['id']),
      ...(project['code'] === undefined ? {} : { code: requiredString(project['code']) }),
      ...(project['name'] === undefined ? {} : { name: requiredString(project['name']) }),
    },
    rule: { code: rule['code'], label: rule['label'] },
    severity: value['severity'],
    ...(expectedValue === undefined ? {} : { expectedValue }),
    ...(observedValue === undefined ? {} : { observedValue }),
    ...(delta === undefined ? {} : { delta }),
    ...(value['currencyCode'] === undefined
      ? {}
      : { currencyCode: nullableString(value['currencyCode']) }),
    origin: {
      entity: origin['entity'],
      ...(origin['findingOrigin'] === undefined
        ? {}
        : { findingOrigin: nullableString(origin['findingOrigin']) }),
      ...(sourceReferences ? { sourceReferences } : {}),
      ...(databaseReferences ? { databaseReferences } : {}),
    },
    ...(value['evidence'] === undefined
      ? {}
      : {
          evidence: isRecord(value['evidence'])
            ? value['evidence']
            : (() => {
                throw new Error('P034_RESPONSE_INVALID');
              })(),
        }),
    ...(value['explanation'] === undefined
      ? {}
      : { explanation: requiredString(value['explanation']) }),
    ...(value['remediation'] === undefined
      ? {}
      : { remediation: requiredString(value['remediation']) }),
    ...(value['navigationAction'] === undefined
      ? {}
      : { navigationAction: parseAction(value['navigationAction']) }),
  };
}
export function parseQualityResponse(value: unknown): QualityResponse {
  if (
    !isRecord(value) ||
    value['contract'] !== P034_DATA_QUALITY_CONTRACT ||
    !Array.isArray(value['items'])
  )
    throw new Error('P034_RESPONSE_INVALID');
  if (
    !(['page', 'pageSize', 'totalItems', 'totalPages'] as const).every(
      (field) =>
        typeof value[field] === 'number' && Number.isSafeInteger(value[field]) && value[field] >= 0,
    ) ||
    value['page'] === 0 ||
    value['pageSize'] === 0
  )
    throw new Error('P034_RESPONSE_INVALID');
  return {
    contract: P034_DATA_QUALITY_CONTRACT,
    items: value['items'].map(parseFinding),
    page: value['page'] as number,
    pageSize: value['pageSize'] as number,
    totalItems: value['totalItems'] as number,
    totalPages: value['totalPages'] as number,
  };
}
export function readQualityQuery(search: string): QualityQuery {
  const params = new URLSearchParams(search);
  const rule = params.get('rule');
  const severity = params.get('severity');
  const origin = params.get('origin');
  const sort = params.get('sort');
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('pageSize') ?? 25);
  return {
    ...(params.get('projectId') ? { projectId: params.get('projectId')! } : {}),
    ...(rule && oneOf(rule, QUALITY_RULES) ? { rule } : {}),
    ...(severity && oneOf(severity, QUALITY_SEVERITIES) ? { severity } : {}),
    ...(origin && oneOf(origin, QUALITY_ORIGINS) ? { origin } : {}),
    ...(params.get('search')?.trim() ? { search: params.get('search')!.trim() } : {}),
    sort: sort && oneOf(sort, QUALITY_SORT_FIELDS) ? sort : 'project',
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100 ? pageSize : 25,
  };
}
export function serializeQualityQuery(query: QualityQuery): string {
  const params = new URLSearchParams();
  if (query.projectId) params.set('projectId', query.projectId);
  if (query.rule) params.set('rule', query.rule);
  if (query.severity) params.set('severity', query.severity);
  if (query.origin) params.set('origin', query.origin);
  if (query.search) params.set('search', query.search);
  if (query.sort !== 'project') params.set('sort', query.sort);
  if (query.order !== 'asc') params.set('order', query.order);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.pageSize !== 25) params.set('pageSize', String(query.pageSize));
  return params.toString();
}
export function resolveQualityNavigation(
  action: QualityNavigationAction | undefined,
  returnTo: string,
  origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
): string | null {
  if (!action) return null;
  const safeReturnTo = getSafeReturnTo(returnTo, origin);
  const uuid = (value: string | undefined) =>
    value && /^[0-9a-f-]{36}$/iu.test(value) ? encodeURIComponent(value) : null;
  const projectId = uuid(action.projectId);
  const entityId = uuid(action.entityId);
  let path: string | null = null;
  if (action.target === 'master_data') path = '/admin/clients';
  else if (action.target === 'project' && projectId) path = `/projects/${projectId}`;
  else if (action.target === 'project_item' && projectId) path = `/projects/${projectId}/items`;
  else if (action.target === 'planning' && projectId) path = `/projects/${projectId}/planning`;
  else if (action.target === 'realized_event' && projectId)
    path = `/projects/${projectId}/realized-events`;
  return path
    ? `${path}?returnTo=${encodeURIComponent(safeReturnTo)}${entityId ? `&entityId=${entityId}` : ''}`
    : null;
}
export function qualitySeverityLabel(value: QualitySeverity): string {
  return { INFO: 'Informativo', WARNING: 'Atenção', ERROR: 'Erro', BLOCKING: 'Bloqueante' }[value];
}
export function formatQualityValue(
  value: string | null | undefined,
  currencyCode?: string | null,
): string {
  if (value === undefined || value === null) return '—';
  const number = Number(value);
  return currencyCode && Number.isFinite(number)
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode }).format(number)
    : value;
}
