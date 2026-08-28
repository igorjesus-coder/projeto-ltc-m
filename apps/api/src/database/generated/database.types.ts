/**
 * GENERATED FILE — DO NOT EDIT.
 * Source: docs/database/p017-schema-model.json
 * Regenerate with: npm run db:types:generate
 */
export const P017_SCHEMA_CONTRACT = 'ltcm.p017.schema-integrity.v1' as const;
export const P017_SCHEMA_FINGERPRINT =
  'b6d71494c7e561aea68b26ed6f658ed5e25fc72ea6b6b45a1bff4ffbc03f4893' as const;
export const P019_DATABASE_TYPES_CONTRACT = 'ltcm.p019.database-types.v1' as const;

/** Exact decimal text returned by the P019 pg parser; never an authoritative number. */
export type PgNumeric = string;
/** Exact int8 text returned by the P019 pg parser. */
export type PgBigInt = string;
export type PgUuid = string;
export type PgDate = string;
export type PgTimestamp = string;
export type PgTimestampTz = string;
export type JsonValue =
  string | number | boolean | null | { readonly [key: string]: JsonValue } | readonly JsonValue[];

export type ActualFinancialMetricEnum = 'billing_actual' | 'receipt_actual';

export type ActualStatusEnum = 'draft' | 'posted' | 'cancelled';

export type AppRoleEnum = 'viewer' | 'editor' | 'approver' | 'admin';

export type AuditOperationEnum =
  | 'INSERT'
  | 'UPDATE'
  | 'SUBMIT'
  | 'RETURN'
  | 'AUDIT_READ'
  | 'SOFT_DELETE'
  | 'RESTORE'
  | 'APPROVE'
  | 'LOCK'
  | 'REOPEN'
  | 'CANCEL';

export type ImportStatusEnum = 'received' | 'validating' | 'rejected' | 'loaded';

export type PlanStatusEnum = 'draft' | 'pending_approval' | 'approved' | 'locked' | 'archived';

export type PlannedFinancialMetricEnum = 'billing_planned' | 'receipt_forecast';

export type PlanningLevelEnum = 'project' | 'item';

export type ProjectClassificationEnum = 'full_contract' | 'demand' | 'opening_balance';

export type ProjectStatusEnum = 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export interface LtcMAppUsersRow {
  readonly id: PgUuid;
  readonly auth_subject: string;
  readonly email: string | null;
  readonly full_name: string;
  readonly role: AppRoleEnum;
  readonly active: boolean;
  readonly created_at: PgTimestampTz;
  readonly updated_at: PgTimestampTz;
  readonly row_version: PgBigInt;
}

export interface LtcMAuditLogRow {
  readonly id: PgBigInt;
  readonly table_name: string;
  readonly record_id: string;
  readonly operation: AuditOperationEnum;
  readonly old_data: JsonValue | null;
  readonly new_data: JsonValue | null;
  readonly changed_by_user_id: PgUuid | null;
  readonly request_id: string | null;
  readonly changed_at: PgTimestampTz;
  readonly actor_auth_subject: string | null;
  readonly source: string;
  readonly justification: string | null;
  readonly previous_row_version: PgBigInt | null;
  readonly new_row_version: PgBigInt | null;
  readonly metadata: JsonValue;
}

export interface LtcMClientsRow {
  readonly id: PgUuid;
  readonly legal_name: string;
  readonly display_name: string;
  readonly tax_id: string | null;
  readonly active: boolean;
  readonly created_by_user_id: PgUuid | null;
  readonly updated_by_user_id: PgUuid | null;
  readonly created_at: PgTimestampTz;
  readonly updated_at: PgTimestampTz;
  readonly deleted_at: PgTimestampTz | null;
  readonly row_version: PgBigInt;
}

export interface LtcMCurrenciesRow {
  readonly code: string;
  readonly name: string;
  readonly decimal_places: number;
  readonly active: boolean;
}

export interface LtcMFinancialActualEventsRow {
  readonly id: PgUuid;
  readonly project_id: PgUuid;
  readonly project_item_id: PgUuid | null;
  readonly metric_type: ActualFinancialMetricEnum;
  readonly competence_date: PgDate;
  readonly source_key: string;
  readonly document_number: string | null;
  readonly installment_key: string | null;
  readonly amount: PgNumeric;
  readonly currency_code: string;
  readonly status: ActualStatusEnum;
  readonly notes: string | null;
  readonly created_by_user_id: PgUuid;
  readonly updated_by_user_id: PgUuid | null;
  readonly created_at: PgTimestampTz;
  readonly updated_at: PgTimestampTz;
  readonly row_version: PgBigInt;
}

