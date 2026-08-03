import * as XLSX from 'xlsx';

import { canonicalJson } from './canonical-json.js';
import {
  DOCUMENTARY_SHEET_NAME,
  OPERATIONAL_SHEETS,
  type ProfileCheck,
  type ProfileReport,
  type RawCellPayload,
  type SheetKey,
  type StagingRowArtifact,
  type ValidationEntry,
} from './types.js';
import type { WorksheetPackageMetadata } from './workbook-package.js';

const EXPECTED_PROJECTS = [
  '2024-10-12524',
  '2025-07-14416',
  '2024-02-10990',
  '2026-01-15797',
  '2025-12-15568',
  '2024-06-11837',
  '2025-08-14656',
  '2026-03-16231',
  '2026-04-16531',
] as const;

const EXPECTED_COMPETENCIES = [
  '2026-07-01',
  '2026-08-01',
  '2026-09-01',
  '2026-10-01',
  '2026-11-01',
  '2026-12-01',
  '2027-01-01',
  '2027-02-01',
  '2027-03-01',
] as const;

const EXPECTED_FORMULA_DEFINITIONS: Record<SheetKey, number> = {
  project_values: 10,
  monthly_revenue: 24,
  curve_s: 30,
};

function cell(rows: StagingRowArtifact[], address: string): RawCellPayload | undefined {
  const rowNumber = XLSX.utils.decode_cell(address).r + 1;
  return rows
    .find((row) => row.source_row_number === rowNumber)
    ?.raw_payload.cells.find((candidate) => candidate.address === address);
}

function projectCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().match(/^\d{4}-\d{2}-\d{5}/u)?.[0] ?? null;
}

