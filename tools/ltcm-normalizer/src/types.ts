export const P010_WORKBOOK_SHA256 =
  'f805ea07155ec647eab8d7c0cb9e88bad578ceaa8674d48c5c219129023f9abf';
export const NORMALIZER_VERSION = '2.0.0';
export const EXPECTED_PROJECT_CODES = [
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

export type SheetKey = 'project_values' | 'monthly_revenue' | 'curve_s';
export type DiagnosticSeverity = 'warning' | 'error';
export type MappingStatus = 'mapped' | 'evidence_only' | 'pending_decision' | 'ambiguous';
export type PlanAction = 'insert' | 'no_op' | 'conflict' | 'rejected' | 'pending_decision';
export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export interface ExistingLegacyImportBatchReference {
  kind: 'existing';
  import_batch_id: string;
}

export interface PlannedLegacyImportBatchReference {
  kind: 'planned';
  planned_key: string;
  idempotency_key: string;
  source_manifest_hash: string;
  source_hash: string;
}

export type LegacyImportBatchReference =
  ExistingLegacyImportBatchReference | PlannedLegacyImportBatchReference;

export interface RawCell {
  column_index: number;
  column_letter: string;
  address: string;
  value: string | number | boolean | null;
  formula: string | null;
  data_type: string;
  number_format: string | null;
  state: string;
  formatted_text?: string;
  round_trip_text?: string;
}

export interface P010Row {
  payload_schema_version: number;
  source_row_number: number;
  source_range: string;
  row_kind: string;
  row_hash: string;
  status: string;
  validation_attempt: number;
  raw_payload: {
    schema_version: number;
    sheet_key: SheetKey;
    sheet_name: string;
    row_number: number;
    source_range: string;
    cells: RawCell[];
  };
}

export interface SourceCoordinate {
  sheet_key: SheetKey;
  sheet_name: string;
  source_row_number: number;
  source_range: string;
  cell_address: string;
  row_hash: string;
  workbook_hash: string;
}

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  entity: 'source' | 'client' | 'project' | 'boundary';
  entity_key: string | null;
  message: string;
  decision_required: string | null;
  origin: SourceCoordinate | null;
  hash: string;
}

export interface MappingEvidence {
  entity: 'client' | 'project';
  entity_key: string;
  source_field: string;
  source_header: string;
  source_coordinate: string;
  raw_value: string | number | boolean | null;
  normalized_value: string | null;
  target_field: string | null;
  mapping_status: MappingStatus;
  mapping_reason: string;
  origin: SourceCoordinate;
  hash: string;
}

export interface ClientCandidate {
  candidate_id: string;
  client_ref: string;
  raw_names: string[];
  normalized_name: string;
  match_key: string;
  status: 'valid' | 'ambiguous' | 'rejected';
  action: PlanAction;
  matched_client_id: string | null;
  possible_matches: string[];
  origins: SourceCoordinate[];
  diagnostic_codes: string[];
  source_manifest_hash: string;
  hash: string;
}

export interface FinancialEvidence {
  raw_number: number;
  decimal_round_trip_string: string;
  formatted_text: string | null;
  number_format: string | null;
  coordinate: string;
  row_hash: string;
  mapping_status: MappingStatus;
  target_field: string | null;
}

export interface ProjectCandidate {
  candidate_id: string;
  raw_codes: string[];
  project_code: string;
  raw_project_label: string;
  project_name_proposal: string;
  project_name_mapping_status: MappingStatus;
  client_match_key: string | null;
  client_candidate_id: string | null;
  client_id: string | null;
  currency: string | null;
  raw_classifications: string[];
  classification: 'full_contract' | 'demand' | 'opening_balance' | null;
  operational_status: ProjectStatus | null;
  contract_value: string | null;
  data_reference_date: string | null;
  legacy_import_batch_reference: LegacyImportBatchReference | null;
  matched_legacy_import_batch_id: string | null;
  value_evidence: FinancialEvidence[];
  receipt_forecast_evidence: FinancialEvidence[];
  action: PlanAction;
  origins: SourceCoordinate[];
  diagnostic_codes: string[];
  source_manifest_hash: string;
  hash: string;
}

