export interface P013MonthlySourceCellFacts {
  project_code: string;
  source_item_number: string;
  competence_month: string;
  declaration_state: 'blank' | 'explicit_zero' | 'value';
  canonical_amount: string | null;
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

export declare const P013_CERTIFIED_MONTHLY_SOURCE_CONTRACT: 'ltcm.p013.certified-monthly-source.v1';

export interface P013CertifiedMonthlySource {
  contract: typeof P013_CERTIFIED_MONTHLY_SOURCE_CONTRACT;
  source_name: string;
  source_sha256: string;
  source_size_bytes: number;
  source_semantic_fingerprint: string;
  worksheet_key: 'monthly_revenue';
  worksheet_name: 'Prev. Receita Mensal';
  structural_range: 'A1:T52';
  cell_count: 432;
  blank_count: number;
  explicit_zero_count: number;
  non_zero_count: number;
  canonical_total: string;
  aggregate_raw_rounded_total: string;
  rounding_residual: string;
}

interface CertifiedFacts {
  readonly publicIdentity: P013CertifiedMonthlySource;
  readonly cells: readonly P013MonthlySourceCellFacts[];
}

export declare function loadP013CertifiedMonthlySource(
  inputPath: string,
): Promise<P013CertifiedMonthlySource>;

export declare function readP013CertifiedMonthlySourceFacts(
  source: P013CertifiedMonthlySource,
): CertifiedFacts;
