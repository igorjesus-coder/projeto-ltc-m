import * as XLSX from 'xlsx';

import { sha256Canonical } from './canonical-json.js';
import { canonicalizeP013FinancialDecimal } from './p013-source-gate.js';
import type { StagingRowArtifact } from './types.js';
import type { WorksheetPackageMetadata } from './workbook-package.js';

export const P014_REALIZED_SOURCE_SEMANTIC_CONTRACT =
  'ltcm.p014.realized-source-semantic.v1' as const;

// Frozen from the approved P014 D01 source evidence. Artifact SHA is intentionally separate.
export const P014_D01_REALIZED_SOURCE_SEMANTIC_FINGERPRINT =
  '1af436b98a170dfd540c1f712455cd82b37f61441bd328f9f6fd853ce491a19e';

const PROJECT_COLUMNS = Object.freeze(['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);
const MONTH_COLUMNS = Object.freeze(['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);
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
const PROJECT_CODE = /^\d{4}-\d{2}-\d{5}/u;

export interface P014DocumentaryRealizedEvidence {
  worksheet_name: 'Decisões Aprovadas';
  structural_range: string | null;
  realized_topic: string | null;
  realized_meaning: string | null;
  realized_workbook_effect: string | null;
  realized_system_effect: string | null;
  realized_status: string | null;
  closed_project_topic: string | null;
  closed_project_meaning: string | null;
  closed_project_system_effect: string | null;
}

export type P014RealizedDeclarationState = 'blank' | 'explicit_zero' | 'value';
export type P014RealizedAuthoritativeGrain = 'project_aggregate' | 'portfolio_month';

export interface P014RealizedSourcePosition {
  authoritative_grain: P014RealizedAuthoritativeGrain;
  metric_type: 'billing_actual';
  project_code: string | null;
  competence_month: string | null;
  item_identity: null;
  currency_code: 'BRL';
  declaration_state: P014RealizedDeclarationState;
  source_status:
    'source_declared_faturado_data_updating' | 'source_declared_manual_realized_monthly';
  worksheet_key: 'project_values' | 'curve_s';
  worksheet_name: 'Valores Projetos LTC-M' | 'Curva S';
  source_row_number: 4 | 12;
  source_column: string;
  source_cell_reference: string;
  source_row_hash: string;
  source_numeric_text: string | null;
  canonical_amount: string | null;
  source_state: 'blank' | 'value' | 'formula';
  formula_text: string | null;
  formula_present: boolean;
  cached_result_present: boolean;
  source_value_hash: string | null;
  source_position_fingerprint: string;
}

export interface P014RealizedSourceGateInput {
  project_rows: readonly StagingRowArtifact[];
  monthly_rows: readonly StagingRowArtifact[];
  curve_rows: readonly StagingRowArtifact[];
  package_metadata: ReadonlyMap<string, WorksheetPackageMetadata>;
  documentary: P014DocumentaryRealizedEvidence;
}

export interface P014RealizedSourceGateResult {
  contract: typeof P014_REALIZED_SOURCE_SEMANTIC_CONTRACT;
  ok: boolean;
  diagnostics: readonly string[];
  semantic_fingerprint: string | null;
  positions: readonly P014RealizedSourcePosition[];
  position_count: number;
  fact_count: number;
  blank_count: number;
  explicit_zero_count: number;
  non_zero_count: number;
  project_aggregate_total: string | null;
  portfolio_month_total: string | null;
}

function rowCell(rows: readonly StagingRowArtifact[], address: string) {
  const rowNumber = XLSX.utils.decode_cell(address).r + 1;
  return rows
    .find((row) => row.source_row_number === rowNumber)
    ?.raw_payload.cells.find((cell) => cell.address === address);
}

function rowHash(rows: readonly StagingRowArtifact[], rowNumber: number): string | null {
  return rows.find((row) => row.source_row_number === rowNumber)?.row_hash ?? null;
}

function projectCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().match(PROJECT_CODE)?.[0] ?? null;
}

function cents(value: string): bigint {
  const [integer = '0', fraction = '00'] = value.split('.');
  return BigInt(integer) * 100n + BigInt(fraction);
}

function money(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

function exactRows(rows: readonly StagingRowArtifact[], count: number): boolean {
  return rows.length === count && rows.every((row, index) => row.source_row_number === index + 1);
}

function position(
  value: Omit<P014RealizedSourcePosition, 'source_value_hash' | 'source_position_fingerprint'>,
): P014RealizedSourcePosition {
  const sourceValueHash =
    value.source_numeric_text === null
      ? null
      : sha256Canonical({
          contract: 'ltcm.p014.realized-source-value.v1',
          source_numeric_text: value.source_numeric_text,
          canonical_amount: value.canonical_amount,
        });
  const material = { ...value, source_value_hash: sourceValueHash };
  return Object.freeze({
    ...material,
    source_position_fingerprint: sha256Canonical({
      contract: 'ltcm.p014.realized-source-position.v1',
      ...material,
    }),
  });
}

function semanticPosition(candidate: P014RealizedSourcePosition) {
  return {
    authoritative_grain: candidate.authoritative_grain,
    metric_type: candidate.metric_type,
    project_code: candidate.project_code,
    competence_month: candidate.competence_month,
    item_identity: candidate.item_identity,
    currency_code: candidate.currency_code,
    declaration_state: candidate.declaration_state,
    source_status: candidate.source_status,
    worksheet_key: candidate.worksheet_key,
    worksheet_name: candidate.worksheet_name,
    source_row_number: candidate.source_row_number,
    source_column: candidate.source_column,
    source_cell_reference: candidate.source_cell_reference,
    source_numeric_text: candidate.source_numeric_text,
    canonical_amount: candidate.canonical_amount,
    source_state: candidate.source_state,
    formula_text: candidate.formula_text,
    formula_present: candidate.formula_present,
    cached_result_present: candidate.cached_result_present,
  };
}

function verifyDocumentaryEvidence(
  documentary: P014DocumentaryRealizedEvidence,
  diagnostics: string[],
): void {
  const expected: Omit<P014DocumentaryRealizedEvidence, 'structural_range'> = {
    worksheet_name: 'Decisões Aprovadas',
    realized_topic: 'Curva S — Realizado Mensal',
    realized_meaning: 'Valor efetivamente faturado no mês.',
    realized_workbook_effect: 'A linha Realizado Mensal deve representar faturamento efetivo.',
    realized_system_effect: 'Métrica principal: billing_actual.',
    realized_status: 'Aprovada',
    closed_project_topic: 'Projeto 2024-02-10990',
    closed_project_meaning:
      'Projeto integralmente faturado e encerrado; valores programados são previsão de recebimento.',
    closed_project_system_effect:
      'Não incluir esses valores na Curva S de faturamento; armazenar como receipt_forecast.',
  };
  if (
    documentary.structural_range !== 'A1:F11' ||
    Object.entries(expected).some(
      ([key, expectedValue]) => documentary[key as keyof typeof expected] !== expectedValue,
    )
  ) {
    diagnostics.push('P014_SOURCE_NORMATIVE_DECISION');
  }
}

function projectPositions(
  input: P014RealizedSourceGateInput,
  diagnostics: string[],
): P014RealizedSourcePosition[] {
  const rows = input.project_rows;
  if (!exactRows(rows, 10)) diagnostics.push('P014_SOURCE_PROJECT_ROW_BOUNDARY');
  if (
    rowCell(rows, 'A2')?.value !== 'PROJETOS LTC-M' ||
    rowCell(rows, 'B2')?.value !== 'TOTAL GERAL' ||
    rowCell(rows, 'A4')?.value !== 'Faturado'
  ) {
    diagnostics.push('P014_SOURCE_PROJECT_HEADER');
  }
  if (rowCell(rows, 'B10')?.value !== 'obs.: Dados em atualização (21/07)') {
    diagnostics.push('P014_SOURCE_PROJECT_STATUS');
  }
  const sourceRowHash = rowHash(rows, 4);
  const metadata = input.package_metadata.get('Valores Projetos LTC-M');
  if (metadata === undefined || sourceRowHash === null) {
    diagnostics.push('P014_SOURCE_PROJECT_PACKAGE_METADATA');
    return [];
  }
  const codes = PROJECT_COLUMNS.map((column) => projectCode(rowCell(rows, `${column}2`)?.value));
  if (codes.some((code) => code === null)) diagnostics.push('P014_SOURCE_PROJECT_IDENTITY');
  if (new Set(codes.filter((code): code is string => code !== null)).size !== codes.length) {
    diagnostics.push('P014_SOURCE_DUPLICATE_PROJECT_IDENTITY');
  }
  const positions: P014RealizedSourcePosition[] = [];
  for (let index = 0; index < PROJECT_COLUMNS.length; index += 1) {
    const column = PROJECT_COLUMNS[index]!;
    const address = `${column}4`;
    const cell = rowCell(rows, address);
    const packageCell = metadata.cells.get(address);
    const code = codes[index];
    if (
      code === null ||
      code === undefined ||
      cell === undefined ||
      packageCell === undefined ||
      !['value', 'formula'].includes(cell.state) ||
      cell.data_type !== 'number' ||
      packageCell.valueText === null ||
      (cell.state === 'formula' &&
        (cell.cached_result_present !== true || packageCell.formulaPresent !== true))
    ) {
      diagnostics.push('P014_SOURCE_PROJECT_VALUE');
      continue;
    }
    if ((column === 'C' && cell.formula !== 'C3') || (column !== 'C' && cell.formula !== null)) {
      diagnostics.push('P014_SOURCE_PROJECT_FORMULA');
    }
    const canonicalAmount = canonicalizeP013FinancialDecimal(packageCell.valueText);
    if (canonicalAmount === null) {
      diagnostics.push('P014_SOURCE_INVALID_DECIMAL');
      continue;
    }
    positions.push(
      position({
        authoritative_grain: 'project_aggregate',
        metric_type: 'billing_actual',
        project_code: code,
        competence_month: null,
        item_identity: null,
        currency_code: 'BRL',
        declaration_state: canonicalAmount === '0.00' ? 'explicit_zero' : 'value',
        source_status: 'source_declared_faturado_data_updating',
        worksheet_key: 'project_values',
        worksheet_name: 'Valores Projetos LTC-M',
        source_row_number: 4,
        source_column: column,
        source_cell_reference: address,
        source_row_hash: sourceRowHash,
        source_numeric_text: packageCell.valueText,
        canonical_amount: canonicalAmount,
        source_state: cell.state as 'value' | 'formula',
        formula_text: cell.formula,
        formula_present: packageCell.formulaPresent,
        cached_result_present: cell.cached_result_present === true,
      }),
    );
  }
  const total = rowCell(rows, 'B4');
  const totalPackage = metadata.cells.get('B4');
  const calculated = positions.reduce(
    (sum, candidate) => sum + cents(candidate.canonical_amount ?? '0.00'),
    0n,
  );
  if (
    total?.formula !== 'SUM(C4:K4)' ||
    total.cached_result_present !== true ||
    totalPackage?.formulaPresent !== true ||
    totalPackage.valueText === null ||
    canonicalizeP013FinancialDecimal(totalPackage.valueText) !== money(calculated)
  ) {
    diagnostics.push('P014_SOURCE_PROJECT_TOTAL_RECONCILIATION');
  }
  return positions;
}

function portfolioMonthPositions(
  input: P014RealizedSourceGateInput,
  diagnostics: string[],
): P014RealizedSourcePosition[] {
  const monthlyRows = input.monthly_rows;
  const rows = input.curve_rows;
  if (!exactRows(monthlyRows, 52) || rowCell(monthlyRows, 'C1')?.value !== 'ITEM FATURADO') {
    diagnostics.push('P014_SOURCE_ITEM_HINT');
  }
  if (!exactRows(rows, 16)) diagnostics.push('P014_SOURCE_CURVE_ROW_BOUNDARY');
  if (
    rowCell(rows, 'B3')?.value !== "Fonte: aba 'Previsão de Receita' (linha Total) | Moeda: BRL" ||
    rowCell(rows, 'B12')?.value !== 'Realizado Mensal (R$)' ||
    rowCell(rows, 'B16')?.value !==
      "Legenda: células em amarelo/azul (linha 'Realizado Mensal') são de preenchimento manual pelo usuário."
  ) {
    diagnostics.push('P014_SOURCE_CURVE_HEADER');
  }
  const competencies = MONTH_COLUMNS.map((column) => rowCell(rows, `${column}7`)?.date_iso ?? null);
  if (JSON.stringify(competencies) !== JSON.stringify(EXPECTED_COMPETENCIES)) {
    diagnostics.push('P014_SOURCE_CURVE_COMPETENCIES');
  }
  for (let index = 0; index < MONTH_COLUMNS.length; index += 1) {
    const column = MONTH_COLUMNS[index]!;
    const expectedFormula = `'Prev. Receita Mensal'!${String.fromCharCode(75 + index)}3`;
    const cell = rowCell(rows, `${column}7`);
    if (cell?.formula !== expectedFormula || cell.cached_result_present !== true) {
      diagnostics.push('P014_SOURCE_CURVE_COMPETENCE_FORMULA');
      break;
    }
  }
  const sourceRowHash = rowHash(rows, 12);
  const metadata = input.package_metadata.get('Curva S');
  if (metadata === undefined || sourceRowHash === null) {
    diagnostics.push('P014_SOURCE_CURVE_PACKAGE_METADATA');
    return [];
  }
  const positions: P014RealizedSourcePosition[] = [];
  for (let index = 0; index < MONTH_COLUMNS.length; index += 1) {
    const column = MONTH_COLUMNS[index]!;
    const address = `${column}12`;
    const cell = rowCell(rows, address);
    const packageCell = metadata.cells.get(address);
    if (cell === undefined || packageCell === undefined || !cell.record_present) {
      diagnostics.push('P014_SOURCE_MISSING_REALIZED_MONTH');
      continue;
    }
    if (cell.state === 'blank') {
      if (packageCell.material) diagnostics.push('P014_SOURCE_BLANK_MATERIAL_MISMATCH');
      positions.push(
        position({
          authoritative_grain: 'portfolio_month',
          metric_type: 'billing_actual',
          project_code: null,
          competence_month: EXPECTED_COMPETENCIES[index]!,
          item_identity: null,
          currency_code: 'BRL',
          declaration_state: 'blank',
          source_status: 'source_declared_manual_realized_monthly',
          worksheet_key: 'curve_s',
          worksheet_name: 'Curva S',
          source_row_number: 12,
          source_column: column,
          source_cell_reference: address,
          source_row_hash: sourceRowHash,
          source_numeric_text: null,
          canonical_amount: null,
          source_state: 'blank',
          formula_text: null,
          formula_present: false,
          cached_result_present: false,
        }),
      );
      continue;
    }
    if (
      cell.state !== 'value' ||
      cell.formula !== null ||
      cell.data_type !== 'number' ||
      packageCell.valueText === null ||
      packageCell.formulaPresent
    ) {
      diagnostics.push('P014_SOURCE_REALIZED_MONTH_VALUE');
      continue;
    }
    const canonicalAmount = canonicalizeP013FinancialDecimal(packageCell.valueText);
    if (canonicalAmount === null) {
      diagnostics.push('P014_SOURCE_INVALID_DECIMAL');
      continue;
    }
    positions.push(
      position({
        authoritative_grain: 'portfolio_month',
        metric_type: 'billing_actual',
        project_code: null,
        competence_month: EXPECTED_COMPETENCIES[index]!,
        item_identity: null,
        currency_code: 'BRL',
        declaration_state: canonicalAmount === '0.00' ? 'explicit_zero' : 'value',
        source_status: 'source_declared_manual_realized_monthly',
        worksheet_key: 'curve_s',
        worksheet_name: 'Curva S',
        source_row_number: 12,
        source_column: column,
        source_cell_reference: address,
        source_row_hash: sourceRowHash,
        source_numeric_text: packageCell.valueText,
        canonical_amount: canonicalAmount,
        source_state: 'value',
        formula_text: null,
        formula_present: false,
        cached_result_present: false,
      }),
    );
  }
  const total = rowCell(rows, 'L12');
  const totalPackage = metadata.cells.get('L12');
  const calculated = positions.reduce(
    (sum, candidate) => sum + cents(candidate.canonical_amount ?? '0.00'),
    0n,
  );
  if (
    total?.formula !== 'SUM(C12:K12)' ||
    total.cached_result_present !== true ||
    totalPackage?.formulaPresent !== true ||
    totalPackage.valueText === null ||
    canonicalizeP013FinancialDecimal(totalPackage.valueText) !== money(calculated)
  ) {
    diagnostics.push('P014_SOURCE_CURVE_TOTAL_RECONCILIATION');
  }
  return positions;
}

export function evaluateP014RealizedSource(
  input: P014RealizedSourceGateInput,
): P014RealizedSourceGateResult {
  const diagnostics: string[] = [];
  verifyDocumentaryEvidence(input.documentary, diagnostics);
  const positions = [
    ...projectPositions(input, diagnostics),
    ...portfolioMonthPositions(input, diagnostics),
  ].sort((left, right) =>
    [left.authoritative_grain, left.project_code ?? '', left.competence_month ?? '']
      .join('\u0000')
      .localeCompare(
        [right.authoritative_grain, right.project_code ?? '', right.competence_month ?? ''].join(
          '\u0000',
        ),
        'en',
      ),
  );
  if (positions.length !== 18) diagnostics.push('P014_SOURCE_POSITION_COUNT');
  const uniqueDiagnostics = [...new Set(diagnostics)].sort();
  const facts = positions.filter((candidate) => candidate.declaration_state !== 'blank');
  const projectTotal = positions
    .filter((candidate) => candidate.authoritative_grain === 'project_aggregate')
    .reduce((sum, candidate) => sum + cents(candidate.canonical_amount ?? '0.00'), 0n);
  const portfolioTotal = positions
    .filter((candidate) => candidate.authoritative_grain === 'portfolio_month')
    .reduce((sum, candidate) => sum + cents(candidate.canonical_amount ?? '0.00'), 0n);
  const semantic = {
    contract: P014_REALIZED_SOURCE_SEMANTIC_CONTRACT,
    normative_meaning: 'what_actually_happened_or_was_concretized',
    metric_type: 'billing_actual' as const,
    documentary: input.documentary,
    source_hints: [
      {
        worksheet_name: 'Prev. Receita Mensal',
        source_cell_reference: 'C1',
        label: rowCell(input.monthly_rows, 'C1')?.value ?? null,
        authoritative_fact: false,
      },
    ],
    positions: positions.map(semanticPosition),
  };
  return Object.freeze({
    contract: P014_REALIZED_SOURCE_SEMANTIC_CONTRACT,
    ok: uniqueDiagnostics.length === 0,
    diagnostics: Object.freeze(uniqueDiagnostics),
    semantic_fingerprint: uniqueDiagnostics.length === 0 ? sha256Canonical(semantic) : null,
    positions: Object.freeze(positions),
    position_count: positions.length,
    fact_count: facts.length,
    blank_count: positions.filter((candidate) => candidate.declaration_state === 'blank').length,
    explicit_zero_count: positions.filter(
      (candidate) => candidate.declaration_state === 'explicit_zero',
    ).length,
    non_zero_count: positions.filter((candidate) => candidate.declaration_state === 'value').length,
    project_aggregate_total: positions.length === 18 ? money(projectTotal) : null,
    portfolio_month_total: positions.length === 18 ? money(portfolioTotal) : null,
  });
}

export function assertP014RealizedSourceFingerprint(
  result: P014RealizedSourceGateResult,
): P014RealizedSourceGateResult {
  if (!result.ok || result.semantic_fingerprint !== P014_D01_REALIZED_SOURCE_SEMANTIC_FINGERPRINT) {
    throw new Error('P014_SOURCE_SEMANTIC_FINGERPRINT_MISMATCH');
  }
  return result;
}
