import { BadRequestException } from '@nestjs/common';

export const P026_MASTER_DATA_CONTRACT = 'ltcm.p026.master-data-management.v1' as const;
export const P026_CURRENCIES = ['BRL', 'USD'] as const;
export type P026Currency = (typeof P026_CURRENCIES)[number];

export interface MasterDataListQuery {
  readonly search?: string;
  readonly status: 'active' | 'inactive' | 'all';
}

export interface ClientCreatePayload {
  readonly legalName: string;
  readonly displayName: string;
  readonly taxId?: string | null;
}

export interface ClientPatchPayload {
  readonly legalName?: string;
  readonly displayName?: string;
  readonly taxId?: string | null;
  readonly expectedVersion: number;
}

export interface StatusPayload {
  readonly active: boolean;
  readonly expectedVersion: number;
  readonly justification: string;
}

export interface UnitCreatePayload {
  readonly code: string;
  readonly name: string;
  readonly category: string | null;
}

export interface UnitPatchPayload {
  readonly name?: string;
  readonly category?: string | null;
  readonly expectedVersion: number;
}

export interface ClientRecord {
  readonly id: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly taxId: string | null;
  readonly active: boolean;
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface CurrencyRecord {
  readonly code: P026Currency;
  readonly name: string;
  readonly decimalPlaces: number;
  readonly active: boolean;
  readonly rowVersion: number;
  readonly updatedAt: string;
}

export interface UnitRecord {
  readonly code: string;
  readonly name: string;
  readonly category: string | null;
  readonly active: boolean;
  readonly rowVersion: number;
  readonly updatedAt: string;
}

export interface MasterDataListResponse<T> {
  readonly contract: typeof P026_MASTER_DATA_CONTRACT;
  readonly items: readonly T[];
}

const CLIENT_CREATE_FIELDS = new Set(['legalName', 'displayName', 'taxId']);
const CLIENT_PATCH_FIELDS = new Set(['legalName', 'displayName', 'taxId', 'expectedVersion']);
const STATUS_FIELDS = new Set(['active', 'expectedVersion', 'justification']);
const UNIT_CREATE_FIELDS = new Set(['code', 'name', 'category']);
const UNIT_PATCH_FIELDS = new Set(['name', 'category', 'expectedVersion']);

function invalid(code: string): never {
  throw new BadRequestException(code);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('P026_INVALID_PAYLOAD');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) invalid(`P026_UNKNOWN_FIELD_${unknown}`);
}

function text(value: unknown, code: string, max = 500): string {
  if (typeof value !== 'string') invalid(`${code}_INVALID`);
  const normalized = value.trim();
  if (!normalized) invalid(`${code}_REQUIRED`);
  if (normalized.length > max) invalid(`${code}_TOO_LONG`);
  return normalized;
}

function nullableText(value: unknown, code: string, max = 500): string | null {
  if (value === null) return null;
  return text(value, code, max);
}

function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid('P026_EXPECTED_VERSION_INVALID');
  }
  return value;
}

function active(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid('P026_ACTIVE_INVALID');
  return value;
}

export function parseMasterDataListQuery(
  value: Readonly<Record<string, unknown>>,
): MasterDataListQuery {
  const searchValue = value['search'];
  const search = searchValue === undefined ? undefined : text(searchValue, 'P026_SEARCH', 120);
  const statusValue = value['status'] ?? 'all';
  if (statusValue !== 'active' && statusValue !== 'inactive' && statusValue !== 'all') {
    invalid('P026_STATUS_INVALID');
  }
  return { ...(search ? { search } : {}), status: statusValue };
}

export function parseClientCreatePayload(value: unknown): ClientCreatePayload {
  const body = object(value);
  keys(body, CLIENT_CREATE_FIELDS);
  if (!('legalName' in body)) invalid('P026_LEGAL_NAME_REQUIRED');
  if (!('displayName' in body)) invalid('P026_DISPLAY_NAME_REQUIRED');
  return {
    legalName: text(body['legalName'], 'P026_LEGAL_NAME'),
    displayName: text(body['displayName'], 'P026_DISPLAY_NAME'),
    ...(body['taxId'] !== undefined ? { taxId: nullableText(body['taxId'], 'P026_TAX_ID') } : {}),
  };
}

export function parseClientPatchPayload(value: unknown): ClientPatchPayload {
  const body = object(value);
  keys(body, CLIENT_PATCH_FIELDS);
  const fields = Object.keys(body).filter((field) => field !== 'expectedVersion');
  if (fields.length === 0) invalid('P026_EMPTY_PATCH');
  return {
    ...(body['legalName'] !== undefined
      ? { legalName: text(body['legalName'], 'P026_LEGAL_NAME') }
      : {}),
    ...(body['displayName'] !== undefined
      ? { displayName: text(body['displayName'], 'P026_DISPLAY_NAME') }
      : {}),
    ...(body['taxId'] !== undefined ? { taxId: nullableText(body['taxId'], 'P026_TAX_ID') } : {}),
    expectedVersion: version(body['expectedVersion']),
  };
}

export function parseStatusPayload(value: unknown): StatusPayload {
  const body = object(value);
  keys(body, STATUS_FIELDS);
  return {
    active: active(body['active']),
    expectedVersion: version(body['expectedVersion']),
    justification: text(body['justification'], 'P026_JUSTIFICATION', 2_000),
  };
}

export function parseUnitCreatePayload(value: unknown): UnitCreatePayload {
  const body = object(value);
  keys(body, UNIT_CREATE_FIELDS);
  if (!('code' in body)) invalid('P026_UNIT_CODE_REQUIRED');
  if (!('name' in body)) invalid('P026_UNIT_NAME_REQUIRED');
  return {
    code: text(body['code'], 'P026_UNIT_CODE', 50).toUpperCase(),
    name: text(body['name'], 'P026_UNIT_NAME'),
    category:
      body['category'] === undefined ? null : nullableText(body['category'], 'P026_UNIT_CATEGORY'),
  };
}

export function parseUnitPatchPayload(value: unknown): UnitPatchPayload {
  const body = object(value);
  keys(body, UNIT_PATCH_FIELDS);
  if (Object.keys(body).filter((field) => field !== 'expectedVersion').length === 0) {
    invalid('P026_EMPTY_PATCH');
  }
  return {
    ...(body['name'] !== undefined ? { name: text(body['name'], 'P026_UNIT_NAME') } : {}),
    ...(body['category'] !== undefined
      ? { category: nullableText(body['category'], 'P026_UNIT_CATEGORY') }
      : {}),
    expectedVersion: version(body['expectedVersion']),
  };
}

export function parseCurrencyCode(value: string): P026Currency {
  const code = value.trim().toUpperCase();
  if (!(P026_CURRENCIES as readonly string[]).includes(code)) {
    throw new BadRequestException('P026_CURRENCY_NOT_ALLOWED');
  }
  return code as P026Currency;
}