export interface LtcMFinancialPlanLinesRow {
  readonly id: PgUuid;
  readonly plan_version_id: PgUuid;
  readonly project_id: PgUuid;
  readonly project_item_id: PgUuid | null;
  readonly metric_type: PlannedFinancialMetricEnum;
  readonly planning_level: PlanningLevelEnum;
  readonly competence_month: PgDate;
  readonly amount: PgNumeric;
  readonly currency_code: string;
  readonly notes: string | null;
  readonly created_by_user_id: PgUuid;
  readonly updated_by_user_id: PgUuid | null;
  readonly created_at: PgTimestampTz;
  readonly updated_at: PgTimestampTz;
  readonly row_version: PgBigInt;
}

export interface LtcMFinancialPlanScopesRow {
  readonly id: PgUuid;
  readonly plan_version_id: PgUuid;
  readonly project_id: PgUuid;
  readonly metric_type: PlannedFinancialMetricEnum;
  readonly planning_level: PlanningLevelEnum;
  readonly currency_code: string;
  readonly created_by_user_id: PgUuid;
  readonly updated_by_user_id: PgUuid | null;
  readonly created_at: PgTimestampTz;
  readonly updated_at: PgTimestampTz;
  readonly row_version: PgBigInt;
}

export interface LtcMImportBatchSheetsRow {
  readonly id: PgUuid;
  readonly import_batch_id: PgUuid;
  readonly sheet_key: string;
  readonly sheet_name: string;
  readonly sheet_index: number;
  readonly detected_range: string | null;
  readonly first_row: number | null;
  readonly last_row: number | null;
  readonly found_rows: number;
  readonly staged_rows: number;
  readonly rejected_rows: number;
  readonly content_hash: string | null;
  readonly status: string;
  readonly technical_message: string | null;
  readonly metadata: JsonValue;
  readonly created_at: PgTimestampTz;
  readonly updated_at: PgTimestampTz;
  readonly row_version: PgBigInt;
  readonly created_by_user_id: PgUuid;
  readonly updated_by_user_id: PgUuid | null;
  readonly request_id: string | null;
}

export interface LtcMImportBatchesRow {
  readonly id: PgUuid;
  readonly source_name: string;
  readonly source_hash: string | null;
  readonly reference_date: PgDate | null;
  readonly status: ImportStatusEnum;
  readonly received_rows: number;
  readonly accepted_rows: number;
  readonly rejected_rows: number;
  readonly submitted_by_user_id: PgUuid;
  readonly created_at: PgTimestampTz;
  readonly completed_at: PgTimestampTz | null;
  readonly updated_at: PgTimestampTz;
  readonly row_version: PgBigInt;
  readonly source_size_bytes: PgBigInt | null;
  readonly source_mime_type: string | null;
  readonly payload_schema_version: number;
  readonly idempotency_key: string | null;
  readonly request_id: string | null;
  readonly started_at: PgTimestampTz | null;
  readonly sheet_count: number;
  readonly staged_rows: number;
  readonly valid_rows: number;
  readonly error_count: number;
  readonly technical_message: string | null;
  readonly metadata: JsonValue;
  readonly updated_by_user_id: PgUuid | null;
}

export interface LtcMImportRowErrorsRow {
  readonly id: PgBigInt;
  readonly batch_id: PgUuid;
  readonly sheet_name: string | null;
  readonly source_row: number | null;
  readonly entity_type: string | null;
  readonly natural_key: string | null;
  readonly error_code: string;
  readonly error_message: string;
  readonly raw_payload: JsonValue | null;
  readonly created_at: PgTimestampTz;
  readonly import_batch_sheet_id: PgUuid | null;
  readonly import_staging_row_id: PgUuid | null;
  readonly severity: string;
  readonly field_path: string | null;
  readonly raw_value: JsonValue | null;
  readonly technical_detail: string | null;
  readonly error_key: string | null;
  readonly request_id: string | null;
  readonly created_by_user_id: PgUuid | null;
}

