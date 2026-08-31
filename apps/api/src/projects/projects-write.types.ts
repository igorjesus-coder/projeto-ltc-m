import { BadRequestException } from '@nestjs/common';

import { PROJECT_STATUSES, type ProjectStatus } from './projects.types.js';

export const P024_PROJECT_CREATE_EDIT_CONTRACT = 'ltcm.p024.project-create-edit.v1' as const;
export const PROJECT_CLASSIFICATIONS = ['full_contract', 'demand', 'opening_balance'] as const;
export type ProjectClassification = (typeof PROJECT_CLASSIFICATIONS)[number];

export interface ProjectWritePayload {
  readonly projectCode: string;
  readonly projectName: string;
  readonly clientId: string;
  readonly reportingGroup: string | null;
  readonly classification: ProjectClassification;
  readonly status: ProjectStatus;
  readonly contractValue: string;
  readonly openingBalance: string | null;
  readonly budgetCost: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly dataReferenceDate: string;
  readonly notes: string | null;
}

export interface ProjectPatchPayload {
  readonly projectName?: string;
  readonly clientId?: string;
  readonly reportingGroup?: string | null;
  readonly classification?: ProjectClassification;
  readonly status?: ProjectStatus;
  readonly contractValue?: string;
  readonly openingBalance?: string | null;
  readonly budgetCost?: string | null;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly dataReferenceDate?: string;
  readonly notes?: string | null;
  readonly expectedVersion: number;
}

export interface ProjectOption {
  readonly id: string;
  readonly displayName: string;
}

export interface ProjectOptionsResponse {
  readonly contract: typeof P024_PROJECT_CREATE_EDIT_CONTRACT;
  readonly baseCurrency: 'BRL';
  readonly clients: readonly ProjectOption[];
}

export interface ProjectWriteResponse {
  readonly contract: typeof P024_PROJECT_CREATE_EDIT_CONTRACT;
  readonly projectId: string;
  readonly projectCode: string;
  readonly projectName: string;
  readonly client: ProjectOption & { readonly available: boolean };
  readonly reportingGroup: string | null;
  readonly classification: ProjectClassification;
  readonly status: ProjectStatus;
  readonly baseCurrency: 'BRL';
  readonly contractValue: string;
  readonly openingBalance: string | null;
  readonly budgetCost: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly dataReferenceDate: string | null;
  readonly notes: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

const CREATE_FIELDS = new Set([
  'projectCode',
  'projectName',
  'clientId',
  'reportingGroup',
  'classification',
  'status',
  'contractValue',
  'openingBalance',
  'budgetCost',
  'startDate',
  'endDate',
  'dataReferenceDate',
  'notes',
  'baseCurrency',
]);

const PATCH_FIELDS = new Set([
  'projectCode',
  'baseCurrency',
  'projectName',
  'clientId',
  'reportingGroup',
  'classification',
  'status',
  'contractValue',
  'openingBalance',
  'budgetCost',
  'startDate',
  'endDate',
  'dataReferenceDate',
  'notes',
  'expectedVersion',
]);

function invalid(code: string): never {
  throw new BadRequestException(code);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('P024_INVALID_PAYLOAD');
  return value as Record<string, unknown>;
}

function validateKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) invalid(`P024_UNKNOWN_FIELD_${unknown}`);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(`P024_${field.toUpperCase()}_INVALID`);
  const normalized = value.trim();
  if (!normalized) invalid(`P024_${field.toUpperCase()}_REQUIRED`);
  return normalized;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid(`P024_${field.toUpperCase()}_INVALID`);
  const normalized = value.trim();
  if (!normalized) invalid(`P024_${field.toUpperCase()}_INVALID`);
  return normalized;
}

