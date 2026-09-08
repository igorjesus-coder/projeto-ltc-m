export const P032_REALIZED_EVENTS_CONTRACT = 'ltcm.p032.realized-events-crud.v1' as const;

export type RealizedEventStatus = 'draft' | 'posted' | 'cancelled';
export type RealizedEventAction = 'edit' | 'publish' | 'cancel';

export interface RealizedEvent {
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
  readonly project: { readonly code: string; readonly name: string; readonly currencyCode: string };
  readonly projectItems: readonly RealizedEventItemOption[];
  readonly events: readonly RealizedEvent[];
}

function invalid(): never {
  throw new Error('P032_RESPONSE_INVALID');
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
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/u.test(value)) invalid();
  return value;
}

function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid();
  return value;
}

function status(value: unknown): RealizedEventStatus {
  if (value === 'draft' || value === 'posted' || value === 'cancelled') return value;
  invalid();
}

function itemOption(value: unknown): RealizedEventItemOption {
  const item = record(value);
  return {
    id: requiredString(item['id']),
    itemCode: nullableString(item['itemCode']),
    description: nullableString(item['description']),
  };
}

function event(value: unknown): RealizedEvent {
  const item = record(value);
  if (item['metricType'] !== 'billing_actual') invalid();
  return {
    id: requiredString(item['id']),
    projectId: requiredString(item['projectId']),
    projectItemId: nullableString(item['projectItemId']),
    itemCode: nullableString(item['itemCode']),
    itemDescription: nullableString(item['itemDescription']),
    metricType: 'billing_actual',
    competenceDate: requiredString(item['competenceDate']),
    sourceKey: requiredString(item['sourceKey']),
    documentNumber: nullableString(item['documentNumber']),
    installmentKey: nullableString(item['installmentKey']),
    amount: decimal(item['amount']),
    currencyCode: requiredString(item['currencyCode']),
    status: status(item['status']),
    notes: nullableString(item['notes']),
    rowVersion: version(item['rowVersion']),
    createdAt: requiredString(item['createdAt']),
    updatedAt: requiredString(item['updatedAt']),
  };
}

export function parseRealizedEventsResponse(value: unknown): RealizedEventsResponse {
  const response = record(value);
  const project = record(response['project']);
  if (
    response['contract'] !== P032_REALIZED_EVENTS_CONTRACT ||
    !Array.isArray(response['projectItems']) ||
    !Array.isArray(response['events'])
  ) {
    invalid();
  }
  return {
    contract: P032_REALIZED_EVENTS_CONTRACT,
    projectId: requiredString(response['projectId']),
    project: {
      code: requiredString(project['code']),
      name: requiredString(project['name']),
      currencyCode: requiredString(project['currencyCode']),
    },
    projectItems: response['projectItems'].map(itemOption),
    events: response['events'].map(event),
  };
}

export function formatRealizedMoney(value: string, currencyCode: string): string {
  const [integer = '0', fraction = ''] = value.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  const symbol = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value;
  return `${symbol ?? currencyCode} ${grouped},${fraction.padEnd(2, '0').slice(0, 2)}`;
}

export function realizedStatusLabel(statusValue: RealizedEventStatus): string {
  return { draft: 'Rascunho', posted: 'Publicado', cancelled: 'Cancelado' }[statusValue];
}

export function realizedEventActions(
  statusValue: RealizedEventStatus,
): readonly RealizedEventAction[] {
  if (statusValue === 'draft') return ['edit', 'publish', 'cancel'];
  if (statusValue === 'posted') return ['edit', 'cancel'];
  return [];
}