export interface LtcMImportStagingRowsRow {
  readonly id: PgUuid;
  readonly import_batch_sheet_id: PgUuid;
  readonly source_row_number: number;
  readonly source_range: string | null;
  readonly row_kind: string | null;
  readonly payload_schema_version: number;
  readonly raw_payload: JsonValue;
  readonly row_hash: string;
  readonly status: string;
  readonly validation_attempt: number;
  readonly target_table: string | null;
  readonly target_record_id: PgUuid | null;
  readonly validated_at: PgTimestampTz | null;
  readonly processed_at: PgTimestampTz | null;
  readonly last_error_code: string | null;
  readonly last_error_summary: string | null;
  readonly created_at: PgTimestampTz;
  readonly updated_at: PgTimestampTz;
  readonly row_version: PgBigInt;
  readonly created_by_user_id: PgUuid;
  readonly updated_by_user_id: PgUuid | null;
  readonly request_id: string | null;
}

export interface LtcMMonthlyPlanBaselinesRow {
  readonly id: PgUuid;
  readonly plan_version_id: PgUuid;
  readonly metric_type: PlannedFinancialMetricEnum;
  readonly planning_level: PlanningLevelEnum;
  readonly semantic_contract_version: string;
  readonly semantic_fingerprint: string;
  readonly created_by_user_id: PgUuid;
  readonly created_at: PgTimestampTz;
}

export interface LtcMMonthlyPlanCellsRow {
  readonly id: PgUuid;
  readonly import_batch_id: PgUuid;
  readonly import_batch_sheet_id: PgUuid;
  readonly import_staging_row_id: PgUuid;
  readonly baseline_id: PgUuid;
  readonly baseline_semantic_fingerprint: string;
  readonly plan_version_id: PgUuid;
  readonly project_id: PgUuid;
  readonly project_item_id: PgUuid;
  readonly metric_type: PlannedFinancialMetricEnum;
  readonly planning_level: PlanningLevelEnum;
  readonly competence_month: PgDate;
  readonly source_line_key: string;
  readonly source_item_number: string;
  readonly source_row_number: number;
  readonly source_column: string;
  readonly source_cell_reference: string;
  readonly declaration_state: string;
  readonly source_numeric_text: string | null;
  readonly source_value_hash: string | null;
  readonly canonical_amount: PgNumeric | null;
  readonly financial_plan_line_id: PgUuid | null;
  readonly created_by_user_id: PgUuid;
  readonly created_at: PgTimestampTz;
}

export interface LtcMMonthlyPlanImportExecutionsRow {
  readonly id: PgUuid;
  readonly import_batch_id: PgUuid;
  readonly source_artifact_id: PgUuid;
  readonly source_sha256: string;
  readonly baseline_id: PgUuid;
  readonly baseline_semantic_fingerprint: string;
  readonly plan_version_id: PgUuid;
  readonly metric_type: PlannedFinancialMetricEnum;
  readonly planning_level: PlanningLevelEnum;
  readonly created_by_user_id: PgUuid;
  readonly created_at: PgTimestampTz;
}

export interface LtcMMonthlySourceArtifactsRow {
  readonly id: PgUuid;
  readonly source_sha256: string;
  readonly source_size_bytes: PgBigInt;
  readonly source_mime_type: string;
  readonly source_name: string;
  readonly source_contract_version: string;
  readonly worksheet_key: string;
  readonly worksheet_name: string;
  readonly structural_range: string;
  readonly source_semantic_fingerprint: string;
  readonly created_by_user_id: PgUuid;
  readonly created_at: PgTimestampTz;
}

export interface LtcMPlanVersionsRow {
  readonly id: PgUuid;
  readonly name: string;
  readonly reference_date: PgDate;
  readonly status: PlanStatusEnum;
  readonly is_baseline: boolean;
  readonly notes: string | null;
  readonly created_by_user_id: PgUuid;
  readonly approved_by_user_id: PgUuid | null;
  readonly approved_at: PgTimestampTz | null;
  readonly created_at: PgTimestampTz;
  readonly updated_at: PgTimestampTz;
  readonly row_version: PgBigInt;
  readonly updated_by_user_id: PgUuid | null;
  readonly source_plan_version_id: PgUuid | null;
}

export interface LtcMProjectItemsRow {
  readonly id: PgUuid;
  readonly project_id: PgUuid;
  readonly source_line_key: string;
  readonly line_number: number;
  readonly item_code: string | null;
  readonly description: string | null;
  readonly quantity: PgNumeric;
  readonly unit_code: string;
  readonly currency_code: string;
  readonly unit_price: PgNumeric;
  readonly total_amount: PgNumeric | null;
  readonly active: boolean;
  readonly notes: string | null;
  readonly created_by_user_id: PgUuid | null;
  readonly updated_by_user_id: PgUuid | null;
  readonly created_at: PgTimestampTz;
  readonly updated_at: PgTimestampTz;
  readonly deleted_at: PgTimestampTz | null;
  readonly row_version: PgBigInt;
}