function uuid(value: unknown, field: string): string {
  const normalized = requiredText(value, field);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalized)
  ) {
    invalid(`P024_${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function classification(value: unknown): ProjectClassification {
  if (
    typeof value !== 'string' ||
    !(PROJECT_CLASSIFICATIONS as readonly string[]).includes(value)
  ) {
    invalid('P024_CLASSIFICATION_INVALID');
  }
  return value as ProjectClassification;
}

function status(value: unknown): ProjectStatus {
  if (typeof value !== 'string' || !(PROJECT_STATUSES as readonly string[]).includes(value)) {
    invalid('P024_STATUS_INVALID');
  }
  return value as ProjectStatus;
}

function decimal(value: unknown, field: string, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') invalid(`P024_${field.toUpperCase()}_INVALID`);
  const normalized = value.trim();
  if (!normalized) {
    if (nullable) return null;
    invalid(`P024_${field.toUpperCase()}_REQUIRED`);
  }
  const match = /^(?<integer>[0-9]+)(?:\.(?<fraction>[0-9]+))?$/u.exec(normalized);
  if (
    !match ||
    (match.groups?.['fraction']?.length ?? 0) > 2 ||
    (match.groups?.['integer']?.length ?? 0) > 18
  ) {
    invalid(`P024_${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function date(value: unknown, field: string, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') invalid(`P024_${field.toUpperCase()}_INVALID`);
  const normalized = value.trim();
  if (!normalized) {
    if (nullable) return null;
    invalid(`P024_${field.toUpperCase()}_REQUIRED`);
  }
  const match = /^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})$/u.exec(normalized);
  if (!match) invalid(`P024_${field.toUpperCase()}_INVALID`);
  const year = Number(match.groups?.['year']);
  const month = Number(match.groups?.['month']);
  const day = Number(match.groups?.['day']);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    invalid(`P024_${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function validateDateRange(startDate: string | null, endDate: string | null): void {
  if (startDate && endDate && endDate < startDate) invalid('P024_DATE_RANGE_INVALID');
}

export function parseProjectCreatePayload(value: unknown): ProjectWritePayload {
  const body = record(value);
  validateKeys(body, CREATE_FIELDS);
  const required = [
    'projectCode',
    'projectName',
    'clientId',
    'classification',
    'status',
    'contractValue',
    'dataReferenceDate',
  ];
  for (const field of required)
    if (!(field in body)) invalid(`P024_${field.toUpperCase()}_REQUIRED`);
  if ('baseCurrency' in body) invalid('P024_IMMUTABLE_FIELD_BASE_CURRENCY');
  const startDate = date(body['startDate'], 'start_date', true);
  const endDate = date(body['endDate'], 'end_date', true);
  validateDateRange(startDate, endDate);
  return {
    projectCode: requiredText(body['projectCode'], 'project_code'),
    projectName: requiredText(body['projectName'], 'project_name'),
    clientId: uuid(body['clientId'], 'client_id'),
    reportingGroup:
      'reportingGroup' in body ? optionalText(body['reportingGroup'], 'reporting_group') : null,
    classification: classification(body['classification']),
    status: status(body['status']),
    contractValue: decimal(body['contractValue'], 'contract_value', false) as string,
    openingBalance:
      'openingBalance' in body ? decimal(body['openingBalance'], 'opening_balance', true) : null,
    budgetCost: 'budgetCost' in body ? decimal(body['budgetCost'], 'budget_cost', true) : null,
    startDate,
    endDate,
    dataReferenceDate: date(body['dataReferenceDate'], 'data_reference_date', false) as string,
    notes: 'notes' in body ? optionalText(body['notes'], 'notes') : null,
  };
}

export function parseProjectPatchPayload(value: unknown): ProjectPatchPayload {
  const body = record(value);
  validateKeys(body, PATCH_FIELDS);
  if ('projectCode' in body) invalid('P024_IMMUTABLE_FIELD_PROJECT_CODE');
  if ('baseCurrency' in body) invalid('P024_IMMUTABLE_FIELD_BASE_CURRENCY');
  if (!('expectedVersion' in body)) invalid('P024_EXPECTED_VERSION_REQUIRED');
  if (
    typeof body['expectedVersion'] !== 'number' ||
    !Number.isSafeInteger(body['expectedVersion']) ||
    body['expectedVersion'] < 1
  ) {
    invalid('P024_EXPECTED_VERSION_INVALID');
  }
  const fields = Object.keys(body).filter((field) => field !== 'expectedVersion');
  if (fields.length === 0) invalid('P024_EMPTY_PATCH');
  const startDate = 'startDate' in body ? date(body['startDate'], 'start_date', true) : undefined;
  const endDate = 'endDate' in body ? date(body['endDate'], 'end_date', true) : undefined;
  if (startDate !== undefined && endDate !== undefined) validateDateRange(startDate, endDate);
  return {
    ...(typeof body['projectName'] !== 'undefined'
      ? { projectName: requiredText(body['projectName'], 'project_name') }
      : {}),
    ...(typeof body['clientId'] !== 'undefined'
      ? { clientId: uuid(body['clientId'], 'client_id') }
      : {}),
    ...(typeof body['reportingGroup'] !== 'undefined'
      ? { reportingGroup: optionalText(body['reportingGroup'], 'reporting_group') }
      : {}),
    ...(typeof body['classification'] !== 'undefined'
      ? { classification: classification(body['classification']) }
      : {}),
    ...(typeof body['status'] !== 'undefined' ? { status: status(body['status']) } : {}),
    ...(typeof body['contractValue'] !== 'undefined'
      ? { contractValue: decimal(body['contractValue'], 'contract_value', false) as string }
      : {}),
    ...(typeof body['openingBalance'] !== 'undefined'
      ? { openingBalance: decimal(body['openingBalance'], 'opening_balance', true) }
      : {}),
    ...(typeof body['budgetCost'] !== 'undefined'
      ? { budgetCost: decimal(body['budgetCost'], 'budget_cost', true) }
      : {}),
    ...(startDate !== undefined ? { startDate } : {}),
    ...(endDate !== undefined ? { endDate } : {}),
    ...(typeof body['dataReferenceDate'] !== 'undefined'
      ? {
          dataReferenceDate: date(
            body['dataReferenceDate'],
            'data_reference_date',
            false,
          ) as string,
        }
      : {}),
    ...(typeof body['notes'] !== 'undefined'
      ? { notes: optionalText(body['notes'], 'notes') }
      : {}),
    expectedVersion: body['expectedVersion'] as number,
  };
}
