import * as XLSX from 'xlsx';

import { sha256Canonical } from './canonical-json.js';
import type { StagingRowArtifact } from './types.js';
import type { WorksheetPackageMetadata } from './workbook-package.js';

export const P013_MONTHLY_SOURCE_SEMANTIC_CONTRACT =
  'ltcm.p013.monthly-source-semantic.v1' as const;

// Filled from the D01A-approved semantic payload. Artifact SHA is deliberately absent.
export const P013_D01A_MONTHLY_SOURCE_SEMANTIC_FINGERPRINT =
  'a02215599f1a4762e8dcfc747c13537bce76b3c3909f43fb92efe54e8ab3ffa0';

const EXPECTED_HEADERS: Readonly<Record<string, string | null>> = Object.freeze({
  A: 'Item',
  B: 'Projeto LTC-M',
  C: 'Cliente',
  D: 'Código',
  E: 'Descrição',
  F: 'Quantidade',
  G: 'UN',
  H: 'Moeda',
  I: 'Preço Unitário',
  J: 'Preço Total',
  T: null,
});
const EXPECTED_COMPETENCIES = Object.freeze([
  '2026-07-01',
  '2026-08-01',
  '2026-09-01',
  '2026-10-01',
  '2026-11-01',
  '2026-12-01',
  '2027-01-01',
  '2027-02-01',
  '2027-03-01',
]);
const MONTHLY_COLUMNS = Object.freeze(['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S']);
const DECIMAL = /^(0|[1-9]\d*)(?:\.(\d{1,14}))?$/u;

interface SourceSemanticCell {
  project_code: string;
  source_item_number: string;
  competence_month: string;
  declaration_state: 'blank' | 'explicit_zero' | 'value';
  canonical_amount: string | null;
}

export interface P013MonthlySourceCellFacts extends SourceSemanticCell {
  worksheet_key: 'monthly_revenue';
  worksheet_name: 'Prev. Receita Mensal';
  source_row_number: number;
  source_column: 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S';
  source_cell_reference: string;
  source_row_hash: string;
  source_numeric_text: string | null;
  source_value_hash: string | null;
  source_item_total_numeric_text: string | null;
  source_item_total_canonical_amount: string | null;
  source_state: 'blank' | 'value' | 'formula';
  formula_present: boolean;
  cached_result_present: boolean;
  source_cell_fingerprint: string;
}

export interface P013MonthlySourceGateResult {
  contract: typeof P013_MONTHLY_SOURCE_SEMANTIC_CONTRACT;
  ok: boolean;
  diagnostics: string[];
  semantic_fingerprint: string | null;
  cell_count: number;
  blank_count: number;
  explicit_zero_count: number;
  non_zero_count: number;
  canonical_total: string | null;
  aggregate_raw_rounded_total: string | null;
  rounding_residual: string | null;
}

function rowCell(rows: readonly StagingRowArtifact[], address: string) {
  const rowNumber = XLSX.utils.decode_cell(address).r + 1;
  return rows
    .find((row) => row.source_row_number === rowNumber)
    ?.raw_payload.cells.find((candidate) => candidate.address === address);
}

function projectCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().match(/^\d{4}-\d{2}-\d{5}/u)?.[0] ?? null;
}

function canonicalMoney(rawDecimal: string): string | null {
  const matched = DECIMAL.exec(rawDecimal);
  if (matched === null) return null;
  let integer = matched[1] ?? '0';
  const fraction = matched[2] ?? '';
  let cents = fraction.padEnd(2, '0').slice(0, 2);
  if (fraction.length > 2 && fraction[2]! >= '5') {
    const rounded = BigInt(cents) + 1n;
    if (rounded === 100n) {
      integer = (BigInt(integer) + 1n).toString();
      cents = '00';
    } else {
      cents = rounded.toString().padStart(2, '0');
    }
  }
  if (integer.length > 18) return null;
  return `${integer}.${cents}`;
}

function scaled14(rawDecimal: string): bigint | null {
  const matched = DECIMAL.exec(rawDecimal);
  if (matched === null) return null;
  const integer = matched[1] ?? '0';
  const fraction = (matched[2] ?? '').padEnd(14, '0');
  return BigInt(integer) * 100_000_000_000_000n + BigInt(fraction);
}