export interface ClientIdentityResolution {
  type: 'client_identity';
  candidate_id: string;
  candidate_hash: string;
  identity: { kind: 'create_new' } | { kind: 'use_existing'; client_id: string };
}

export interface ProjectResolution {
  type: 'project';
  candidate_id: string;
  candidate_hash: string;
  approved_name?: string;
  approved_status?: ProjectStatus;
}

export type ReviewedResolution = ClientIdentityResolution | ProjectResolution;

export interface ReviewedResolutionDocument {
  contract: 'ltcm.p011.reviewed-resolutions.v1';
  normalizer_version: string;
  normalization_manifest_hash: string;
  p010_manifest_hash: string;
  input_hash: string;
  snapshot_hash: string;
  candidate_set_hash: string;
  resolutions: ReviewedResolution[];
}

export interface ReviewBinding {
  contract: 'ltcm.p011.review-binding.v1';
  normalizer_version: string;
  normalization_manifest_hash: string;
  p010_manifest_hash: string;
  input_hash: string;
  snapshot_hash: string;
  candidate_set_hash: string;
}

export interface ResolutionDiagnostic {
  code: 'REVIEWED_RESOLUTION_PARTIAL';
  entity: 'client' | 'project';
  candidate_id: string;
}

export interface ResolutionSummary {
  contract: 'ltcm.p011.resolution-summary.v1';
  document_hash: string;
  binding_hash: string;
  applied_client_identities: number;
  applied_project_names: number;
  applied_project_statuses: number;
  pending_clients: number;
  pending_projects: number;
  diagnostics: ResolutionDiagnostic[];
}

export interface ExistingSnapshotV1 {
  contract: 'ltcm.p011.existing-snapshot.v1';
  currencies: Array<{ code: string; active: boolean }>;
  clients: Array<{
    id: string;
    legal_name: string;
    display_name: string;
    tax_id: string | null;
    active: boolean;
    deleted_at: string | null;
    row_version: number;
  }>;
  projects: Array<{
    id: string;
    project_code: string;
    project_name: string;
    client_id: string;
    classification: 'full_contract' | 'demand' | 'opening_balance';
    status: 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
    base_currency: string;
    contract_value: string;
    data_reference_date: string;
    deleted_at: string | null;
    version: number;
  }>;
}

export interface ExistingSnapshotV2 {
  contract: 'ltcm.p011.existing-snapshot.v2';
  currencies: ExistingSnapshotV1['currencies'];
  clients: ExistingSnapshotV1['clients'];
  projects: Array<{
    id: string;
    project_code: string;
    project_name: string;
    client_id: string;
    classification: 'full_contract' | 'demand' | 'opening_balance';
    status: 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
    base_currency: string;
    contract_value: string;
    data_reference_date: string | null;
    legacy_import_batch_id: string | null;
    deleted_at: string | null;
    version: number;
  }>;
}

export interface ExistingImportBatchEvidence {
  id: string;
  idempotency_key: string | null;
  source_hash: string | null;
}

export interface ExistingSnapshot {
  contract: 'ltcm.p011.existing-snapshot.v3';
  currencies: ExistingSnapshotV1['currencies'];
  clients: ExistingSnapshotV1['clients'];
  import_batches: ExistingImportBatchEvidence[];
  projects: ExistingSnapshotV2['projects'];
}

export interface ImportPlanOperation {
  order: number;
  entity: 'import_batch' | 'client' | 'project';
  natural_key: string;
  action: PlanAction;
  dependencies: string[];
  expected_result: string;
  origin_hashes: string[];
  candidate_hash: string;
  status: 'planned' | 'blocked' | 'requires_review';
}

export interface P011Artifacts {
  manifest: Record<string, unknown>;
  sourceValidation: Record<string, unknown>;
  clients: ClientCandidate[];
  projects: ProjectCandidate[];
  mappings: MappingEvidence[];
  divergences: Diagnostic[];
  importPlan: { contract: string; operations: ImportPlanOperation[] };
  validationSummary: Record<string, unknown>;
  resolutionSummary?: ResolutionSummary;
  report: string;
}