function isoDate(serial: unknown, date1904: boolean): string | null {
  if (typeof serial !== 'number') return null;
  const parsed = XLSX.SSF.parse_date_code(serial, { date1904 });
  if (parsed === null) return null;
  return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function validateLtcmProfile(options: {
  sheetNames: string[];
  date1904: boolean;
  rowsBySheet: Map<SheetKey, StagingRowArtifact[]>;
  packageMetadata: Map<string, WorksheetPackageMetadata>;
  strict: boolean;
}): { report: ProfileReport; entries: ValidationEntry[] } {
  const projectRows = options.rowsBySheet.get('project_values') ?? [];
  const monthlyRows = options.rowsBySheet.get('monthly_revenue') ?? [];
  const curveRows = options.rowsBySheet.get('curve_s') ?? [];
  const profileDetected =
    cell(projectRows, 'A1')?.value === 'PROJETOS LTC-M (TOTAL+DEMANDA)' &&
    cell(monthlyRows, 'A3')?.value === 'Item' &&
    typeof cell(curveRows, 'B2')?.value === 'string';
  const checks: ProfileCheck[] = [];
  const entries: ValidationEntry[] = [];

  const addCheck = (
    checkId: string,
    passed: boolean,
    message: string,
    sourceA: string | null = null,
    sourceB: string | null = null,
    canonicalA: unknown = null,
    canonicalB: unknown = null,
  ): void => {
    checks.push({
      check_id: checkId,
      status: passed ? 'pass' : options.strict ? 'error' : 'warning',
      source_a: sourceA,
      source_b: sourceB,
      canonical_a: canonicalA === null ? null : canonicalJson(canonicalA),
      canonical_b: canonicalB === null ? null : canonicalJson(canonicalB),
      tolerance: 0,
      message,
    });
    if (!passed) {
      entries.push({
        severity: options.strict ? 'error' : 'warning',
        error_code: `P010_PROFILE_${checkId}`,
        error_key: `p010_profile_${checkId.toLowerCase()}`,
        message,
        technical_detail: null,
        sheet_key: null,
        sheet_name: null,
        source_row_number: null,
        cell_address: null,
        field_path: 'profile',
        raw_value: null,
      });
    }
  };

  const workbookDateSystem = options.date1904 ? '1904' : '1900';
  const documentaryIndex = options.sheetNames.indexOf(DOCUMENTARY_SHEET_NAME);
  const documentaryRange =
    options.packageMetadata.get(DOCUMENTARY_SHEET_NAME)?.worksheetRange ?? null;

  if (!profileDetected) {
    return {
      entries,
      report: {
        report_contract: 'ltcm.p010.profile-report.v1',
        status: 'not_applicable',
        profile_detected: false,
        workbook: {
          sheet_count: options.sheetNames.length,
          sheet_names: options.sheetNames,
          date_system: workbookDateSystem,
        },
        documentary_sheet: {
          sheet_name: DOCUMENTARY_SHEET_NAME,
          workbook_index: documentaryIndex === -1 ? null : documentaryIndex,
          worksheet_range: documentaryRange,
          classification: 'documentary',
          reason: 'not_imported_by_p010',
          import_batch_sheet_count: 0,
          staging_row_count: 0,
        },
        sheets: OPERATIONAL_SHEETS.map((definition) => ({
          sheet_key: definition.key,
          sheet_name: definition.name,
          worksheet_range: options.packageMetadata.get(definition.name)?.worksheetRange ?? null,
          extraction_range: definition.profile_range,
          extracted_rows: options.rowsBySheet.get(definition.key)?.length ?? 0,
          serialized_formula_cells: (options.rowsBySheet.get(definition.key) ?? [])
            .flatMap((row) => row.raw_payload.cells)
            .filter((candidate) => candidate.formula !== null).length,
          formula_definitions:
            options.packageMetadata.get(definition.name)?.formulaDefinitions ?? 0,
          expected_formula_definitions: EXPECTED_FORMULA_DEFINITIONS[definition.key],
        })),
        projects: { count: 0, codes: [], monthly_codes: [], leading_space_preserved: false },
        items: {
          count: 0,
          source_rows: { first: 4, last: 51 },
          duplicate_code_groups: 0,
          blank_code_rows: [],
          blank_description_rows: [],
        },
        competencies: [],
        cell_evidence: [],
        checks,
      },
    };
  }

  addCheck(
    'WORKBOOK_SHEETS',
    sameCanonical(options.sheetNames, [
      ...OPERATIONAL_SHEETS.map((sheet) => sheet.name),
      DOCUMENTARY_SHEET_NAME,
    ]),
    'O workbook deve conter as três abas operacionais e a documental na ordem esperada.',
    'workbook.sheet_names',
    null,
    options.sheetNames,
    [...OPERATIONAL_SHEETS.map((sheet) => sheet.name), DOCUMENTARY_SHEET_NAME],
  );
  addCheck(
    'DOCUMENTARY_RANGE',
    documentaryRange === 'A1:F11',
    'A aba documental deve ocupar A1:F11 e permanecer fora do staging.',
    `${DOCUMENTARY_SHEET_NAME}!A1:F11`,
    null,
    documentaryRange,
    'A1:F11',
  );

  const projectHeaderCells = Array.from({ length: 9 }, (_, index) =>
    cell(projectRows, `${XLSX.utils.encode_col(index + 2)}2`),
  );
  const projectCodes = projectHeaderCells
    .map((candidate) => projectCode(candidate?.value))
    .filter((value): value is string => value !== null);
  const monthlyItemRows = monthlyRows.filter(
    (row) => row.source_row_number >= 4 && row.source_row_number <= 51,
  );
  const monthlyCodes = [
    ...new Set(
      monthlyItemRows
        .map((row) => projectCode(cell(monthlyRows, `B${row.source_row_number}`)?.value))
        .filter((value): value is string => value !== null),
    ),
  ];
  addCheck(
    'PROJECT_COUNT',
    projectCodes.length === 9 && new Set(projectCodes).size === 9,
    'A visão de validação deve detectar nove projetos distintos no resumo.',
    'Valores Projetos LTC-M!C2:K2',
    null,
    projectCodes,
    EXPECTED_PROJECTS,
  );
  addCheck(
    'PROJECT_LISTS',
    sameCanonical([...projectCodes].sort(), [...EXPECTED_PROJECTS].sort()) &&
      sameCanonical([...monthlyCodes].sort(), [...EXPECTED_PROJECTS].sort()),
    'As listas de projetos do resumo e da origem mensal devem coincidir.',
    'Valores Projetos LTC-M!C2:K2',
    'Prev. Receita Mensal!B4:B51',
    [...projectCodes].sort(),
    [...monthlyCodes].sort(),
  );

  const blankCodeRows = monthlyItemRows
    .filter((row) => {
      const value = cell(monthlyRows, `D${row.source_row_number}`)?.value;
      return value === null || value === '';
    })
    .map((row) => row.source_row_number);
  const blankDescriptionRows = monthlyItemRows
    .filter((row) => {
      const value = cell(monthlyRows, `E${row.source_row_number}`)?.value;
      return value === null || value === '';
    })
    .map((row) => row.source_row_number);
  const codeRows = new Map<string, number[]>();
  for (const row of monthlyItemRows) {
    const value = cell(monthlyRows, `D${row.source_row_number}`)?.value;
    if (typeof value !== 'string' || value === '') continue;
    codeRows.set(value, [...(codeRows.get(value) ?? []), row.source_row_number]);
  }
  const duplicateCodeGroups = [...codeRows.values()].filter((rows) => rows.length > 1).length;
  addCheck(
    'ITEM_COUNT',
    monthlyItemRows.length === 48,
    'As linhas físicas 4 a 51 devem permanecer como 48 itens, inclusive linhas incompletas.',
    'Prev. Receita Mensal!A4:T51',
    null,
    monthlyItemRows.length,
    48,
  );
  addCheck(
    'REPEATED_CODES',
    duplicateCodeGroups > 0,
    'Códigos repetidos devem permanecer em linhas físicas distintas.',
    'Prev. Receita Mensal!D4:D51',
    null,
    duplicateCodeGroups,
    '>0',
  );
  addCheck(
    'INCOMPLETE_ITEM_TRACEABILITY',
    blankCodeRows.length > 0 || blankDescriptionRows.length > 0,
    'Linha com código ou descrição vazios deve permanecer rastreável.',
    'Prev. Receita Mensal!D4:E51',
    null,
    { blankCodeRows, blankDescriptionRows },
    'at_least_one',
  );

  const monthlyPeriodCells = Array.from({ length: 9 }, (_, index) =>
    cell(monthlyRows, `${XLSX.utils.encode_col(index + 10)}3`),
  );
  const curvePeriodCells = Array.from({ length: 9 }, (_, index) =>
    cell(curveRows, `${XLSX.utils.encode_col(index + 2)}7`),
  );
  const competencies = monthlyPeriodCells.map((candidate) => ({
    serial: typeof candidate?.value === 'number' ? candidate.value : Number.NaN,
    iso: isoDate(candidate?.value, options.date1904) ?? '',
  }));
  addCheck(
    'COMPETENCIES',
    sameCanonical(
      competencies.map((value) => value.iso),
      EXPECTED_COMPETENCIES,
    ) && new Set(competencies.map((value) => value.iso)).size === 9,
    'As competências devem cobrir julho/2026 a março/2027, sem duplicidade e em ordem.',
    'Prev. Receita Mensal!K3:S3',
    null,
    competencies.map((value) => value.iso),
    EXPECTED_COMPETENCIES,
  );
  addCheck(
    'PERIODS_BETWEEN_SHEETS',
    sameCanonical(
      monthlyPeriodCells.map((candidate) => candidate?.value ?? null),
      curvePeriodCells.map((candidate) => candidate?.value ?? null),
    ),
    'Os seriais de competência da origem mensal e da Curva S devem coincidir.',
    'Prev. Receita Mensal!K3:S3',
    'Curva S!C7:K7',
    monthlyPeriodCells.map((candidate) => candidate?.value ?? null),
    curvePeriodCells.map((candidate) => candidate?.value ?? null),
  );

  for (const definition of OPERATIONAL_SHEETS) {
    const metadata = options.packageMetadata.get(definition.name);
    addCheck(
      `FORMULA_DEFINITIONS_${definition.key.toUpperCase()}`,
      metadata?.formulaDefinitions === EXPECTED_FORMULA_DEFINITIONS[definition.key],
      `A aba ${definition.name} deve preservar a quantidade esperada de definições de fórmula.`,
      definition.name,
      null,
      metadata?.formulaDefinitions ?? null,
      EXPECTED_FORMULA_DEFINITIONS[definition.key],
    );
  }

  const requireFormulaCache = (sheetKey: SheetKey, address: string): void => {
    const rows = options.rowsBySheet.get(sheetKey) ?? [];
    const candidate = cell(rows, address);
    addCheck(
      `FORMULA_CACHE_${sheetKey.toUpperCase()}_${address}`,
      candidate?.formula !== null && candidate?.cached_result_present === true,
      `A célula ${address} deve preservar fórmula e resultado em cache.`,
      `${OPERATIONAL_SHEETS.find((sheet) => sheet.key === sheetKey)?.name ?? sheetKey}!${address}`,
    );
  };
  for (const [sheetKey, address] of [
    ['project_values', 'B3'],
    ['monthly_revenue', 'J52'],
    ['monthly_revenue', 'T52'],
    ['curve_s', 'L8'],
    ['curve_s', 'L9'],
  ] as const) {
    requireFormulaCache(sheetKey, address);
  }

  const monthlyTotals = Array.from(
    { length: 9 },
    (_, index) => cell(monthlyRows, `${XLSX.utils.encode_col(index + 10)}52`)?.value ?? null,
  );
  const curveMonthly = Array.from(
    { length: 9 },
    (_, index) => cell(curveRows, `${XLSX.utils.encode_col(index + 2)}8`)?.value ?? null,
  );
  addCheck(
    'MONTHLY_TOTALS_CURVE',
    sameCanonical(monthlyTotals, curveMonthly),
    'Os caches dos totais mensais e da Curva S devem coincidir exatamente.',
    'Prev. Receita Mensal!K52:S52',
    'Curva S!C8:K8',
    monthlyTotals,
    curveMonthly,
  );
  addCheck(
    'GRAND_TOTAL_CURVE',
    sameCanonical(cell(monthlyRows, 'T52')?.value ?? null, cell(curveRows, 'L8')?.value ?? null),
    'O total mensal previsto e o total da Curva S devem coincidir.',
    'Prev. Receita Mensal!T52',
    'Curva S!L8',
    cell(monthlyRows, 'T52')?.value ?? null,
    cell(curveRows, 'L8')?.value ?? null,
  );
  addCheck(
    'FINAL_ACCUMULATED_TOTAL',
    sameCanonical(cell(curveRows, 'K9')?.value ?? null, cell(curveRows, 'L8')?.value ?? null),
    'O acumulado da competência final deve coincidir com o total previsto.',
    'Curva S!K9',
    'Curva S!L8',
    cell(curveRows, 'K9')?.value ?? null,
    cell(curveRows, 'L8')?.value ?? null,
  );
  addCheck(
    'PROJECT_2026_04_16531',
    cell(projectRows, 'K3')?.value === 164000 && cell(monthlyRows, 'J51')?.value === 164000,
    'O valor de 2026-04-16531 deve coincidir entre resumo e origem mensal.',
    'Valores Projetos LTC-M!K3',
    'Prev. Receita Mensal!J51',
    cell(projectRows, 'K3')?.value ?? null,
    cell(monthlyRows, 'J51')?.value ?? null,
  );
  addCheck(
    'PROJECT_2024_02_10990_VALUE',
    cell(monthlyRows, 'J45')?.value === 369749.1735,
    'O valor bruto aprovado de 2024-02-10990 deve ser preservado.',
    'Prev. Receita Mensal!J45',
    null,
    cell(monthlyRows, 'J45')?.value ?? null,
    369749.1735,
  );

  if (
    projectCode(cell(monthlyRows, 'B45')?.value) === '2024-02-10990' &&
    typeof cell(monthlyRows, 'J45')?.value === 'number'
  ) {
    entries.push({
      severity: 'warning',
      error_code: 'RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE',
      error_key: 'receipt_forecast_present_in_monthly_source',
      message:
        'Projeto com previsão de recebimento presente na origem mensal; tratamento pertence à P011/P012.',
      technical_detail: null,
      sheet_key: 'monthly_revenue',
      sheet_name: 'Prev. Receita Mensal',
      source_row_number: 45,
      cell_address: 'J45',
      field_path: 'raw_payload.cells.J45.value',
      raw_value: null,
      project_code: '2024-02-10990',
      future_phase: 'P011/P012',
    });
    checks.push({
      check_id: 'RECEIPT_FORECAST_PRESENT',
      status: 'warning',
      source_a: 'Prev. Receita Mensal!A45:T45',
      source_b: null,
      canonical_a: '2024-02-10990',
      canonical_b: null,
      tolerance: 0,
      message: 'Warning aprovado emitido sem alterar o payload.',
    });
  } else {
    addCheck(
      'RECEIPT_FORECAST_WARNING',
      false,
      'O warning aprovado de 2024-02-10990 não pôde ser comprovado.',
      'Prev. Receita Mensal!A45:T45',
    );
  }

  const evidenceCoordinates: Array<[SheetKey, string]> = [
    ['monthly_revenue', 'J45'],
    ['monthly_revenue', 'J51'],
    ['monthly_revenue', 'O12'],
    ['monthly_revenue', 'R52'],
    ['monthly_revenue', 'K3'],
    ['project_values', 'D2'],
    ['curve_s', 'A1'],
    ['curve_s', 'B2'],
    ['curve_s', 'L8'],
  ];
  const cellEvidence = evidenceCoordinates.map(([sheetKey, address]) => {
    const candidate = cell(options.rowsBySheet.get(sheetKey) ?? [], address);
    return {
      coordinate: `${sheetKey}!${address}`,
      value: candidate?.value ?? null,
      round_trip_text: candidate?.round_trip_text ?? null,
      formatted_text: candidate?.formatted_text ?? null,
      number_format: candidate?.number_format ?? null,
      formula: candidate?.formula ?? null,
      cached_result_present: candidate?.cached_result_present ?? null,
      state: candidate?.state ?? 'missing',
      date_iso: candidate?.date_iso ?? null,
    };
  });

  const profileErrors = checks.filter((check) => check.status === 'error').length;
  const profileWarnings = checks.filter((check) => check.status === 'warning').length;
  return {
    entries,
    report: {
      report_contract: 'ltcm.p010.profile-report.v1',
      status:
        profileErrors > 0 ? 'failed' : profileWarnings > 0 ? 'passed_with_warnings' : 'passed',
      profile_detected: true,
      workbook: {
        sheet_count: options.sheetNames.length,
        sheet_names: options.sheetNames,
        date_system: workbookDateSystem,
      },
      documentary_sheet: {
        sheet_name: DOCUMENTARY_SHEET_NAME,
        workbook_index: documentaryIndex === -1 ? null : documentaryIndex,
        worksheet_range: documentaryRange,
        classification: 'documentary',
        reason: 'not_imported_by_p010',
        import_batch_sheet_count: 0,
        staging_row_count: 0,
      },
      sheets: OPERATIONAL_SHEETS.map((definition) => ({
        sheet_key: definition.key,
        sheet_name: definition.name,
        worksheet_range: options.packageMetadata.get(definition.name)?.worksheetRange ?? null,
        extraction_range: definition.profile_range,
        extracted_rows: options.rowsBySheet.get(definition.key)?.length ?? 0,
        serialized_formula_cells: (options.rowsBySheet.get(definition.key) ?? [])
          .flatMap((row) => row.raw_payload.cells)
          .filter((candidate) => candidate.formula !== null).length,
        formula_definitions: options.packageMetadata.get(definition.name)?.formulaDefinitions ?? 0,
        expected_formula_definitions: EXPECTED_FORMULA_DEFINITIONS[definition.key],
      })),
      projects: {
        count: projectCodes.length,
        codes: projectCodes,
        monthly_codes: monthlyCodes,
        leading_space_preserved: projectHeaderCells.some(
          (candidate) =>
            typeof candidate?.value === 'string' && /^\s+2024-06-11837/u.test(candidate.value),
        ),
      },
      items: {
        count: monthlyItemRows.length,
        source_rows: { first: 4, last: 51 },
        duplicate_code_groups: duplicateCodeGroups,
        blank_code_rows: blankCodeRows,
        blank_description_rows: blankDescriptionRows,
      },
      competencies,
      cell_evidence: cellEvidence,
      checks,
    },
  };
}
