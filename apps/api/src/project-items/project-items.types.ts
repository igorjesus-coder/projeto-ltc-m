import { BadRequestException } from '@nestjs/common';

export const P027_PROJECT_ITEMS_CONTRACT = 'ltcm.p027.project-items-crud.v1' as const;
export const P028_PROJECT_ITEMS_LIFECYCLE_CONTRACT =
  'ltcm.p028.project-items-lifecycle.v1' as const;
export const P027_CURRENCIES = ['BRL', 'USD'] as const;
export type P027Currency = (typeof P027_CURRENCIES)[number];

export interface ProjectItemCreatePayload {
  readonly itemCode: string | null;
  readonly description: string | null;
  readonly quantity: string;
  readonly unitCode: string;
  readonly currencyCode: P027Currency;
  readonly unitPrice: string;
}

export interface ProjectItemPatchPayload extends Partial<ProjectItemCreatePayload> {
  readonly expectedVersion: number;
}

export interface ProjectItemDuplicatePayload {
  readonly expectedVersion: number;
}

export interface ProjectItemInactivatePayload {
  readonly expectedVersion: number;
  readonly justification: string;
}

export interface ProjectItemReactivatePayload {
  readonly expectedVersion: number;
  readonly justification: string;
}

export interface ProjectItemRecord {
  readonly id: string;
  readonly projectId: string;
  readonly sourceLineKey: string;
  readonly lineNumber: number;
  readonly itemCode: string | null;
  readonly description: string | null;
  readonly quantity: string;
  readonly unitCode: string;
  readonly unitName: string;
  readonly unitAvailable: boolean;
  readonly currencyCode: P027Currency;
  readonly currencyName: string;
  readonly currencyAvailable: boolean;
  readonly unitPrice: string;
  readonly totalAmount: string;
  readonly active: boolean;
  readonly deletedAt: string | null;
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectItemCatalogOption {
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
}

export interface ProjectItemsResponse {
  readonly contract: typeof P027_PROJECT_ITEMS_CONTRACT;
  readonly projectId: string;
  readonly projectCurrency: P027Currency;
  readonly projectCurrencyAvailable: boolean;
  readonly units: readonly ProjectItemCatalogOption[];
  readonly items: readonly ProjectItemRecord[];
}

const CREATE_FIELDS = new Set([
  'itemCode',
  'description',
  'quantity',
  'unitCode',
  'currencyCode',
  'unitPrice',
]);
const PATCH_FIELDS = new Set([...CREATE_FIELDS, 'expectedVersion']);
const DUPLICATE_FIELDS = new Set(['expectedVersion']);
const INACTIVATE_FIELDS = new Set(['expectedVersion', 'justification']);
const REACTIVATE_FIELDS = new Set(['expectedVersion', 'justification']);

function invalid(code: string): never {
  throw new BadRequestException(code);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('P027_INVALID_PAYLOAD');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) invalid(`P027_UNKNOWN_FIELD_${unknown}`);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') invalid(`P027_${field}_INVALID`);
  const normalized = value.trim();
  if (!normalized) invalid(`P027_${field}_REQUIRED`);
  if (normalized.length > max) invalid(`P027_${field}_TOO_LONG`);
  return normalized;
}

function nullableText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === '') return null;
  return text(value, field, max);
}

function decimal(value: unknown, field: string, allowZero: boolean): string {
  if (typeof value !== 'string') invalid(`P027_${field}_INVALID`);
  const normalized = value.trim();
  const match = /^(?<integer>[0-9]{1,16})(?:\.(?<fraction>[0-9]{1,4}))?$/u.exec(normalized);
  if (!match) invalid(`P027_${field}_INVALID`);
  const scaled = BigInt(
    `${match.groups?.['integer']}${(match.groups?.['fraction'] ?? '').padEnd(4, '0')}`,
  );
  if (!allowZero && scaled === 0n) invalid(`P027_${field}_POSITIVE`);
  return normalized;
}

function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid('P027_EXPECTED_VERSION_INVALID');
  }
  return value;
}

function currency(value: unknown): P027Currency {
  if (typeof value !== 'string') invalid('P027_CURRENCY_NOT_ALLOWED');
  const normalized = value.trim().toUpperCase();
  if (!(P027_CURRENCIES as readonly string[]).includes(normalized)) {
    invalid('P027_CURRENCY_NOT_ALLOWED');
  }
  return normalized as P027Currency;
}

export function parseProjectItemId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    invalid('P027_ITEM_ID_INVALID');
  }
  return value;
}

export function parseProjectItemCreatePayload(value: unknown): ProjectItemCreatePayload {
  const body = object(value);
  keys(body, CREATE_FIELDS);
  for (const field of ['quantity', 'unitCode', 'currencyCode', 'unitPrice']) {
    if (!(field in body)) invalid(`P027_${field.toUpperCase()}_REQUIRED`);
  }
  return {
    itemCode: nullableText(body['itemCode'], 'ITEM_CODE', 120),
    description: nullableText(body['description'], 'DESCRIPTION', 1_000),
    quantity: decimal(body['quantity'], 'QUANTITY', false),
    unitCode: text(body['unitCode'], 'UNIT_CODE', 50).toUpperCase(),
    currencyCode: currency(body['currencyCode']),
    unitPrice: decimal(body['unitPrice'], 'UNIT_PRICE', true),
  };
}

export function parseProjectItemPatchPayload(value: unknown): ProjectItemPatchPayload {
  const body = object(value);
  keys(body, PATCH_FIELDS);
  if (Object.keys(body).filter((key) => key !== 'expectedVersion').length === 0) {
    invalid('P027_EMPTY_PATCH');
  }
  return {
    ...(body['itemCode'] !== undefined
      ? { itemCode: nullableText(body['itemCode'], 'ITEM_CODE', 120) }
      : {}),
    ...(body['description'] !== undefined
      ? { description: nullableText(body['description'], 'DESCRIPTION', 1_000) }
      : {}),
    ...(body['quantity'] !== undefined
      ? { quantity: decimal(body['quantity'], 'QUANTITY', false) }
      : {}),
    ...(body['unitCode'] !== undefined
      ? { unitCode: text(body['unitCode'], 'UNIT_CODE', 50).toUpperCase() }
      : {}),
    ...(body['currencyCode'] !== undefined ? { currencyCode: currency(body['currencyCode']) } : {}),
    ...(body['unitPrice'] !== undefined
      ? { unitPrice: decimal(body['unitPrice'], 'UNIT_PRICE', true) }
      : {}),
    expectedVersion: version(body['expectedVersion']),
  };
}

export function parseProjectItemDuplicatePayload(value: unknown): ProjectItemDuplicatePayload {
  const body = object(value);
  keys(body, DUPLICATE_FIELDS);
  return { expectedVersion: version(body['expectedVersion']) };
}

export function parseProjectItemInactivatePayload(value: unknown): ProjectItemInactivatePayload {
  const body = object(value);
  keys(body, INACTIVATE_FIELDS);
  return {
    expectedVersion: version(body['expectedVersion']),
    justification: text(body['justification'], 'JUSTIFICATION', 2_000),
  };
}

export function parseProjectItemReactivatePayload(value: unknown): ProjectItemReactivatePayload {
  const body = object(value);
  keys(body, REACTIVATE_FIELDS);
  return {
    expectedVersion: version(body['expectedVersion']),
    justification: text(body['justification'], 'JUSTIFICATION', 2_000),
  };
}