export type P012ItemStatus =
  'persistence_ready' | 'unchanged' | 'blocked' | 'requires_review' | 'rejected';

export const P012_ITEM_DIAGNOSTIC_CODES = [
  'P012_TEXT_INVALID',
  'P012_DECIMAL_INVALID',
  'P012_UNIT_UNRESOLVED',
  'P012_CURRENCY_UNRESOLVED',
  'P012_TOTAL_EVIDENCE_MISMATCH',
  'P012_UNIT_CATALOG_UNAVAILABLE',
  'P012_CURRENCY_CATALOG_UNAVAILABLE',
  'P012_PROJECT_NOT_ELIGIBLE',
  'P012_PROJECT_TARGET_UNRESOLVED',
  'P012_ITEM_CONFLICT',
] as const;

export type P012ItemDiagnosticCode = (typeof P012_ITEM_DIAGNOSTIC_CODES)[number];

export interface P012ItemProjectReference {
  project_candidate_id: string;
  project_candidate_hash: string;
  project_code: string;
  project_action: PlanAction;
  project_target_id: string | null;
}

export interface P012ItemCellEvidence {
  column: 'A' | 'B' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';
  address: string;
  raw_value: string | number | boolean | null;
  round_trip_text: string | null;
  formatted_text: string | null;
  number_format: string | null;
}

export interface P012ItemSourceLineage {
  p010_manifest_hash: string;
  input_hash: string;
  workbook_hash: string;
  sheet_key: 'monthly_revenue';
  sheet_name: string;
  physical_row: number;
  source_range: string;
  row_hash: string;
  source_item_number: number;
  project_candidate_id: string;
  project_candidate_hash: string;
  source_line_key: string;
}

export interface ItemCandidate {
  contract: 'ltcm.p012.item-candidate.v1';
  payload_schema_version: 1;
  candidate_id: string;
  source_line_key: string;
  source_item_number: number;
  line_number: number;
  project: P012ItemProjectReference;
  item_code: string | null;
  description: string | null;
  quantity: string | null;
  unit_code: 'UN' | 'SERV' | 'US' | null;
  currency_code: string | null;
  unit_price: string | null;
  total_amount: string | null;
  action: PlanAction;
  status: P012ItemStatus;
  target_id: string | null;
  diagnostic_codes: P012ItemDiagnosticCode[];
  origins: SourceCoordinate[];
  evidence: P012ItemCellEvidence[];
  source_lineage: P012ItemSourceLineage;
  candidate_hash: string;
}

export interface P012ExistingItemsSnapshot {
  contract: 'ltcm.p012.existing-items-snapshot.v1';
  currencies: Array<{ code: string; active: boolean }>;
  units: Array<{ code: 'UN' | 'SERV' | 'US'; active: boolean }>;
  projects: Array<{
    id: string;
    project_candidate_id: string;
    project_code: string;
    currency_code: string;
    active: boolean;
    deleted_at: string | null;
  }>;
  items: Array<{
    id: string;
    project_id: string;
    source_line_key: string;
    line_number: number;
    item_code: string | null;
    description: string | null;
    quantity: string;
    unit_code: 'UN' | 'SERV' | 'US';
    currency_code: string;
    unit_price: string;
    total_amount: string;
    active: boolean;
    deleted_at: string | null;
    row_version: number;
  }>;
}

export interface P012ItemCandidateSet {
  contract: 'ltcm.p012.item-candidate-set.v1';
  payload_schema_version: 1;
  p010_manifest_hash: string;
  input_hash: string;
  p011_artifacts_hash: string;
  snapshot_hash: string;
  candidate_set_hash: string;
  candidates: ItemCandidate[];
  summary: {
    attempted_rows: number;
    candidate_count: number;
    action_counts: Record<PlanAction, number>;
    persistence_ready: boolean;
    remote_access: false;
    p013_fields_consumed: 0;
    p014_fields_consumed: 0;
  };
}