export interface LtcMProjectsRow {
  readonly id: PgUuid;
  readonly project_code: string;
  readonly project_name: string;
  readonly client_id: PgUuid;
  readonly reporting_group: string | null;
  readonly classification: ProjectClassificationEnum;
  readonly status: ProjectStatusEnum;
  readonly base_currency: string;
  readonly contract_value: PgNumeric;
  readonly opening_balance: PgNumeric | null;
  readonly budget_cost: PgNumeric | null;
  readonly start_date: PgDate | null;
  readonly end_date: PgDate | null;
  readonly manager_user_id: PgUuid | null;
  readonly data_reference_date: PgDate | null;
  readonly notes: string | null;
  readonly version: number;
  readonly created_by_user_id: PgUuid | null;
  readonly updated_by_user_id: PgUuid | null;
  readonly created_at: PgTimestampTz;
  readonly updated_at: PgTimestampTz;
  readonly deleted_at: PgTimestampTz | null;
  readonly legacy_import_batch_id: PgUuid | null;
}

export interface LtcMUnitsRow {
  readonly code: string;
  readonly name: string;
  readonly category: string | null;
  readonly active: boolean;
}

export interface LtcMVTableauDataQualityRow {
  readonly analytics_contract: string | null;
  readonly reconciliation_contract: string | null;
  readonly finding_id: string | null;
  readonly finding_code: string | null;
  readonly severity: string | null;
  readonly domain: string | null;
  readonly project_id: PgUuid | null;
  readonly project_code: string | null;
  readonly project_item_id: PgUuid | null;
  readonly source_line_key: string | null;
  readonly competence_month: PgDate | null;
  readonly currency_code: string | null;
  readonly expected_value: PgNumeric | null;
  readonly observed_value: PgNumeric | null;
  readonly delta: PgNumeric | null;
  readonly remediation_class: string | null;
  readonly decision_reference: string | null;
  readonly source_reference: string | null;
  readonly database_reference: string | null;
  readonly finding_origin: string | null;
}

export interface LtcMVTableauFinancialMonthlyRow {
  readonly analytics_contract: string | null;
  readonly fact_kind: string | null;
  readonly analytical_fact_key: string | null;
  readonly financial_fact_id: PgUuid | null;
  readonly project_id: PgUuid | null;
  readonly project_code: string | null;
  readonly project_item_id: PgUuid | null;
  readonly source_line_key: string | null;
  readonly plan_version_id: PgUuid | null;
  readonly plan_version_name: string | null;
  readonly plan_status: string | null;
  readonly is_baseline: boolean | null;
  readonly competence_month: PgDate | null;
  readonly competence_date: PgDate | null;
  readonly metric_type: string | null;
  readonly financial_grain: string | null;
  readonly actual_status: string | null;
  readonly currency_code: string | null;
  readonly amount: PgNumeric | null;
  readonly baseline_id: PgUuid | null;
  readonly baseline_semantic_fingerprint: string | null;
  readonly declaration_state: string | null;
  readonly source_cell_reference: string | null;
  readonly source_value_hash: string | null;
  readonly database_reference: string | null;
  readonly p014_derived: boolean | null;
}

export interface LtcMVTableauPlanVersionsRow {
  readonly analytics_contract: string | null;
  readonly analytical_version_key: string | null;
  readonly plan_version_id: PgUuid | null;
  readonly plan_version_name: string | null;
  readonly reference_date: PgDate | null;
  readonly plan_status: string | null;
  readonly is_baseline: boolean | null;
  readonly source_plan_version_id: PgUuid | null;
  readonly created_at: PgTimestampTz | null;
  readonly updated_at: PgTimestampTz | null;
  readonly approved_at: PgTimestampTz | null;
  readonly row_version: PgBigInt | null;
  readonly financial_plan_scope_id: PgUuid | null;
  readonly project_id: PgUuid | null;
  readonly project_code: string | null;
  readonly metric_type: string | null;
  readonly planning_level: string | null;
  readonly currency_code: string | null;
  readonly baseline_id: PgUuid | null;
  readonly baseline_contract: string | null;
  readonly baseline_semantic_fingerprint: string | null;
  readonly source_execution_count: PgBigInt | null;
  readonly source_artifact_count: PgBigInt | null;
  readonly current_version_supported: boolean | null;
  readonly current_version_status: string | null;
}

