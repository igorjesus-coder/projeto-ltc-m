export const P029_MONTHLY_PLANNING_CONTRACT = 'ltcm.p029.monthly-planning-editor.v1' as const;

export interface PlanningProjectOption {
  readonly projectId: string;
  readonly code: string;
  readonly name: string;
  readonly currencyCode: string;
  readonly status: string;
}

export interface PlanningProjectsResponse {
  readonly contract: typeof P029_MONTHLY_PLANNING_CONTRACT;
  readonly projects: readonly PlanningProjectOption[];
}

export interface PlanningVersionOption {
  readonly versionId: string;
  readonly name: string;
  readonly status: string;
  readonly rowVersion: number;
  readonly contentRevision: number;
  readonly editable: boolean;
  readonly isBaseline: boolean;
}

export interface PlanningVersionsResponse {
  readonly contract: typeof P029_MONTHLY_PLANNING_CONTRACT;
  readonly projectId: string;
  readonly versions: readonly PlanningVersionOption[];
}

export interface PlanningCompetence {
  readonly value: string;
  readonly label: string;
}

export interface PlanningItem {
  readonly itemId: string;
  readonly sourceLineKey: string;
  readonly itemCode: string | null;
  readonly description: string | null;
  readonly lineNumber: number;
  readonly active: boolean;
}

export interface PlanningEntry {
  readonly itemId: string;
  readonly competence: string;
  readonly amount: string;
  readonly rowVersion: number;
}

export interface PlanningMonthEntryPayload {
  readonly itemId: string;
  readonly competence: string;
  readonly amount: string;
}

export interface PlanningEditorResponse {
  readonly contract: typeof P029_MONTHLY_PLANNING_CONTRACT;
  readonly project: PlanningProjectOption;
  readonly version: PlanningVersionOption;
  readonly competences: readonly PlanningCompetence[];
  readonly items: readonly PlanningItem[];
  readonly entries: readonly PlanningEntry[];
  readonly projectTotals: readonly { readonly competence: string; readonly amount: string }[];
  readonly range: { readonly from: string | null; readonly to: string | null };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('P029_RESPONSE_INVALID');
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('P029_RESPONSE_INVALID');
  return value;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('P029_RESPONSE_INVALID');
  return value;
}

function option(value: unknown): PlanningProjectOption {
  const item = record(value);
  return {
    projectId: requiredString(item['projectId']),
    code: requiredString(item['code']),
    name: requiredString(item['name']),
    currencyCode: requiredString(item['currencyCode']),
    status: requiredString(item['status']),
  };
}

function version(value: unknown): PlanningVersionOption {
  const item = record(value);
  if (typeof item['editable'] !== 'boolean' || typeof item['isBaseline'] !== 'boolean')
    throw new Error('P029_RESPONSE_INVALID');
  return {
    versionId: requiredString(item['versionId']),
    name: requiredString(item['name']),
    status: requiredString(item['status']),
    rowVersion: positiveInteger(item['rowVersion']),
    contentRevision: positiveInteger(item['contentRevision']),
    editable: item['editable'],
    isBaseline: item['isBaseline'],
  };
}

function competence(value: unknown): PlanningCompetence {
  const item = record(value);
  return { value: requiredString(item['value']), label: requiredString(item['label']) };
}

function planningItem(value: unknown): PlanningItem {
  const item = record(value);
  if (item['itemCode'] !== null && typeof item['itemCode'] !== 'string')
    throw new Error('P029_RESPONSE_INVALID');
  if (item['description'] !== null && typeof item['description'] !== 'string')
    throw new Error('P029_RESPONSE_INVALID');
  if (typeof item['active'] !== 'boolean') throw new Error('P029_RESPONSE_INVALID');
  return {
    itemId: requiredString(item['itemId']),
    sourceLineKey: requiredString(item['sourceLineKey']),
    itemCode: item['itemCode'] as string | null,
    description: item['description'] as string | null,
    lineNumber: positiveInteger(item['lineNumber']),
    active: item['active'],
  };
}

