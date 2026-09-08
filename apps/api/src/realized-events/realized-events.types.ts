import { BadRequestException } from '@nestjs/common';

export const P032_REALIZED_EVENTS_CONTRACT = 'ltcm.p032.realized-events-crud.v1' as const;

export interface RealizedEventCreatePayload {
  readonly projectItemId: string | null;
  readonly competenceDate: string;
  readonly sourceKey: string;
  readonly documentNumber: string | null;
  readonly installmentKey: string | null;
  readonly amount: string;
  readonly currencyCode: string;
  readonly notes: string | null;
}

export interface RealizedEventPatchPayload {
  readonly projectItemId?: string | null;
  readonly competenceDate?: string;
  readonly sourceKey?: string;
  readonly documentNumber?: string | null;
  readonly installmentKey?: string | null;
  readonly amount?: string;
  readonly currencyCode?: string;
  readonly notes?: string | null;
  readonly expectedVersion: number;
}

export interface RealizedEventPublishPayload {
  readonly expectedVersion: number;
}

export interface RealizedEventCancelPayload {
  readonly expectedVersion: number;
  readonly justification: string;
}

export type RealizedEventStatus = 'draft' | 'posted' | 'cancelled';

export interface RealizedEventRecord {
  readonly id: string;
  readonly projectId: string;
  readonly projectItemId: string | null;
  readonly itemCode: string | null;
  readonly itemDescription: string | null;
  readonly metricType: 'billing_actual';
  readonly competenceDate: string;
  readonly sourceKey: string;
  readonly documentNumber: string | null;
  readonly installmentKey: string | null;
  readonly amount: string;
  readonly currencyCode: string;
  readonly status: RealizedEventStatus;
  readonly notes: string | null;
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RealizedEventItemOption {
  readonly id: string;
  readonly itemCode: string | null;
  readonly description: string | null;
}

export interface RealizedEventsResponse {
  readonly contract: typeof P032_REALIZED_EVENTS_CONTRACT;
  readonly projectId: string;
  readonly project: {
    readonly code: string;
    readonly name: string;
    readonly currencyCode: string;
  };
  readonly projectItems: readonly RealizedEventItemOption[];
  readonly events: readonly RealizedEventRecord[];
}

const CREATE_FIELDS = new Set([
  'projectItemId',
  'competenceDate',
  'sourceKey',
  'documentNumber',
  'installmentKey',
  'amount',
  'currencyCode',
  'notes',
]);
const PATCH_FIELDS = new Set([...CREATE_FIELDS, 'expectedVersion']);
const VERSION_FIELDS = new Set(['expectedVersion']);
const CANCEL_FIELDS = new Set(['expectedVersion', 'justification']);

function invalid(code: string): never {
  throw new BadRequestException(code);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('P032_INVALID_PAYLOAD');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) invalid(`P032_UNKNOWN_FIELD_${unknown}`);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') invalid(`P032_${field}_INVALID`);
  const normalized = value.trim();
  if (!normalized) invalid(`P032_${field}_REQUIRED`);
  if (normalized.length > max) invalid(`P032_${field}_TOO_LONG`);
  return normalized;
}

function nullableText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, field, max);
}

function uuid(value: unknown, field: string): string {
  const normalized = text(value, field, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalized)
  ) {
    invalid(`P032_${field}_INVALID`);
  }
  return normalized;
}

function nullableUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return uuid(value, field);
}

function date(value: unknown): string {
  const normalized = text(value, 'COMPETENCE_DATE', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) invalid('P032_COMPETENCE_DATE_INVALID');
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    invalid('P032_COMPETENCE_DATE_INVALID');
  }
  return normalized;
}

function amount(value: unknown): string {
  const normalized = text(value, 'AMOUNT', 21);
  const match = /^(?<integer>0|[1-9]\d{0,17})(?:\.(?<fraction>\d{1,2}))?$/u.exec(normalized);
  if (!match) invalid('P032_AMOUNT_INVALID');
  return `${match.groups?.['integer']}.${(match.groups?.['fraction'] ?? '').padEnd(2, '0')}`;
}

function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid('P032_EXPECTED_VERSION_INVALID');
  }
  return value;
}

function requiredCreateFields(body: Record<string, unknown>): void {
  for (const field of ['projectItemId', 'competenceDate', 'sourceKey', 'amount', 'currencyCode']) {
    if (!(field in body)) invalid(`P032_${field.toUpperCase()}_REQUIRED`);
  }
}

function createFields(body: Record<string, unknown>): RealizedEventCreatePayload {
  requiredCreateFields(body);
  return {
    projectItemId: nullableUuid(body['projectItemId'], 'PROJECT_ITEM_ID'),
    competenceDate: date(body['competenceDate']),
    sourceKey: text(body['sourceKey'], 'SOURCE_KEY', 500),
    documentNumber: nullableText(body['documentNumber'], 'DOCUMENT_NUMBER', 255),
    installmentKey: nullableText(body['installmentKey'], 'INSTALLMENT_KEY', 255),
    amount: amount(body['amount']),
    currencyCode: text(body['currencyCode'], 'CURRENCY_CODE', 20).toUpperCase(),
    notes: nullableText(body['notes'], 'NOTES', 2_000),
  };
}

export function parseRealizedEventId(value: string): string {
  return uuid(value, 'EVENT_ID');
}

export function parseRealizedEventCreatePayload(value: unknown): RealizedEventCreatePayload {
  const body = object(value);
  keys(body, CREATE_FIELDS);
  return createFields(body);
}

export function parseRealizedEventPatchPayload(value: unknown): RealizedEventPatchPayload {
  const body = object(value);
  keys(body, PATCH_FIELDS);
  if (Object.keys(body).filter((key) => key !== 'expectedVersion').length === 0) {
    invalid('P032_EMPTY_PATCH');
  }
  return {
    ...(body['projectItemId'] !== undefined
      ? { projectItemId: nullableUuid(body['projectItemId'], 'PROJECT_ITEM_ID') }
      : {}),
    ...(body['competenceDate'] !== undefined
      ? { competenceDate: date(body['competenceDate']) }
      : {}),
    ...(body['sourceKey'] !== undefined
      ? { sourceKey: text(body['sourceKey'], 'SOURCE_KEY', 500) }
      : {}),
    ...(body['documentNumber'] !== undefined
      ? { documentNumber: nullableText(body['documentNumber'], 'DOCUMENT_NUMBER', 255) }
      : {}),
    ...(body['installmentKey'] !== undefined
      ? { installmentKey: nullableText(body['installmentKey'], 'INSTALLMENT_KEY', 255) }
      : {}),
    ...(body['amount'] !== undefined ? { amount: amount(body['amount']) } : {}),
    ...(body['currencyCode'] !== undefined
      ? { currencyCode: text(body['currencyCode'], 'CURRENCY_CODE', 20).toUpperCase() }
      : {}),
    ...(body['notes'] !== undefined ? { notes: nullableText(body['notes'], 'NOTES', 2_000) } : {}),
    expectedVersion: version(body['expectedVersion']),
  };
}

export function parseRealizedEventPublishPayload(value: unknown): RealizedEventPublishPayload {
  const body = object(value);
  keys(body, VERSION_FIELDS);
  return { expectedVersion: version(body['expectedVersion']) };
}

export function parseRealizedEventCancelPayload(value: unknown): RealizedEventCancelPayload {
  const body = object(value);
  keys(body, CANCEL_FIELDS);
  return {
    expectedVersion: version(body['expectedVersion']),
    justification: text(body['justification'], 'JUSTIFICATION', 2_000),
  };
}