export interface LtcMVTableauPortfolioOverviewRow {
  readonly analytics_contract: string | null;
  readonly currency_code: string | null;
  readonly project_count: PgBigInt | null;
  readonly active_project_count: PgBigInt | null;
  readonly contract_value_total: PgNumeric | null;
  readonly active_item_total: PgNumeric | null;
  readonly projects_without_items_count: PgBigInt | null;
  readonly contract_item_delta_total: PgNumeric | null;
  readonly actual_event_count: PgBigInt | null;
  readonly billing_actual_draft_amount: PgNumeric | null;
  readonly billing_actual_posted_amount: PgNumeric | null;
  readonly billing_actual_cancelled_amount: PgNumeric | null;
  readonly billing_actual_canonical_amount: PgNumeric | null;
  readonly billing_actual_canonical_status: string | null;
  readonly billing_remaining_amount: PgNumeric | null;
  readonly billing_remaining_status: string | null;
}

export interface LtcMVTableauProjectItemsRow {
  readonly analytics_contract: string | null;
  readonly project_item_id: PgUuid | null;
  readonly project_id: PgUuid | null;
  readonly project_code: string | null;
  readonly client_id: PgUuid | null;
  readonly source_line_key: string | null;
  readonly line_number: number | null;
  readonly item_code: string | null;
  readonly description: string | null;
  readonly quantity: PgNumeric | null;
  readonly unit_code: string | null;
  readonly currency_code: string | null;
  readonly unit_price: PgNumeric | null;
  readonly total_amount: PgNumeric | null;
  readonly active: boolean | null;
  readonly created_at: PgTimestampTz | null;
  readonly updated_at: PgTimestampTz | null;
  readonly row_version: PgBigInt | null;
  readonly database_reference: string | null;
}

export interface LtcMVTableauProjectOverviewRow {
  readonly analytics_contract: string | null;
  readonly project_id: PgUuid | null;
  readonly project_code: string | null;
  readonly project_name: string | null;
  readonly client_id: PgUuid | null;
  readonly client_display_name: string | null;
  readonly reporting_group: string | null;
  readonly project_classification: string | null;
  readonly project_status: string | null;
  readonly currency_code: string | null;
  readonly contract_value: PgNumeric | null;
  readonly opening_balance: PgNumeric | null;
  readonly budget_cost: PgNumeric | null;
  readonly data_reference_date: PgDate | null;
  readonly legacy_import_batch_id: PgUuid | null;
  readonly active_item_count: PgBigInt | null;
  readonly active_item_total: PgNumeric | null;
  readonly contract_item_delta: PgNumeric | null;
  readonly project_reconciliation_status: string | null;
  readonly actual_event_count: PgBigInt | null;
  readonly actual_competence_count: PgBigInt | null;
  readonly project_month_actual_available: boolean | null;
  readonly billing_actual_draft_amount: PgNumeric | null;
  readonly billing_actual_posted_amount: PgNumeric | null;
  readonly billing_actual_cancelled_amount: PgNumeric | null;
  readonly billing_actual_canonical_amount: PgNumeric | null;
  readonly billing_actual_canonical_status: string | null;
  readonly billing_remaining_amount: PgNumeric | null;
  readonly billing_remaining_status: string | null;
}

export interface LtcMVTableauSCurvePortfolioRow {
  readonly analytics_contract: string | null;
  readonly series_kind: string | null;
  readonly plan_version_id: PgUuid | null;
  readonly plan_version_name: string | null;
  readonly plan_status: string | null;
  readonly is_baseline: boolean | null;
  readonly actual_status: string | null;
  readonly competence_month: PgDate | null;
  readonly metric_type: string | null;
  readonly currency_code: string | null;
  readonly monthly_amount: PgNumeric | null;
  readonly cumulative_amount: PgNumeric | null;
  readonly source_grain: string | null;
  readonly availability_status: string | null;
}

