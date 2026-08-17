import { sha256Canonical } from './canonical-json.js';
import type { P012ExistingItemsSnapshot } from './types.js';

export const P012_SOURCE_LINE_KEY_CONTRACT = 'ltcm.p012.source-line-key.v1' as const;
export const P012_ITEM_CANDIDATE_CONTRACT = 'ltcm.p012.item-candidate.v1' as const;
export const P012_EXISTING_ITEMS_SNAPSHOT_CONTRACT =
  'ltcm.p012.existing-items-snapshot.v1' as const;

const SOURCE_LINE_KEY = /^p012-item-v1:[0-9a-f]{64}$/u;
const ITEM_CANDIDATE_ID = /^item-[0-9a-f]{24}$/u;
const PROJECT_CANDIDATE_ID = /^project-[0-9a-f]{24}$/u;
const PROJECT_CODE = /^\d{4}-\d{2}-\d{5}$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const INTEGER = /^(?:0|[1-9]\d*)$/u;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/u;
const FORBIDDEN_UNICODE = /[\p{Cc}\p{Cf}]/u;
const MAX_LINE_NUMBER = 2_147_483_647;

export type P012UnitCode = 'UN' | 'SERV' | 'US';

export interface ScaledDecimal {
  canonical: string;
  scaled: bigint;
}

function trimAsciiSpaces(value: string): string {
  return value.replace(/^ +| +$/gu, '');
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  label: string,
): void {
  const expected = new Set(required);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_LINE_NUMBER
  ) {
    throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  }
  return value;
}

function nullableDeletedAt(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  }
  return value;
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, label);
  if (!UUID.test(parsed)) throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  return parsed;
}

function currency(value: unknown, label: string): string {
  const parsed = requiredString(value, label);
  if (!CURRENCY.test(parsed)) throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  return parsed;
}

function canonicalOptionalText(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || normalizeOptionalItemText(value, label) !== value) {
    throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  }
  return value;
}

export function normalizeOptionalItemText(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`P012_TEXT_INVALID: ${label}.`);
  const normalizedUnicode = value.normalize('NFC');
  if (FORBIDDEN_UNICODE.test(normalizedUnicode)) {
    throw new Error(`P012_TEXT_INVALID: ${label}.`);
  }
  const normalized = trimAsciiSpaces(normalizedUnicode);
  return normalized === '' ? null : normalized;
}

export function parseSourceItemNumber(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
    throw new Error('P012_SOURCE_ITEM_NUMBER_INVALID: monthly_revenue.A.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_LINE_NUMBER) {
    throw new Error('P012_SOURCE_ITEM_NUMBER_INVALID: monthly_revenue.A.');
  }
  return parsed;
}

export function createSourceLineKey(projectCode: string, sourceItemNumber: number): string {
  if (
    FORBIDDEN_UNICODE.test(projectCode) ||
    !PROJECT_CODE.test(projectCode) ||
    projectCode !== projectCode.trim() ||
    !Number.isSafeInteger(sourceItemNumber) ||
    sourceItemNumber <= 0 ||
    sourceItemNumber > MAX_LINE_NUMBER
  ) {
    throw new Error('P012_SOURCE_LINE_KEY_INVALID: preimage.');
  }
  const digest = sha256Canonical({
    contract: P012_SOURCE_LINE_KEY_CONTRACT,
    payload_schema_version: 1,
    project_code: projectCode,
    sheet_key: 'monthly_revenue',
    source_item_number: sourceItemNumber,
  });
  return `p012-item-v1:${digest}`;
}

export function assertSourceLineKey(
  value: unknown,
  projectCode: string,
  sourceItemNumber: number,
): string {
  if (
    typeof value !== 'string' ||
    !SOURCE_LINE_KEY.test(value) ||
    value !== createSourceLineKey(projectCode, sourceItemNumber)
  ) {
    throw new Error('P012_SOURCE_LINE_KEY_INVALID: canonical-key.');
  }
  return value;
}

export function createItemCandidateId(projectCandidateId: string, sourceLineKey: string): string {
  if (!PROJECT_CANDIDATE_ID.test(projectCandidateId) || !SOURCE_LINE_KEY.test(sourceLineKey)) {
    throw new Error('P012_CANDIDATE_ID_INVALID: preimage.');
  }
  return `item-${sha256Canonical({ project_candidate_id: projectCandidateId, source_line_key: sourceLineKey }).slice(0, 24)}`;
}

