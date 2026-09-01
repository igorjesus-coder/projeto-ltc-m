import type { PortfolioStatus } from './project-portfolio';

export const P024_PROJECT_CREATE_EDIT_CONTRACT = 'ltcm.p024.project-create-edit.v1' as const;
export const PROJECT_CURRENCIES = ['BRL', 'USD'] as const;
export type ProjectCurrency = (typeof PROJECT_CURRENCIES)[number];
export const PROJECT_CLASSIFICATIONS = ['full_contract', 'demand', 'opening_balance'] as const;
export type ProjectClassification = (typeof PROJECT_CLASSIFICATIONS)[number];

export interface ProjectOption {
  readonly id: string;
  readonly displayName: string;
}

export interface ProjectOptionsResponse {
  readonly contract: typeof P024_PROJECT_CREATE_EDIT_CONTRACT;
  readonly currencies: readonly ProjectCurrencyOption[];
  readonly clients: readonly ProjectOption[];
}

export interface ProjectCurrencyOption {
  readonly code: ProjectCurrency;
  readonly name: string;
}

export interface ProjectWriteResponse {
  readonly contract: typeof P024_PROJECT_CREATE_EDIT_CONTRACT;
  readonly projectId: string;
  readonly projectCode: string;
  readonly projectName: string;
  readonly client: ProjectOption & { readonly available: boolean };
  readonly reportingGroup: string | null;
  readonly classification: ProjectClassification;
  readonly status: PortfolioStatus;
  readonly baseCurrency: ProjectCurrency;
  readonly currencyAvailable: boolean;
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

export const CLASSIFICATION_LABELS: Readonly<Record<ProjectClassification, string>> = {
  full_contract: 'Contrato',
  demand: 'Demanda',
  opening_balance: 'Saldo',
};

export function isProjectClassification(value: unknown): value is ProjectClassification {
  return (
    typeof value === 'string' && (PROJECT_CLASSIFICATIONS as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('P024_RESPONSE_INVALID');
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('P024_RESPONSE_INVALID');
  return value;
}

function option(value: unknown): ProjectOption {
  if (!isRecord(value)) throw new Error('P024_RESPONSE_INVALID');
  return { id: requiredString(value['id']), displayName: requiredString(value['displayName']) };
}

function currencyOption(value: unknown): ProjectCurrencyOption {
  if (!isRecord(value) || !PROJECT_CURRENCIES.includes(value['code'] as ProjectCurrency)) {
    throw new Error('P024_RESPONSE_INVALID');
  }
  return {
    code: value['code'] as ProjectCurrency,
    name: requiredString(value['name']),
  };
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]+(?:\.[0-9]{1,2})?$/u.test(value)) {
    throw new Error('P024_RESPONSE_INVALID');
  }
  return value;
}

export function parseProjectOptions(value: unknown): ProjectOptionsResponse {
  if (!isRecord(value) || value['contract'] !== P024_PROJECT_CREATE_EDIT_CONTRACT) {
    throw new Error('P024_RESPONSE_INVALID');
  }
  if (!Array.isArray(value['currencies']) || !Array.isArray(value['clients'])) {
    throw new Error('P024_RESPONSE_INVALID');
  }
  return {
    contract: P024_PROJECT_CREATE_EDIT_CONTRACT,
    currencies: value['currencies'].map(currencyOption),
    clients: value['clients'].map(option),
  };
}

export function parseProjectWriteResponse(value: unknown): ProjectWriteResponse {
  if (!isRecord(value) || value['contract'] !== P024_PROJECT_CREATE_EDIT_CONTRACT) {
    throw new Error('P024_RESPONSE_INVALID');
  }
  const clientValue = value['client'];
  const client = option(clientValue);
  if (
    !isRecord(clientValue) ||
    typeof clientValue['available'] !== 'boolean' ||
    !isProjectClassification(value['classification']) ||
    typeof value['status'] !== 'string' ||
    !['draft', 'active', 'on_hold', 'completed', 'cancelled'].includes(value['status']) ||
    !PROJECT_CURRENCIES.includes(value['baseCurrency'] as ProjectCurrency) ||
    typeof value['currencyAvailable'] !== 'boolean' ||
    typeof value['version'] !== 'number' ||
    !Number.isSafeInteger(value['version']) ||
    value['version'] < 1
  ) {
    throw new Error('P024_RESPONSE_INVALID');
  }
  return {
    contract: P024_PROJECT_CREATE_EDIT_CONTRACT,
    projectId: requiredString(value['projectId']),
    projectCode: requiredString(value['projectCode']),
    projectName: requiredString(value['projectName']),
    client: { ...client, available: clientValue['available'] },
    reportingGroup: nullableString(value['reportingGroup']),
    classification: value['classification'],
    status: value['status'] as PortfolioStatus,
    baseCurrency: value['baseCurrency'] as ProjectCurrency,
    currencyAvailable: value['currencyAvailable'],
    contractValue: decimal(value['contractValue']),
    openingBalance: value['openingBalance'] === null ? null : decimal(value['openingBalance']),
    budgetCost: value['budgetCost'] === null ? null : decimal(value['budgetCost']),
    startDate: nullableString(value['startDate']),
    endDate: nullableString(value['endDate']),
    dataReferenceDate: nullableString(value['dataReferenceDate']),
    notes: nullableString(value['notes']),
    version: value['version'],
    updatedAt: requiredString(value['updatedAt']),
  };
}