export interface LtcMVTableauSCurveProjectRow {
  readonly analytics_contract: string | null;
  readonly series_kind: string | null;
  readonly project_id: PgUuid | null;
  readonly project_code: string | null;
  readonly plan_version_id: PgUuid | null;
  readonly plan_version_name: string | null;
  readonly plan_status: string | null;
  readonly is_baseline: boolean | null;
  readonly actual_status: string | null;
  readonly competence_month: PgDate | null;
  readonly metric_type: string | null;
  readonly currency_code: string | null;
  readonly monthly_amount: PgNumeric | null;
  readonly cumulative_amount: PgNumeric | null;
  readonly source_grain: string | null;
  readonly availability_status: string | null;
}

export interface LtcMVTableauSourceProvenanceRow {
  readonly analytics_contract: string | null;
  readonly monthly_plan_cell_id: PgUuid | null;
  readonly baseline_id: PgUuid | null;
  readonly baseline_semantic_fingerprint: string | null;
  readonly plan_version_id: PgUuid | null;
  readonly project_id: PgUuid | null;
  readonly project_code: string | null;
  readonly project_item_id: PgUuid | null;
  readonly source_line_key: string | null;
  readonly metric_type: string | null;
  readonly planning_level: string | null;
  readonly competence_month: PgDate | null;
  readonly declaration_state: string | null;
  readonly canonical_amount: PgNumeric | null;
  readonly financial_plan_line_id: PgUuid | null;
  readonly source_row_number: number | null;
  readonly source_column: string | null;
  readonly source_cell_reference: string | null;
  readonly source_numeric_text: string | null;
  readonly source_value_hash: string | null;
  readonly import_batch_id: PgUuid | null;
  readonly import_batch_sheet_id: PgUuid | null;
  readonly import_staging_row_id: PgUuid | null;
  readonly sheet_key: string | null;
  readonly sheet_name: string | null;
  readonly source_range: string | null;
  readonly baseline_contract: string | null;
  readonly source_artifact_id: PgUuid | null;
  readonly source_name: string | null;
  readonly source_sha256: string | null;
  readonly source_semantic_fingerprint: string | null;
  readonly import_idempotency_key: string | null;
}

export interface LtcMTableRows {
  readonly app_users: LtcMAppUsersRow;
  readonly audit_log: LtcMAuditLogRow;
  readonly clients: LtcMClientsRow;
  readonly currencies: LtcMCurrenciesRow;
  readonly financial_actual_events: LtcMFinancialActualEventsRow;
  readonly financial_plan_lines: LtcMFinancialPlanLinesRow;
  readonly financial_plan_scopes: LtcMFinancialPlanScopesRow;
  readonly import_batch_sheets: LtcMImportBatchSheetsRow;
  readonly import_batches: LtcMImportBatchesRow;
  readonly import_row_errors: LtcMImportRowErrorsRow;
  readonly import_staging_rows: LtcMImportStagingRowsRow;
  readonly monthly_plan_baselines: LtcMMonthlyPlanBaselinesRow;
  readonly monthly_plan_cells: LtcMMonthlyPlanCellsRow;
  readonly monthly_plan_import_executions: LtcMMonthlyPlanImportExecutionsRow;
  readonly monthly_source_artifacts: LtcMMonthlySourceArtifactsRow;
  readonly plan_versions: LtcMPlanVersionsRow;
  readonly project_items: LtcMProjectItemsRow;
  readonly projects: LtcMProjectsRow;
  readonly units: LtcMUnitsRow;
}

export interface LtcMViewRows {
  readonly v_tableau_data_quality: LtcMVTableauDataQualityRow;
  readonly v_tableau_financial_monthly: LtcMVTableauFinancialMonthlyRow;
  readonly v_tableau_plan_versions: LtcMVTableauPlanVersionsRow;
  readonly v_tableau_portfolio_overview: LtcMVTableauPortfolioOverviewRow;
  readonly v_tableau_project_items: LtcMVTableauProjectItemsRow;
  readonly v_tableau_project_overview: LtcMVTableauProjectOverviewRow;
  readonly v_tableau_s_curve_portfolio: LtcMVTableauSCurvePortfolioRow;
  readonly v_tableau_s_curve_project: LtcMVTableauSCurveProjectRow;
  readonly v_tableau_source_provenance: LtcMVTableauSourceProvenanceRow;
}

export type LtcMTableName = keyof LtcMTableRows;
export type LtcMViewName = keyof LtcMViewRows;
export type LtcMTableRow<Name extends LtcMTableName> = LtcMTableRows[Name];
export type LtcMViewRow<Name extends LtcMViewName> = LtcMViewRows[Name];