export function assertItemCandidateId(
  value: unknown,
  projectCandidateId: string,
  sourceLineKey: string,
): string {
  if (
    typeof value !== 'string' ||
    !ITEM_CANDIDATE_ID.test(value) ||
    value !== createItemCandidateId(projectCandidateId, sourceLineKey)
  ) {
    throw new Error('P012_CANDIDATE_ID_INVALID: canonical-id.');
  }
  return value;
}

export function parseScaledDecimal(
  value: unknown,
  scale: number,
  maximumIntegerDigits: number,
  allowZero: boolean,
  label: string,
): ScaledDecimal {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new Error(`P012_DECIMAL_INVALID: ${label}.`);
  }
  const [integer = '', fraction = ''] = value.split('.');
  if (
    integer.length > maximumIntegerDigits ||
    fraction.length > scale ||
    (integer === '0' && fraction !== '' && /^0+$/u.test(fraction) && !allowZero)
  ) {
    throw new Error(`P012_DECIMAL_INVALID: ${label}.`);
  }
  const canonicalFraction = fraction.padEnd(scale, '0');
  const scaled = BigInt(`${integer}${canonicalFraction}`);
  if ((!allowZero && scaled === 0n) || scaled < 0n) {
    throw new Error(`P012_DECIMAL_INVALID: ${label}.`);
  }
  return { canonical: `${integer}.${canonicalFraction}`, scaled };
}

export function parseQuantity(value: unknown): ScaledDecimal {
  return parseScaledDecimal(value, 4, 16, false, 'quantity');
}

export function parseUnitPrice(value: unknown): ScaledDecimal {
  return parseScaledDecimal(value, 4, 16, true, 'unit_price');
}

export function deriveTotalAmount(quantity: ScaledDecimal, unitPrice: ScaledDecimal): string {
  const product = quantity.scaled * unitPrice.scaled;
  const divisor = 1_000_000n;
  const quotient = product / divisor;
  const remainder = product % divisor;
  const rounded = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  const digits = rounded.toString();
  if (digits.length > 20) throw new Error('P012_DECIMAL_INVALID: total_amount overflow.');
  const padded = digits.padStart(3, '0');
  const integer = padded.slice(0, -2);
  if (integer.length > 18) throw new Error('P012_DECIMAL_INVALID: total_amount overflow.');
  return `${integer}.${padded.slice(-2)}`;
}

export function parseTotalAmount(value: unknown): string {
  const parsed = parseScaledDecimal(value, 2, 18, true, 'total_amount');
  return parsed.canonical;
}

export function roundEvidenceAmount(value: unknown): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new Error('P012_DECIMAL_INVALID: total_evidence.');
  }
  const [integer = '', fraction = ''] = value.split('.');
  if (integer.length > 18 || fraction.length > 8) {
    throw new Error('P012_DECIMAL_INVALID: total_evidence.');
  }
  const scale = fraction.length;
  if (scale <= 2) return `${integer}.${fraction.padEnd(2, '0')}`;
  const scaled = BigInt(`${integer}${fraction}`);
  const divisor = 10n ** BigInt(scale - 2);
  const quotient = scaled / divisor;
  const remainder = scaled % divisor;
  const rounded = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  const digits = rounded.toString().padStart(3, '0');
  const resultInteger = digits.slice(0, -2);
  if (resultInteger.length > 18) throw new Error('P012_DECIMAL_INVALID: total_evidence.');
  return `${resultInteger}.${digits.slice(-2)}`;
}

export function normalizeUnit(value: unknown): P012UnitCode {
  if (typeof value !== 'string') throw new Error('P012_UNIT_UNRESOLVED: monthly_revenue.G.');
  const normalizedUnicode = value.normalize('NFC');
  if (FORBIDDEN_UNICODE.test(normalizedUnicode)) {
    throw new Error('P012_UNIT_UNRESOLVED: monthly_revenue.G.');
  }
  const comparison = trimAsciiSpaces(normalizedUnicode).toLocaleLowerCase('und');
  const aliases = new Map<string, P012UnitCode>([
    ['un', 'UN'],
    ['unidade', 'UN'],
    ['serv', 'SERV'],
    ['serviço', 'SERV'],
    ['us', 'US'],
    ['unidade e serviço', 'US'],
  ]);
  const resolved = aliases.get(comparison);
  if (resolved === undefined) throw new Error('P012_UNIT_UNRESOLVED: monthly_revenue.G.');
  return resolved;
}