function entry(value: unknown): PlanningEntry {
  const item = record(value);
  return {
    itemId: requiredString(item['itemId']),
    competence: requiredString(item['competence']),
    amount: requiredString(item['amount']),
    rowVersion: positiveInteger(item['rowVersion']),
  };
}

export function parsePlanningProjectsResponse(value: unknown): PlanningProjectsResponse {
  const response = record(value);
  if (
    response['contract'] !== P029_MONTHLY_PLANNING_CONTRACT ||
    !Array.isArray(response['projects'])
  )
    throw new Error('P029_RESPONSE_INVALID');
  return { contract: P029_MONTHLY_PLANNING_CONTRACT, projects: response['projects'].map(option) };
}

export function parsePlanningVersionsResponse(value: unknown): PlanningVersionsResponse {
  const response = record(value);
  if (
    response['contract'] !== P029_MONTHLY_PLANNING_CONTRACT ||
    !Array.isArray(response['versions'])
  )
    throw new Error('P029_RESPONSE_INVALID');
  return {
    contract: P029_MONTHLY_PLANNING_CONTRACT,
    projectId: requiredString(response['projectId']),
    versions: response['versions'].map(version),
  };
}

export function parsePlanningEditorResponse(value: unknown): PlanningEditorResponse {
  const response = record(value);
  if (
    response['contract'] !== P029_MONTHLY_PLANNING_CONTRACT ||
    !Array.isArray(response['competences']) ||
    !Array.isArray(response['items']) ||
    !Array.isArray(response['entries']) ||
    !Array.isArray(response['projectTotals'])
  )
    throw new Error('P029_RESPONSE_INVALID');
  const range = record(response['range']);
  return {
    contract: P029_MONTHLY_PLANNING_CONTRACT,
    project: option(response['project']),
    version: version(response['version']),
    competences: response['competences'].map(competence),
    items: response['items'].map(planningItem),
    entries: response['entries'].map(entry),
    projectTotals: response['projectTotals'].map((value) => {
      const item = record(value);
      return {
        competence: requiredString(item['competence']),
        amount: requiredString(item['amount']),
      };
    }),
    range: {
      from: range['from'] === null ? null : requiredString(range['from']),
      to: range['to'] === null ? null : requiredString(range['to']),
    },
  };
}

export function decimalToCents(value: string): bigint | null {
  if (value.trim() === '') return 0n;
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/u.test(value)) return null;
  const [integer, fraction = ''] = value.split('.');
  return BigInt(integer ?? '0') * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function formatCents(value: bigint, signed = false): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : signed ? '+' : ''}${(absolute / 100n).toString()}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function moneyLabel(value: bigint, currency: string): string {
  const [integer = '0', fraction = '00'] = formatCents(value).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  const symbol = new Intl.NumberFormat('pt-BR', { style: 'currency', currency })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value;
  return `${symbol ?? currency} ${grouped},${fraction}`;
}

export function planningCellKey(itemId: string, competence: string): string {
  return `${itemId}\u0000${competence}`;
}

export function buildPlanningEntries(
  data: PlanningEditorResponse,
  values: Readonly<Record<string, string>>,
  original: Readonly<Record<string, string>>,
): readonly PlanningMonthEntryPayload[] {
  return data.items.flatMap((item) =>
    data.competences.flatMap((competence) => {
      const key = planningCellKey(item.itemId, competence.value);
      if ((values[key] ?? '') === (original[key] ?? '')) return [];
      const value = values[key] ?? '';
      const parsed = decimalToCents(value);
      return parsed === null || value.trim() === ''
        ? [{ itemId: item.itemId, competence: competence.value, amount: '' }]
        : [{ itemId: item.itemId, competence: competence.value, amount: formatCents(parsed) }];
    }),
  );
}
