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

export declare const P014_CERTIFIED_REALIZED_SOURCE_CONTRACT: 'ltcm.p014.certified-realized-source.v1';

export interface P014CertifiedRealizedSource {
  contract: typeof P014_CERTIFIED_REALIZED_SOURCE_CONTRACT;
  source_name: string;
  source_sha256: string;
  source_size_bytes: number;
  source_semantic_fingerprint: string;
  worksheet_names: readonly [
    'Valores Projetos LTC-M',
    'Prev. Receita Mensal',
    'Curva S',
    'Decisões Aprovadas',
  ];
  position_count: 18;
  fact_count: 10;
  blank_count: 8;
  explicit_zero_count: 6;
  non_zero_count: 4;
  project_aggregate_total: string;
  portfolio_month_total: string;
}

export interface P014CertifiedRealizedFacts {
  readonly public_identity: P014CertifiedRealizedSource;
  readonly positions: readonly P014RealizedSourcePosition[];
}

export declare function loadP014CertifiedRealizedSource(
  inputPath: string,
): Promise<P014CertifiedRealizedSource>;

export declare function readP014CertifiedRealizedSourceFacts(
  source: P014CertifiedRealizedSource,
): P014CertifiedRealizedFacts;