export function parseCanonicalCurrency(value: unknown, label = 'currency_code'): string {
  if (typeof value !== 'string' || !CURRENCY.test(value)) {
    throw new Error(`P012_CURRENCY_UNRESOLVED: ${label}.`);
  }
  return value;
}

function parseCatalogEntry(
  value: unknown,
  label: string,
  kind: 'currency' | 'unit',
): { code: string; active: boolean } {
  const entry = record(value, label);
  exactKeys(entry, ['code', 'active'], label);
  const code =
    kind === 'currency'
      ? currency(entry['code'], `${label}.code`)
      : normalizeUnit(requiredString(entry['code'], `${label}.code`));
  if (entry['code'] !== code) throw new Error(`P012_SNAPSHOT_INVALID: ${label}.code.`);
  return { code, active: requiredBoolean(entry['active'], `${label}.active`) };
}

function parseP012ExistingItemsSnapshotInternal(value: unknown): P012ExistingItemsSnapshot {
  const snapshot = record(value, 'existing-items-snapshot');
  exactKeys(snapshot, ['contract', 'currencies', 'units', 'projects', 'items'], 'snapshot');
  if (snapshot['contract'] !== P012_EXISTING_ITEMS_SNAPSHOT_CONTRACT) {
    throw new Error('P012_SNAPSHOT_INVALID: contract.');
  }
  if (
    !Array.isArray(snapshot['currencies']) ||
    !Array.isArray(snapshot['units']) ||
    !Array.isArray(snapshot['projects']) ||
    !Array.isArray(snapshot['items'])
  ) {
    throw new Error('P012_SNAPSHOT_INVALID: arrays.');
  }
  const currencies = snapshot['currencies'].map((entry, index) =>
    parseCatalogEntry(entry, `currencies[${index}]`, 'currency'),
  );
  const units = snapshot['units'].map((entry, index) =>
    parseCatalogEntry(entry, `units[${index}]`, 'unit'),
  ) as P012ExistingItemsSnapshot['units'];
  const projects = snapshot['projects'].map((value, index) => {
    const label = `projects[${index}]`;
    const project = record(value, label);
    exactKeys(
      project,
      ['id', 'project_candidate_id', 'project_code', 'currency_code', 'active', 'deleted_at'],
      label,
    );
    const projectCandidateId = requiredString(
      project['project_candidate_id'],
      `${label}.project_candidate_id`,
    );
    const projectCode = requiredString(project['project_code'], `${label}.project_code`);
    if (
      !PROJECT_CANDIDATE_ID.test(projectCandidateId) ||
      FORBIDDEN_UNICODE.test(projectCode) ||
      !PROJECT_CODE.test(projectCode)
    ) {
      throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
    }
    return {
      id: uuid(project['id'], `${label}.id`),
      project_candidate_id: projectCandidateId,
      project_code: projectCode,
      currency_code: currency(project['currency_code'], `${label}.currency_code`),
      active: requiredBoolean(project['active'], `${label}.active`),
      deleted_at: nullableDeletedAt(project['deleted_at'], `${label}.deleted_at`),
    };
  });
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const items = snapshot['items'].map((value, index) => {
    const label = `items[${index}]`;
    const item = record(value, label);
    exactKeys(
      item,
      [
        'id',
        'project_id',
        'source_line_key',
        'line_number',
        'item_code',
        'description',
        'quantity',
        'unit_code',
        'currency_code',
        'unit_price',
        'total_amount',
        'active',
        'deleted_at',
        'row_version',
      ],
      label,
    );
    const projectId = uuid(item['project_id'], `${label}.project_id`);
    const project = projectById.get(projectId);
    if (project === undefined) throw new Error(`P012_SNAPSHOT_INVALID: ${label}.project_id.`);
    const lineNumber = positiveInteger(item['line_number'], `${label}.line_number`);
    const quantityText = requiredString(item['quantity'], `${label}.quantity`);
    const unitPriceText = requiredString(item['unit_price'], `${label}.unit_price`);
    const totalAmountText = requiredString(item['total_amount'], `${label}.total_amount`);
    const quantity = parseQuantity(quantityText);
    const unitPrice = parseUnitPrice(unitPriceText);
    const totalAmount = parseTotalAmount(totalAmountText);
    const sourceLineKey = assertSourceLineKey(
      item['source_line_key'],
      project.project_code,
      lineNumber,
    );
    const unitCode = normalizeUnit(requiredString(item['unit_code'], `${label}.unit_code`));
    if (
      unitCode !== item['unit_code'] ||
      quantity.canonical !== quantityText ||
      unitPrice.canonical !== unitPriceText ||
      totalAmount !== totalAmountText ||
      totalAmount !== deriveTotalAmount(quantity, unitPrice)
    ) {
      throw new Error(`P012_SNAPSHOT_INVALID: ${label}.derived-fields.`);
    }
    const currencyCode = currency(item['currency_code'], `${label}.currency_code`);
    if (currencyCode !== project.currency_code) {
      throw new Error(`P012_SNAPSHOT_INVALID: ${label}.currency_code.`);
    }
    return {
      id: uuid(item['id'], `${label}.id`),
      project_id: projectId,
      source_line_key: sourceLineKey,
      line_number: lineNumber,
      item_code: canonicalOptionalText(item['item_code'], `${label}.item_code`),
      description: canonicalOptionalText(item['description'], `${label}.description`),
      quantity: quantity.canonical,
      unit_code: unitCode,
      currency_code: currencyCode,
      unit_price: unitPrice.canonical,
      total_amount: totalAmount,
      active: requiredBoolean(item['active'], `${label}.active`),
      deleted_at: nullableDeletedAt(item['deleted_at'], `${label}.deleted_at`),
      row_version: positiveSafeInteger(item['row_version'], `${label}.row_version`),
    };
  });

  const unique = (values: string[], label: string): void => {
    if (new Set(values).size !== values.length) throw new Error(`P012_SNAPSHOT_INVALID: ${label}.`);
  };
  unique(
    currencies.map(({ code }) => code),
    'currency-duplicate',
  );
  unique(
    units.map(({ code }) => code),
    'unit-duplicate',
  );
  unique(
    projects.map(({ id }) => id),
    'project-id-duplicate',
  );
  unique(
    projects.map(({ project_candidate_id }) => project_candidate_id),
    'project-ref-duplicate',
  );
  unique(
    projects.map(({ project_code }) => project_code),
    'project-code-duplicate',
  );
  unique([...projects.map(({ id }) => id), ...items.map(({ id }) => id)], 'target-id-duplicate');
  unique(
    items.map(({ project_id, source_line_key }) => `${project_id}\u0000${source_line_key}`),
    'source-line-key-duplicate',
  );
  unique(
    items.map(({ project_id, line_number }) => `${project_id}\u0000${line_number}`),
    'line-number-duplicate',
  );
  for (const project of projects) {
    if (!currencies.some(({ code }) => code === project.currency_code)) {
      throw new Error('P012_SNAPSHOT_INVALID: project-currency-catalog.');
    }
  }
  currencies.sort((left, right) => left.code.localeCompare(right.code, 'en'));
  units.sort((left, right) => left.code.localeCompare(right.code, 'en'));
  projects.sort((left, right) => left.id.localeCompare(right.id, 'en'));
  items.sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return structuredClone({
    contract: P012_EXISTING_ITEMS_SNAPSHOT_CONTRACT,
    currencies,
    units,
    projects,
    items,
  }) as P012ExistingItemsSnapshot;
}

export function parseP012ExistingItemsSnapshot(value: unknown): P012ExistingItemsSnapshot {
  try {
    return parseP012ExistingItemsSnapshotInternal(value);
  } catch {
    throw new Error('P012_SNAPSHOT_INVALID: closed-contract.');
  }
}

export function emptyP012ExistingItemsSnapshot(): P012ExistingItemsSnapshot {
  return {
    contract: P012_EXISTING_ITEMS_SNAPSHOT_CONTRACT,
    currencies: [{ code: 'BRL', active: true }],
    units: [
      { code: 'UN', active: true },
      { code: 'SERV', active: true },
      { code: 'US', active: true },
    ],
    projects: [],
    items: [],
  };
}

export function assertSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`P012_CANDIDATE_HASH_MISMATCH: ${label}.`);
  }
  return value;
}

export function assertCanonicalIntegerRepresentation(value: unknown, label: string): string {
  if (typeof value !== 'string' || !INTEGER.test(value)) {
    throw new Error(`P012_SOURCE_ITEM_NUMBER_INVALID: ${label}.`);
  }
  return value;
}
