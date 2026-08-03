import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { sha256Bytes, sha256Canonical } from './canonical-json.js';
import { validateLtcmProfile } from './profile-validator.js';
import {
  DOCUMENTARY_SHEET_NAME,
  OPERATIONAL_SHEETS,
  PAYLOAD_SCHEMA_VERSION,
  type ExtractOptions,
  type ExtractionResult,
  type RawCellPayload,
  type SheetArtifactSummary,
  type SheetKey,
  type StagingRowArtifact,
  type ValidationEntry,
  type ValidationSeverity,
} from './types.js';
import { inspectWorkbookPackage } from './workbook-package.js';

const MAX_CELLS_PER_SHEET = 2_000_000;
const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024;
const MAX_CELL_TEXT_LENGTH = 32_767;

export function worksheetRangeCellCount(reference: string): number {
  const range = XLSX.utils.decode_range(reference);
  return (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
}

function issue(
  entries: ValidationEntry[],
  severity: ValidationSeverity,
  errorCode: string,
  message: string,
  details: Partial<ValidationEntry> = {},
): void {
  entries.push({
    severity,
    error_code: errorCode,
    error_key: errorCode.toLowerCase(),
    message,
    technical_detail: null,
    sheet_key: null,
    sheet_name: null,
    source_row_number: null,
    cell_address: null,
    field_path: null,
    raw_value: null,
    ...details,
  });
}

function strictSeverity(strict: boolean): ValidationSeverity {
  return strict ? 'error' : 'warning';
}

function visibility(hidden: number | undefined): SheetArtifactSummary['visibility'] {
  if (hidden === 0 || hidden === undefined) return 'visible';
  if (hidden === 1) return 'hidden';
  if (hidden === 2) return 'very_hidden';
  return 'unknown';
}

function mergedMaster(
  merges: XLSX.Range[] | undefined,
  row: number,
  column: number,
): string | null {
  for (const merge of merges ?? []) {
    if (
      row >= merge.s.r &&
      row <= merge.e.r &&
      column >= merge.s.c &&
      column <= merge.e.c &&
      (row !== merge.s.r || column !== merge.s.c)
    ) {
      return XLSX.utils.encode_cell(merge.s);
    }
  }
  return null;
}

function dataType(cell: XLSX.CellObject | undefined): string {
  if (cell === undefined || cell.t === 'z') return 'blank';
  switch (cell.t) {
    case 'n':
      return 'number';
    case 's':
      return 'string';
    case 'b':
      return 'boolean';
    case 'e':
      return 'error';
    case 'd':
      return 'date';
    default:
      return cell.t === undefined ? 'unknown' : String(cell.t);
  }
}

function cellValue(cell: XLSX.CellObject | undefined): string | number | boolean | null {
  if (cell === undefined || cell.t === 'z' || cell.v === undefined || cell.v === null) {
    return null;
  }
  if (cell.v instanceof Date) {
    throw new TypeError('Unexpected converted Date. The extractor requires raw Excel serials.');
  }
  if (typeof cell.v === 'number' && !Number.isFinite(cell.v)) {
    throw new TypeError('Non-finite numeric cell value is not representable in JSON.');
  }
  if (typeof cell.v === 'string' && cell.v.length > MAX_CELL_TEXT_LENGTH) {
    throw new TypeError(`Cell text exceeds ${MAX_CELL_TEXT_LENGTH} characters.`);
  }
  return cell.v;
}

function excelDateIso(value: number, date1904: boolean): string | null {
  const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
  if (parsed === null) return null;
  return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
}

function serializeCell(
  worksheet: XLSX.WorkSheet,
  row: number,
  column: number,
  date1904: boolean,
): RawCellPayload {
  const address = XLSX.utils.encode_cell({ r: row, c: column });
  const cell = worksheet[address];
  const master = mergedMaster(worksheet['!merges'], row, column);
  const formula = cell?.f ?? null;
  const value = cellValue(cell);
  const isDateSerial =
    typeof value === 'number' && cell?.z !== undefined && XLSX.SSF.is_date(cell.z);
  let state: RawCellPayload['state'];

  if (master !== null) state = 'merged';
  else if (formula !== null) state = 'formula';
  else if (cell === undefined) state = 'missing';
  else if (cell.t === 'z' || cell.v === undefined || cell.v === null) state = 'blank';
  else if (cell.v === '') state = 'empty_string';
  else state = 'value';

  return {
    column_index: column + 1,
    column_letter: XLSX.utils.encode_col(column),
    address,
    value,
    formula,
    data_type: dataType(cell),
    number_format: cell?.z ?? null,
    state,
    record_present: cell !== undefined,
    value_present: cell !== undefined && Object.prototype.hasOwnProperty.call(cell, 'v'),
    stub: cell?.t === 'z',
    ...(formula === null ? {} : { cached_result_present: cell?.v !== undefined }),
    ...(cell?.F === undefined ? {} : { formula_range: cell.F }),
    ...(cell?.D === undefined ? {} : { dynamic_array: cell.D }),
    ...(master === null ? {} : { merged_from: master }),
    ...(cell?.t === 'e' && cell.w !== undefined ? { formatted_error: cell.w } : {}),
    ...(cell?.w === undefined ? {} : { formatted_text: cell.w }),
    ...(typeof value === 'number' ? { round_trip_text: value.toString() } : {}),
    ...(isDateSerial
      ? { is_date_serial: true, date_iso: excelDateIso(value, date1904) ?? undefined }
      : {}),
  };
}

function isBlankRow(cells: RawCellPayload[]): boolean {
  return cells.every((cell) => cell.state === 'missing' || cell.state === 'blank');
}

function parseRange(
  worksheet: XLSX.WorkSheet,
  sheetKey: SheetKey,
  sheetName: string,
  strict: boolean,
  entries: ValidationEntry[],
): XLSX.Range | null {
  const reference = worksheet['!ref'];
  if (reference === undefined) {
    issue(
      entries,
      strictSeverity(strict),
      'P010_EMPTY_SHEET',
      'A aba operacional não possui faixa de células detectável.',
      {
        sheet_key: sheetKey,
        sheet_name: sheetName,
        field_path: 'worksheet.!ref',
      },
    );
    return null;
  }

  let range: XLSX.Range;
  try {
    range = XLSX.utils.decode_range(reference);
  } catch (error) {
    issue(entries, 'error', 'P010_INVALID_SHEET_RANGE', 'A faixa detectada da aba é inválida.', {
      sheet_key: sheetKey,
      sheet_name: sheetName,
      field_path: 'worksheet.!ref',
      technical_detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  const cellCount = worksheetRangeCellCount(reference);
  if (rowCount <= 0 || columnCount <= 0 || cellCount > MAX_CELLS_PER_SHEET) {
    issue(
      entries,
      'error',
      'P010_SHEET_RANGE_LIMIT',
      'A faixa da aba excede o limite estrutural do extrator.',
      {
        sheet_key: sheetKey,
        sheet_name: sheetName,
        field_path: 'worksheet.!ref',
        technical_detail: `Limite: ${MAX_CELLS_PER_SHEET} células; detectado: ${cellCount}.`,
      },
    );
    return null;
  }
  return range;
}

function serializeRows(
  worksheet: XLSX.WorkSheet,
  range: XLSX.Range,
  sheetKey: SheetKey,
  sheetName: string,
  strict: boolean,
  date1904: boolean,
  entries: ValidationEntry[],
): StagingRowArtifact[] {
  const rows: StagingRowArtifact[] = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const cells: RawCellPayload[] = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      let serialized: RawCellPayload;
      try {
        serialized = serializeCell(worksheet, row, column, date1904);
      } catch (error) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        issue(
          entries,
          'error',
          'P010_UNSERIALIZABLE_CELL',
          'Uma célula não pôde ser serializada sem perda.',
          {
            sheet_key: sheetKey,
            sheet_name: sheetName,
            source_row_number: row + 1,
            cell_address: address,
            field_path: `cells.${address}`,
            technical_detail: error instanceof Error ? error.message : String(error),
          },
        );
        serialized = {
          column_index: column + 1,
          column_letter: XLSX.utils.encode_col(column),
          address,
          value: null,
          formula: null,
          data_type: 'unserializable',
          number_format: null,
          state: 'blank',
          record_present: true,
          value_present: false,
          stub: false,
        };
      }

      if (serialized.formula !== null && serialized.cached_result_present === false) {
        issue(
          entries,
          strictSeverity(strict),
          'P010_FORMULA_WITHOUT_CACHED_RESULT',
          'A fórmula não possui resultado em cache no arquivo.',
          {
            sheet_key: sheetKey,
            sheet_name: sheetName,
            source_row_number: row + 1,
            cell_address: serialized.address,
            field_path: `cells.${serialized.address}.value`,
          },
        );
      }
      if (serialized.formula?.includes('[') === true) {
        issue(
          entries,
          strictSeverity(strict),
          'P010_EXTERNAL_FORMULA_REFERENCE',
          'A fórmula contém referência externa e foi preservada sem resolução.',
          {
            sheet_key: sheetKey,
            sheet_name: sheetName,
            source_row_number: row + 1,
            cell_address: serialized.address,
            field_path: `cells.${serialized.address}.formula`,
          },
        );
      }
      cells.push(serialized);
    }

    const sourceRange = `${XLSX.utils.encode_col(range.s.c)}${row + 1}:${XLSX.utils.encode_col(range.e.c)}${row + 1}`;
    const rawPayload = {
      schema_version: PAYLOAD_SCHEMA_VERSION,
      sheet_key: sheetKey,
      sheet_name: sheetName,
      row_number: row + 1,
      source_range: sourceRange,
      cells,
    } as const;
    rows.push({
      source_row_number: row + 1,
      source_range: sourceRange,
      row_kind: isBlankRow(cells) ? 'blank' : 'unknown',
      payload_schema_version: PAYLOAD_SCHEMA_VERSION,
      raw_payload: rawPayload,
      row_hash: sha256Canonical(rawPayload),
      status: 'pending',
      validation_attempt: 0,
    });
  }
  return rows;
}

export async function extractWorkbook(options: ExtractOptions): Promise<ExtractionResult> {
  if (path.extname(options.inputPath).toLowerCase() !== '.xlsx') {
    throw new Error('O arquivo de entrada deve usar a extensão .xlsx.');
  }
  const inputStat = await stat(options.inputPath);
  if (!inputStat.isFile())
    throw new Error('O caminho de entrada não aponta para um arquivo regular.');
  if (inputStat.size > MAX_WORKBOOK_BYTES) {
    throw new Error(`O arquivo excede o limite de ${MAX_WORKBOOK_BYTES} bytes.`);
  }
  const inputBytes = await readFile(options.inputPath);
  const zipSignature = inputBytes.subarray(0, 4).toString('hex');
  if (!['504b0304', '504b0506', '504b0708'].includes(zipSignature)) {
    throw new Error('O arquivo não possui a assinatura ZIP esperada de um workbook XLSX.');
  }

  const metadataWorkbook = XLSX.read(inputBytes, {
    type: 'buffer',
    bookSheets: true,
  });
  const sheetNames = [...metadataWorkbook.SheetNames];
  const packageMetadata = inspectWorkbookPackage(inputBytes);
  const operationalNames = new Set(OPERATIONAL_SHEETS.map((sheet) => sheet.name));
  const presentOperationalNames = sheetNames.filter((name) => operationalNames.has(name as never));

  const workbook = XLSX.read(inputBytes, {
    type: 'buffer',
    sheets: presentOperationalNames,
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
    cellText: true,
    cellDates: false,
    sheetStubs: true,
    xlfn: true,
  });
  const entries: ValidationEntry[] = [];
  const rowsBySheet = new Map<SheetKey, StagingRowArtifact[]>();
  const sheetSummaries: SheetArtifactSummary[] = [];
  const workbookSheetMetadata = workbook.Workbook?.Sheets ?? [];
  const date1904 = workbook.Workbook?.WBProps?.date1904 === true;
  const profileDetected =
    workbook.Sheets['Valores Projetos LTC-M']?.A1?.v === 'PROJETOS LTC-M (TOTAL+DEMANDA)' &&
    workbook.Sheets['Prev. Receita Mensal']?.A3?.v === 'Item' &&
    typeof workbook.Sheets['Curva S']?.B2?.v === 'string';

  const duplicateNames = sheetNames.filter((name, index) => sheetNames.indexOf(name) !== index);
  for (const duplicateName of [...new Set(duplicateNames)]) {
    issue(
      entries,
      'error',
      'P010_DUPLICATE_SHEET_NAME',
      'O workbook contém nome de aba duplicado.',
      {
        sheet_name: duplicateName,
        field_path: 'workbook.sheet_names',
      },
    );
  }

  const unexpectedNames = sheetNames.filter(
    (name) => !operationalNames.has(name as never) && name !== DOCUMENTARY_SHEET_NAME,
  );
  for (const unexpectedName of unexpectedNames) {
    const empty = (packageMetadata.get(unexpectedName)?.worksheetRange ?? null) === null;
    issue(
      entries,
      empty ? 'warning' : strictSeverity(options.strict),
      empty ? 'P010_UNEXPECTED_EMPTY_SHEET' : 'P010_UNEXPECTED_SHEET',
      empty
        ? 'Uma aba vazia não reconhecida foi ignorada.'
        : 'Uma aba não reconhecida e não vazia foi ignorada.',
      {
        sheet_name: unexpectedName,
        field_path: 'workbook.sheet_names',
      },
    );
  }
  const detectedOperationalOrder = sheetNames.filter((name) => operationalNames.has(name as never));
  const expectedOperationalOrder = OPERATIONAL_SHEETS.map((sheet) => sheet.name);
  if (
    detectedOperationalOrder.length === expectedOperationalOrder.length &&
    !detectedOperationalOrder.every((name, index) => name === expectedOperationalOrder[index])
  ) {
    issue(
      entries,
      strictSeverity(options.strict),
      'P010_OPERATIONAL_SHEET_ORDER',
      'A ordem física das abas operacionais diverge do perfil LTC-M.',
      { field_path: 'workbook.sheet_names' },
    );
  }

  for (const definition of OPERATIONAL_SHEETS) {
    const workbookIndex = sheetNames.indexOf(definition.name);
    if (workbookIndex === -1) {
      issue(
        entries,
        strictSeverity(options.strict),
        'P010_REQUIRED_SHEET_MISSING',
        'A aba operacional esperada não foi encontrada.',
        {
          sheet_key: definition.key,
          sheet_name: definition.name,
          field_path: 'workbook.sheet_names',
        },
      );
      sheetSummaries.push({
        sheet_key: definition.key,
        sheet_name: definition.name,
        workbook_index: null,
        visibility: 'unknown',
        detected_range: null,
        worksheet_range: null,
        source_row_count: 0,
        staged_row_count: 0,
        rejected_row_count: 0,
        content_hash: null,
        artifact: null,
        status: 'rejected',
      });
      continue;
    }

    const sheetVisibility = visibility(workbookSheetMetadata[workbookIndex]?.Hidden);
    if (sheetVisibility !== 'visible') {
      issue(
        entries,
        strictSeverity(options.strict),
        'P010_OPERATIONAL_SHEET_HIDDEN',
        'A aba operacional não está visível.',
        {
          sheet_key: definition.key,
          sheet_name: definition.name,
          field_path: 'workbook.sheets.visibility',
        },
      );
    }
    const worksheet = workbook.Sheets[definition.name];
    if (worksheet === undefined) {
      issue(
        entries,
        'error',
        'P010_OPERATIONAL_SHEET_NOT_PARSED',
        'A aba operacional detectada não pôde ser lida.',
        {
          sheet_key: definition.key,
          sheet_name: definition.name,
        },
      );
      sheetSummaries.push({
        sheet_key: definition.key,
        sheet_name: definition.name,
        workbook_index: workbookIndex,
        visibility: sheetVisibility,
        detected_range: null,
        worksheet_range: null,
        source_row_count: 0,
        staged_row_count: 0,
        rejected_row_count: 0,
        content_hash: null,
        artifact: null,
        status: 'rejected',
      });
      continue;
    }

    const worksheetRange = parseRange(
      worksheet,
      definition.key,
      definition.name,
      options.strict,
      entries,
    );
    const range =
      profileDetected && worksheetRange !== null
        ? XLSX.utils.decode_range(definition.profile_range)
        : worksheetRange;
    const rows =
      range === null
        ? []
        : serializeRows(
            worksheet,
            range,
            definition.key,
            definition.name,
            options.strict,
            date1904,
            entries,
          );
    rowsBySheet.set(definition.key, rows);
    sheetSummaries.push({
      sheet_key: definition.key,
      sheet_name: definition.name,
      workbook_index: workbookIndex,
      visibility: sheetVisibility,
      detected_range: range === null ? null : XLSX.utils.encode_range(range),
      worksheet_range:
        packageMetadata.get(definition.name)?.worksheetRange ??
        (worksheetRange === null ? null : XLSX.utils.encode_range(worksheetRange)),
      source_row_count: rows.length,
      staged_row_count: rows.length,
      rejected_row_count: 0,
      content_hash: sha256Canonical(rows.map((row) => row.raw_payload)),
      artifact: `sheets/${definition.key}.jsonl`,
      status: range === null ? 'rejected' : 'completed',
    });
  }

  const profileValidation = validateLtcmProfile({
    sheetNames,
    date1904,
    rowsBySheet,
    packageMetadata,
    strict: options.strict,
  });
  entries.push(...profileValidation.entries);

  entries.sort((left, right) =>
    [left.sheet_name ?? '', left.source_row_number ?? 0, left.cell_address ?? '', left.error_code]
      .join('\u0000')
      .localeCompare(
        [
          right.sheet_name ?? '',
          right.source_row_number ?? 0,
          right.cell_address ?? '',
          right.error_code,
        ].join('\u0000'),
        'en',
      ),
  );
  const errorCount = entries.filter((entry) => entry.severity === 'error').length;
  const warningCount = entries.length - errorCount;
  const status = errorCount > 0 ? 'failed' : warningCount > 0 ? 'passed_with_warnings' : 'passed';
  const ignoredSheetNames = sheetNames.filter((name) => !operationalNames.has(name as never));
  const manifest = {
    artifact_contract: 'ltcm.p010.extraction-manifest.v1',
    payload_schema_version: PAYLOAD_SCHEMA_VERSION,
    source: {
      file_name: path.basename(options.inputPath),
      media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byte_size: inputBytes.byteLength,
      source_hash: sha256Bytes(inputBytes),
    },
    workbook: {
      date_system: date1904 ? '1904' : '1900',
      sheet_names: sheetNames,
      ignored_sheet_names: ignoredSheetNames,
    },
    extraction: {
      strict: options.strict,
      status,
      operational_sheet_count: sheetSummaries.filter((sheet) => sheet.status === 'completed')
        .length,
      staged_row_count: sheetSummaries.reduce((sum, sheet) => sum + sheet.staged_row_count, 0),
      error_count: errorCount,
      warning_count: warningCount,
    },
    sheets: sheetSummaries,
    hash_contract: {
      algorithm: 'sha256',
      encoding: 'utf8',
      canonicalization: 'recursive_lexicographic_object_keys_compact_json',
      row_hash_input: 'raw_payload',
      sheet_hash_input: 'ordered_raw_payload_array',
    },
  } as const;

  return {
    manifest,
    validationReport: {
      report_contract: 'ltcm.p010.validation-report.v1',
      status,
      strict: options.strict,
      error_count: errorCount,
      warning_count: warningCount,
      entries,
    },
    rowsBySheet,
    profileReport: profileValidation.report,
    exitCode: errorCount > 0 ? 1 : 0,
  };
}