function centsFromScaled14(value: bigint): bigint {
  return (value + 500_000_000_000n) / 1_000_000_000_000n;
}

function moneyFromCents(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function sortedCells(cells: SourceSemanticCell[]): SourceSemanticCell[] {
  return cells.sort((left, right) =>
    [left.project_code, left.source_item_number.padStart(10, '0'), left.competence_month]
      .join('\u0000')
      .localeCompare(
        [
          right.project_code,
          right.source_item_number.padStart(10, '0'),
          right.competence_month,
        ].join('\u0000'),
        'en',
      ),
  );
}

export function evaluateP013MonthlySource(
  rows: readonly StagingRowArtifact[],
  metadata: WorksheetPackageMetadata | undefined,
): P013MonthlySourceGateResult {
  const diagnostics: string[] = [];
  const rowNumbers = rows.map((row) => row.source_row_number);
  if (rows.length !== 52 || !rowNumbers.every((rowNumber, index) => rowNumber === index + 1)) {
    diagnostics.push('P013_SOURCE_ROW_BOUNDARY');
  }
  for (const [column, expected] of Object.entries(EXPECTED_HEADERS)) {
    const value = rowCell(rows, `${column}3`)?.value ?? null;
    if (value !== expected) diagnostics.push(`P013_SOURCE_HEADER_${column}`);
  }
  const competencies = MONTHLY_COLUMNS.map(
    (column) => rowCell(rows, `${column}3`)?.date_iso ?? null,
  );
  if (JSON.stringify(competencies) !== JSON.stringify(EXPECTED_COMPETENCIES)) {
    diagnostics.push('P013_SOURCE_COMPETENCIES');
  }
  if (metadata === undefined) diagnostics.push('P013_SOURCE_PACKAGE_METADATA');
  for (const [address, packageCell] of metadata?.cells ?? []) {
    const decoded = XLSX.utils.decode_cell(address);
    if (packageCell.material && (decoded.r + 1 > 52 || decoded.c + 1 > 20)) {
      diagnostics.push('P013_SOURCE_EXTRA_MATERIAL_CELL');
      break;
    }
  }

  const semanticCells: SourceSemanticCell[] = [];
  const itemKeys = new Set<string>();
  let blankCount = 0;
  let explicitZeroCount = 0;
  let nonZeroCount = 0;
  let canonicalCents = 0n;
  let rawScaledTotal = 0n;
  for (let rowNumber = 4; rowNumber <= 51; rowNumber += 1) {
    const itemCell = rowCell(rows, `A${rowNumber}`);
    const itemText = itemCell?.round_trip_text ?? null;
    const code = projectCode(rowCell(rows, `B${rowNumber}`)?.value);
    if (itemText === null || !/^[1-9]\d*$/u.test(itemText) || code === null) {
      diagnostics.push('P013_SOURCE_ITEM_IDENTITY');
      continue;
    }
    const itemKey = `${code}\u0000${itemText}`;
    if (itemKeys.has(itemKey)) diagnostics.push('P013_SOURCE_DUPLICATE_ITEM_IDENTITY');
    itemKeys.add(itemKey);
    for (let index = 0; index < MONTHLY_COLUMNS.length; index += 1) {
      const column = MONTHLY_COLUMNS[index]!;
      const address = `${column}${rowNumber}`;
      const candidate = rowCell(rows, address);
      const packageCell = metadata?.cells.get(address);
      const competence = EXPECTED_COMPETENCIES[index]!;
      if (candidate === undefined || packageCell === undefined || !candidate.record_present) {
        diagnostics.push('P013_SOURCE_MISSING_MONTHLY_CELL');
        continue;
      }
      if (candidate.state === 'blank') {
        if (packageCell.material) diagnostics.push('P013_SOURCE_BLANK_MATERIAL_MISMATCH');
        blankCount += 1;
        semanticCells.push({
          project_code: code,
          source_item_number: itemText,
          competence_month: competence,
          declaration_state: 'blank',
          canonical_amount: null,
        });
        continue;
      }
      if (
        !['value', 'formula'].includes(candidate.state) ||
        candidate.data_type !== 'number' ||
        packageCell.valueText === null ||
        (candidate.state === 'formula' && candidate.cached_result_present !== true)
      ) {
        diagnostics.push('P013_SOURCE_INVALID_MONTHLY_VALUE');
        continue;
      }
      const canonicalAmount = canonicalMoney(packageCell.valueText);
      const rawAmount = scaled14(packageCell.valueText);
      if (canonicalAmount === null || rawAmount === null) {
        diagnostics.push('P013_SOURCE_INVALID_DECIMAL');
        continue;
      }
      const [integer, cents = '00'] = canonicalAmount.split('.');
      canonicalCents += BigInt(integer ?? '0') * 100n + BigInt(cents);
      rawScaledTotal += rawAmount;
      const zero = canonicalAmount === '0.00';
      if (zero) explicitZeroCount += 1;
      else nonZeroCount += 1;
      semanticCells.push({
        project_code: code,
        source_item_number: itemText,
        competence_month: competence,
        declaration_state: zero ? 'explicit_zero' : 'value',
        canonical_amount: canonicalAmount,
      });
    }
  }
  if (semanticCells.length !== 432) diagnostics.push('P013_SOURCE_MONTHLY_CELL_COUNT');
  for (let index = 0; index < MONTHLY_COLUMNS.length; index += 1) {
    const address = `${MONTHLY_COLUMNS[index]}52`;
    const candidate = rowCell(rows, address);
    const packageCell = metadata?.cells.get(address);
    const cachedTotal =
      packageCell?.valueText === null || packageCell?.valueText === undefined
        ? null
        : canonicalMoney(packageCell.valueText);
    if (
      candidate?.state !== 'formula' ||
      candidate.cached_result_present !== true ||
      packageCell?.formulaPresent !== true ||
      cachedTotal === null
    ) {
      diagnostics.push('P013_SOURCE_MONTH_TOTAL_CACHE');
    }
  }
  const aggregateCents = centsFromScaled14(rawScaledTotal);
  const aggregateExpected = moneyFromCents(aggregateCents);
  const aggregateCandidate = rowCell(rows, 'T52');
  const aggregatePackage = metadata?.cells.get('T52');
  if (
    aggregateCandidate?.state !== 'formula' ||
    aggregateCandidate.cached_result_present !== true ||
    aggregatePackage?.formulaPresent !== true ||
    aggregatePackage.valueText === null ||
    canonicalMoney(aggregatePackage.valueText) !== aggregateExpected
  ) {
    diagnostics.push('P013_SOURCE_AGGREGATE_RECONCILIATION');
  }
  const uniqueDiagnostics = [...new Set(diagnostics)].sort();
  const semantic = {
    contract: P013_MONTHLY_SOURCE_SEMANTIC_CONTRACT,
    metric_type: 'billing_planned' as const,
    worksheet_key: 'monthly_revenue' as const,
    cells: sortedCells(semanticCells),
  };
  return Object.freeze({
    contract: P013_MONTHLY_SOURCE_SEMANTIC_CONTRACT,
    ok: uniqueDiagnostics.length === 0,
    diagnostics: Object.freeze(uniqueDiagnostics) as string[],
    semantic_fingerprint: uniqueDiagnostics.length === 0 ? sha256Canonical(semantic) : null,
    cell_count: semanticCells.length,
    blank_count: blankCount,
    explicit_zero_count: explicitZeroCount,
    non_zero_count: nonZeroCount,
    canonical_total: semanticCells.length === 432 ? moneyFromCents(canonicalCents) : null,
    aggregate_raw_rounded_total: semanticCells.length === 432 ? aggregateExpected : null,
    rounding_residual:
      semanticCells.length === 432 ? moneyFromCents(canonicalCents - aggregateCents) : null,
  });
}

export function assertP013MonthlySourceFingerprint(
  result: P013MonthlySourceGateResult,
): P013MonthlySourceGateResult {
  if (!result.ok || result.semantic_fingerprint !== P013_D01A_MONTHLY_SOURCE_SEMANTIC_FINGERPRINT) {
    throw new Error('P013_SOURCE_SEMANTIC_FINGERPRINT_MISMATCH');
  }
  return result;
}

export function materializeP013MonthlySourceCellFacts(
  rows: readonly StagingRowArtifact[],
  metadata: WorksheetPackageMetadata | undefined,
): readonly P013MonthlySourceCellFacts[] {
  assertP013MonthlySourceFingerprint(evaluateP013MonthlySource(rows, metadata));
  if (metadata === undefined) throw new Error('P013_SOURCE_PACKAGE_METADATA');

  const facts: P013MonthlySourceCellFacts[] = [];
  for (let rowNumber = 4; rowNumber <= 51; rowNumber += 1) {
    const row = rows.find((candidate) => candidate.source_row_number === rowNumber);
    const itemText = rowCell(rows, `A${rowNumber}`)?.round_trip_text;
    const code = projectCode(rowCell(rows, `B${rowNumber}`)?.value);
    if (row === undefined || itemText === undefined || code === null) {
      throw new Error('P013_SOURCE_ITEM_IDENTITY');
    }
    const itemTotalNumericText = metadata.cells.get(`J${rowNumber}`)?.valueText ?? null;
    const itemTotalCanonicalAmount =
      itemTotalNumericText === null ? null : canonicalMoney(itemTotalNumericText);
    if (itemTotalNumericText !== null && itemTotalCanonicalAmount === null) {
      throw new Error('P013_SOURCE_INVALID_ITEM_DIAGNOSTIC_TOTAL');
    }
    for (let index = 0; index < MONTHLY_COLUMNS.length; index += 1) {
      const sourceColumn = MONTHLY_COLUMNS[index] as P013MonthlySourceCellFacts['source_column'];
      const sourceCellReference = `${sourceColumn}${rowNumber}`;
      const cell = rowCell(rows, sourceCellReference);
      const packageCell = metadata.cells.get(sourceCellReference);
      if (cell === undefined || packageCell === undefined) {
        throw new Error('P013_SOURCE_MISSING_MONTHLY_CELL');
      }
      const sourceNumericText = cell.state === 'blank' ? null : packageCell.valueText;
      const canonicalAmount = sourceNumericText === null ? null : canonicalMoney(sourceNumericText);
      if (cell.state !== 'blank' && canonicalAmount === null) {
        throw new Error('P013_SOURCE_INVALID_DECIMAL');
      }
      const declarationState: P013MonthlySourceCellFacts['declaration_state'] =
        canonicalAmount === null ? 'blank' : canonicalAmount === '0.00' ? 'explicit_zero' : 'value';
      const valueHash =
        sourceNumericText === null
          ? null
          : sha256Canonical({
              contract: 'ltcm.p013.monthly-source-value.v1',
              source_numeric_text: sourceNumericText,
            });
      const material = {
        project_code: code,
        source_item_number: itemText,
        competence_month: EXPECTED_COMPETENCIES[index]!,
        declaration_state: declarationState,
        canonical_amount: canonicalAmount,
        worksheet_key: 'monthly_revenue' as const,
        worksheet_name: 'Prev. Receita Mensal' as const,
        source_row_number: rowNumber,
        source_column: sourceColumn,
        source_cell_reference: sourceCellReference,
        source_row_hash: row.row_hash,
        source_numeric_text: sourceNumericText,
        source_value_hash: valueHash,
        source_item_total_numeric_text: itemTotalNumericText,
        source_item_total_canonical_amount: itemTotalCanonicalAmount,
        source_state: cell.state as 'blank' | 'value' | 'formula',
        formula_present: packageCell.formulaPresent,
        cached_result_present: cell.cached_result_present === true,
      };
      facts.push(
        Object.freeze({
          ...material,
          source_cell_fingerprint: sha256Canonical({
            contract: 'ltcm.p013.monthly-source-cell.v1',
            ...material,
          }),
        }),
      );
    }
  }
  return Object.freeze(facts);
}
