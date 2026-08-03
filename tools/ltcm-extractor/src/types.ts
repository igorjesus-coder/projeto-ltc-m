export const PAYLOAD_SCHEMA_VERSION = 1 as const;

export const OPERATIONAL_SHEETS = [
  { key: 'project_values', name: 'Valores Projetos LTC-M', profile_range: 'A1:K10' },
  { key: 'monthly_revenue', name: 'Prev. Receita Mensal', profile_range: 'A1:T52' },
  { key: 'curve_s', name: 'Curva S', profile_range: 'A1:L16' },
] as const;

export const DOCUMENTARY_SHEET_NAME = 'Decisões Aprovadas';

export type SheetKey = (typeof OPERATIONAL_SHEETS)[number]['key'];
export type ValidationSeverity = 'error' | 'warning';
export type CellState = 'missing' | 'blank' | 'empty_string' | 'value' | 'formula' | 'merged';

export interface RawCellPayload {
  column_index: number;
  column_letter: string;
  address: string;
  value: string | number | boolean | null;
  formula: string | null;
  data_type: string;
  number_format: string | null;
  state: CellState;
  cached_result_present?: boolean;
  formula_range?: string;
  dynamic_array?: boolean;
  merged_from?: string;
  formatted_error?: string;
  formatted_text?: string;
  round_trip_text?: string;
  record_present: boolean;
  value_present: boolean;
  stub: boolean;
  is_date_serial?: boolean;
  date_iso?: string;
}

export interface RawRowPayload {
  schema_version: typeof PAYLOAD_SCHEMA_VERSION;
  sheet_key: SheetKey;
  sheet_name: string;
  row_number: number;
  source_range: string;
  cells: RawCellPayload[];
}

export interface StagingRowArtifact {
  source_row_number: number;
  source_range: string;
  row_kind: 'unknown' | 'blank';
  payload_schema_version: typeof PAYLOAD_SCHEMA_VERSION;
  raw_payload: RawRowPayload;
  row_hash: string;
  status: 'pending';
  validation_attempt: 0;
}

export interface ValidationEntry {
  severity: ValidationSeverity;
  error_code: string;
  error_key: string;
  message: string;
  technical_detail: string | null;
  sheet_key: SheetKey | null;
  sheet_name: string | null;
  source_row_number: number | null;
  cell_address: string | null;
  field_path: string | null;
  raw_value: null;
  project_code?: string;
  future_phase?: 'P011/P012';
}

export interface SheetArtifactSummary {
  sheet_key: SheetKey;
  sheet_name: string;
  workbook_index: number | null;
  visibility: 'visible' | 'hidden' | 'very_hidden' | 'unknown';
  detected_range: string | null;
  worksheet_range: string | null;
  source_row_count: number;
  staged_row_count: number;
  rejected_row_count: 0;
  content_hash: string | null;
  artifact: string | null;
  status: 'completed' | 'rejected';
}

export interface ExtractionManifest {
  artifact_contract: 'ltcm.p010.extraction-manifest.v1';
  payload_schema_version: typeof PAYLOAD_SCHEMA_VERSION;
  source: {
    file_name: string;
    media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    byte_size: number;
    source_hash: string;
  };
  workbook: {
    date_system: '1900' | '1904';
    sheet_names: string[];
    ignored_sheet_names: string[];
  };
  extraction: {
    strict: boolean;
    status: 'passed' | 'passed_with_warnings' | 'failed';
    operational_sheet_count: number;
    staged_row_count: number;
    error_count: number;
    warning_count: number;
  };
  sheets: SheetArtifactSummary[];
  hash_contract: {
    algorithm: 'sha256';
    encoding: 'utf8';
    canonicalization: 'recursive_lexicographic_object_keys_compact_json';
    row_hash_input: 'raw_payload';
    sheet_hash_input: 'ordered_raw_payload_array';
  };
}

export interface ValidationReport {
  report_contract: 'ltcm.p010.validation-report.v1';
  status: ExtractionManifest['extraction']['status'];
  strict: boolean;
  error_count: number;
  warning_count: number;
  entries: ValidationEntry[];
}

export interface ExtractionResult {
  manifest: ExtractionManifest;
  validationReport: ValidationReport;
  rowsBySheet: Map<SheetKey, StagingRowArtifact[]>;
  profileReport: ProfileReport;
  exitCode: 0 | 1;
}

export interface ProfileCheck {
  check_id: string;
  status: 'pass' | 'warning' | 'error';
  source_a: string | null;
  source_b: string | null;
  canonical_a: string | null;
  canonical_b: string | null;
  tolerance: 0;
  message: string;
}

export interface ProfileReport {
  report_contract: 'ltcm.p010.profile-report.v1';
  status: 'not_applicable' | 'passed' | 'passed_with_warnings' | 'failed';
  profile_detected: boolean;
  workbook: {
    sheet_count: number;
    sheet_names: string[];
    date_system: '1900' | '1904';
  };
  documentary_sheet: {
    sheet_name: typeof DOCUMENTARY_SHEET_NAME;
    workbook_index: number | null;
    worksheet_range: string | null;
    classification: 'documentary';
    reason: 'not_imported_by_p010';
    import_batch_sheet_count: 0;
    staging_row_count: 0;
  };
  sheets: Array<{
    sheet_key: SheetKey;
    sheet_name: string;
    worksheet_range: string | null;
    extraction_range: string;
    extracted_rows: number;
    serialized_formula_cells: number;
    formula_definitions: number;
    expected_formula_definitions: number;
  }>;
  projects: {
    count: number;
    codes: string[];
    monthly_codes: string[];
    leading_space_preserved: boolean;
  };
  items: {
    count: number;
    source_rows: { first: 4; last: 51 };
    duplicate_code_groups: number;
    blank_code_rows: number[];
    blank_description_rows: number[];
  };
  competencies: Array<{ serial: number; iso: string }>;
  cell_evidence: Array<{
    coordinate: string;
    value: string | number | boolean | null;
    round_trip_text: string | null;
    formatted_text: string | null;
    number_format: string | null;
    formula: string | null;
    cached_result_present: boolean | null;
    state: CellState;
    date_iso: string | null;
  }>;
  checks: ProfileCheck[];
}

export interface ExtractOptions {
  inputPath: string;
  outputDir: string;
  strict: boolean;
}
