export const P027_PROJECT_ITEMS_CONTRACT = 'ltcm.p027.project-items-crud.v1' as const;
export const P027_CURRENCIES = ['BRL', 'USD'] as const;
export type ProjectItemCurrency = (typeof P027_CURRENCIES)[number];

export interface ProjectItemCatalogOption {
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
}

export interface ProjectItem {
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
  readonly currencyCode: ProjectItemCurrency;
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

export interface ProjectItemsResponse {
  readonly contract: typeof P027_PROJECT_ITEMS_CONTRACT;
  readonly projectId: string;
  readonly projectCurrency: ProjectItemCurrency;
  readonly projectCurrencyAvailable: boolean;
  readonly units: readonly ProjectItemCatalogOption[];
  readonly items: readonly ProjectItem[];
}

function invalid(): never {
  throw new Error('P027_RESPONSE_INVALID');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : invalid();
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{1,16}(?:\.[0-9]{1,4})?$/u.test(value)) invalid();
  return value;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid();
  return value;
}

function currency(value: unknown): ProjectItemCurrency {
  if (typeof value !== 'string' || !(P027_CURRENCIES as readonly string[]).includes(value)) {
    invalid();
  }
  return value as ProjectItemCurrency;
}

function catalogOption(value: unknown): ProjectItemCatalogOption {
  const item = record(value);
  if (typeof item['active'] !== 'boolean') invalid();
  return {
    code: requiredString(item['code']),
    name: requiredString(item['name']),
    active: item['active'],
  };
}

function projectItem(value: unknown): ProjectItem {
  const item = record(value);
  if (
    typeof item['unitAvailable'] !== 'boolean' ||
    typeof item['currencyAvailable'] !== 'boolean' ||
    typeof item['active'] !== 'boolean'
  ) {
    invalid();
  }
  return {
    id: requiredString(item['id']),
    projectId: requiredString(item['projectId']),
    sourceLineKey: requiredString(item['sourceLineKey']),
    lineNumber: positiveInteger(item['lineNumber']),
    itemCode: nullableString(item['itemCode']),
    description: nullableString(item['description']),
    quantity: decimal(item['quantity']),
    unitCode: requiredString(item['unitCode']),
    unitName: requiredString(item['unitName']),
    unitAvailable: item['unitAvailable'],
    currencyCode: currency(item['currencyCode']),
    currencyName: requiredString(item['currencyName']),
    currencyAvailable: item['currencyAvailable'],
    unitPrice: decimal(item['unitPrice']),
    totalAmount: decimal(item['totalAmount']),
    active: item['active'],
    deletedAt: nullableString(item['deletedAt']),
    rowVersion: positiveInteger(item['rowVersion']),
    createdAt: requiredString(item['createdAt']),
    updatedAt: requiredString(item['updatedAt']),
  };
}

export function parseProjectItemsResponse(value: unknown): ProjectItemsResponse {
  const response = record(value);
  if (
    response['contract'] !== P027_PROJECT_ITEMS_CONTRACT ||
    !Array.isArray(response['units']) ||
    !Array.isArray(response['items']) ||
    typeof response['projectCurrencyAvailable'] !== 'boolean'
  ) {
    invalid();
  }
  return {
    contract: P027_PROJECT_ITEMS_CONTRACT,
    projectId: requiredString(response['projectId']),
    projectCurrency: currency(response['projectCurrency']),
    projectCurrencyAvailable: response['projectCurrencyAvailable'],
    units: response['units'].map(catalogOption),
    items: response['items'].map(projectItem),
  };
}

export function formatProjectItemMoney(value: string, currencyCode: ProjectItemCurrency): string {
  const [integer = '0', fraction = ''] = value.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  const symbol = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode,
  })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value;
  return `${symbol ?? currencyCode} ${grouped},${fraction.padEnd(2, '0').slice(0, 2)}`;
}
