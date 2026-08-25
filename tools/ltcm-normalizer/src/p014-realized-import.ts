import {
  readP014CertifiedRealizedSourceFacts,
  type P014CertifiedRealizedSource,
  type P014RealizedSourcePosition,
} from '@ltcm/extractor/p014';

import { sha256Canonical } from './canonical-json.js';

export const P014_REALIZED_IMPORT_CONTRACT = 'ltcm.p014.realized-import.v1' as const;
export const P014_REALIZED_DRY_RUN_CONTRACT = 'ltcm.p014.realized-dry-run.v1' as const;
export const P014_REALIZED_SOURCE_KEY_CONTRACT = 'ltcm.p014.realized-source-key.v1' as const;

export type P014MigratabilityStatus =
  'NON_MIGRATABLE_MISSING_COMPETENCE' | 'NON_MIGRATABLE_INSUFFICIENT_GRAIN';

export interface P014RealizedImportFact extends P014RealizedSourcePosition {
  source_key: string;
  project_resolution:
    | { status: 'source_identity_available'; project_code: string }
    | { status: 'unavailable_at_source_grain'; project_code: null };
  item_resolution: { status: 'not_applicable_source_is_not_item_level'; project_item_id: null };
  competence_resolution:
    | { status: 'authoritative'; competence_month: string }
    | { status: 'missing_at_source_grain'; competence_month: null };
  target_actual_status: null;
  migratability_status: P014MigratabilityStatus;
  reason_code:
    | 'PROJECT_AGGREGATE_HAS_NO_AUTHORITATIVE_COMPETENCE'
    | 'PORTFOLIO_MONTH_HAS_NO_AUTHORITATIVE_PROJECT';
  fact_fingerprint: string;
}

export interface P014RealizedControlledImpossibilityReport {
  contract: typeof P014_REALIZED_IMPORT_CONTRACT;
  status: 'controlled_impossibility';
  normative_realized_meaning: 'what_actually_happened_or_was_concretized';
  source_artifact: {
    source_name: string;
    source_sha256: string;
    source_size_bytes: number;
    source_semantic_fingerprint: string;
  };
  classification: readonly [
    'PROJECT_AGGREGATE_REALIZED',
    'OTHER_EVIDENCE_BASED_GRAIN:PORTFOLIO_MONTH_REALIZED',
    'INSUFFICIENT_FOR_MIGRATION',
  ];
  schema_classification: 'SCHEMA_INCOMPATIBLE';
  target_table: 'ltc_m.financial_actual_events';
  target_required_dimensions: readonly ['project_id', 'competence_date'];
  facts: readonly P014RealizedImportFact[];
  summary: {
    position_count: 18;
    fact_count: 10;
    blank_count: 8;
    explicit_zero_count: 6;
    non_zero_count: 4;
    migratable_count: 0;
    non_migratable_count: 10;
    pending_decision_count: 0;
    conflict_count: 0;
    project_aggregate_total: string;
    portfolio_month_total: string;
  };
  missing_dimensions: readonly [
    {
      grain: 'project_aggregate';
      missing: readonly ['competence'];
      affected_fact_count: 9;
      canonical_total: string;
    },
    {
      grain: 'portfolio_month';
      missing: readonly ['project'];
      affected_fact_count: 1;
      canonical_total: string;
    },
  ];
  required_to_unblock: readonly [
    'authoritative project-level billing_actual competence/date breakdown for Valores Projetos LTC-M!C4:K4',
    'authoritative project breakdown for Curva S!C12 without forecast-based allocation',
    'authoritative target actual_status rule or source evidence before persistence',
  ];
  provenance_chain: readonly [
    'source_artifact',
    'worksheet',
    'physical_row_and_cell',
    'source_identity',
    'project_or_portfolio_scope',
    'competence_when_present',
    'metric_type',
    'raw_decimal',
    'canonical_decimal',
    'non_migratable_classification',
  ];
  artifact_model: {
    p013_monthly_source_artifact_reused_for_persistence: false;
    reason: 'P013_ARTIFACT_CONTRACT_IS_BILLING_PLANNED_AND_SINGLE_WORKSHEET';
    generic_import_batch_created: false;
  };
  dry_run: {
    contract: typeof P014_REALIZED_DRY_RUN_CONTRACT;
    database_access: 'none';
    transaction_read_only: true;
    select_statement_count: 0;
    write_statement_count: 0;
    expected_write_count: 0;
  };
  arbitrary_allocation_performed: false;
  planned_values_used_to_manufacture_realized: false;
  persistence_implemented: false;
  report_fingerprint: string;
}

function compare(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function sourceKey(position: P014RealizedSourcePosition): string {
  return `p014-realized-v1:${sha256Canonical({
    contract: P014_REALIZED_SOURCE_KEY_CONTRACT,
    metric_type: position.metric_type,
    authoritative_grain: position.authoritative_grain,
    project_code: position.project_code,
    competence_month: position.competence_month,
  })}`;
}

function importFact(position: P014RealizedSourcePosition): P014RealizedImportFact {
  const key = sourceKey(position);
  const shared = {
    ...position,
    source_key: key,
    item_resolution: {
      status: 'not_applicable_source_is_not_item_level' as const,
      project_item_id: null,
    },
    target_actual_status: null,
  };
  const classified =
    position.authoritative_grain === 'project_aggregate'
      ? {
          ...shared,
          project_resolution: {
            status: 'source_identity_available' as const,
            project_code: position.project_code!,
          },
          competence_resolution: {
            status: 'missing_at_source_grain' as const,
            competence_month: null,
          },
          migratability_status: 'NON_MIGRATABLE_MISSING_COMPETENCE' as const,
          reason_code: 'PROJECT_AGGREGATE_HAS_NO_AUTHORITATIVE_COMPETENCE' as const,
        }
      : {
          ...shared,
          project_resolution: {
            status: 'unavailable_at_source_grain' as const,
            project_code: null,
          },
          competence_resolution: {
            status: 'authoritative' as const,
            competence_month: position.competence_month!,
          },
          migratability_status: 'NON_MIGRATABLE_INSUFFICIENT_GRAIN' as const,
          reason_code: 'PORTFOLIO_MONTH_HAS_NO_AUTHORITATIVE_PROJECT' as const,
        };
  return deepFreeze({
    ...classified,
    fact_fingerprint: sha256Canonical({
      contract: 'ltcm.p014.realized-import-fact.v1',
      ...classified,
    }),
  });
}

function buildReport(
  source: P014CertifiedRealizedSource,
  positions: readonly P014RealizedSourcePosition[],
): P014RealizedControlledImpossibilityReport {
  const projectPositions = positions.filter(
    (candidate) => candidate.authoritative_grain === 'project_aggregate',
  );
  const portfolioPositions = positions.filter(
    (candidate) => candidate.authoritative_grain === 'portfolio_month',
  );
  if (
    positions.length !== 18 ||
    projectPositions.length !== 9 ||
    portfolioPositions.length !== 9 ||
    positions.filter((candidate) => candidate.declaration_state !== 'blank').length !== 10 ||
    positions.filter((candidate) => candidate.declaration_state === 'blank').length !== 8 ||
    positions.filter((candidate) => candidate.declaration_state === 'explicit_zero').length !== 6 ||
    positions.filter((candidate) => candidate.declaration_state === 'value').length !== 4 ||
    projectPositions.some(
      (candidate) =>
        candidate.project_code === null ||
        candidate.competence_month !== null ||
        candidate.item_identity !== null,
    ) ||
    portfolioPositions.some(
      (candidate) =>
        candidate.project_code !== null ||
        candidate.competence_month === null ||
        candidate.item_identity !== null,
    ) ||
    positions.some(
      (candidate) =>
        (candidate.declaration_state === 'blank') !== (candidate.canonical_amount === null) ||
        (candidate.declaration_state === 'explicit_zero' &&
          candidate.canonical_amount !== '0.00') ||
        (candidate.declaration_state === 'value' && candidate.canonical_amount === '0.00'),
    )
  ) {
    throw new Error('P014_REPORT_SOURCE_FACTS_INVALID');
  }
  const facts = positions
    .filter((candidate) => candidate.declaration_state !== 'blank')
    .map(importFact)
    .sort((left, right) => compare(left.source_key, right.source_key));
  if (new Set(facts.map((fact) => fact.source_key)).size !== facts.length) {
    throw new Error('P014_REPORT_DUPLICATE_SOURCE_KEY');
  }
  const material = {
    contract: P014_REALIZED_IMPORT_CONTRACT,
    status: 'controlled_impossibility' as const,
    normative_realized_meaning: 'what_actually_happened_or_was_concretized' as const,
    source_artifact: {
      source_name: source.source_name,
      source_sha256: source.source_sha256,
      source_size_bytes: source.source_size_bytes,
      source_semantic_fingerprint: source.source_semantic_fingerprint,
    },
    classification: [
      'PROJECT_AGGREGATE_REALIZED',
      'OTHER_EVIDENCE_BASED_GRAIN:PORTFOLIO_MONTH_REALIZED',
      'INSUFFICIENT_FOR_MIGRATION',
    ] as const,
    schema_classification: 'SCHEMA_INCOMPATIBLE' as const,
    target_table: 'ltc_m.financial_actual_events' as const,
    target_required_dimensions: ['project_id', 'competence_date'] as const,
    facts,
    summary: {
      position_count: 18 as const,
      fact_count: 10 as const,
      blank_count: 8 as const,
      explicit_zero_count: 6 as const,
      non_zero_count: 4 as const,
      migratable_count: 0 as const,
      non_migratable_count: 10 as const,
      pending_decision_count: 0 as const,
      conflict_count: 0 as const,
      project_aggregate_total: source.project_aggregate_total,
      portfolio_month_total: source.portfolio_month_total,
    },
    missing_dimensions: [
      {
        grain: 'project_aggregate' as const,
        missing: ['competence'] as const,
        affected_fact_count: 9 as const,
        canonical_total: source.project_aggregate_total,
      },
      {
        grain: 'portfolio_month' as const,
        missing: ['project'] as const,
        affected_fact_count: 1 as const,
        canonical_total: source.portfolio_month_total,
      },
    ] as const,
    required_to_unblock: [
      'authoritative project-level billing_actual competence/date breakdown for Valores Projetos LTC-M!C4:K4',
      'authoritative project breakdown for Curva S!C12 without forecast-based allocation',
      'authoritative target actual_status rule or source evidence before persistence',
    ] as const,
    provenance_chain: [
      'source_artifact',
      'worksheet',
      'physical_row_and_cell',
      'source_identity',
      'project_or_portfolio_scope',
      'competence_when_present',
      'metric_type',
      'raw_decimal',
      'canonical_decimal',
      'non_migratable_classification',
    ] as const,
    artifact_model: {
      p013_monthly_source_artifact_reused_for_persistence: false as const,
      reason: 'P013_ARTIFACT_CONTRACT_IS_BILLING_PLANNED_AND_SINGLE_WORKSHEET' as const,
      generic_import_batch_created: false as const,
    },
    dry_run: {
      contract: P014_REALIZED_DRY_RUN_CONTRACT,
      database_access: 'none' as const,
      transaction_read_only: true as const,
      select_statement_count: 0 as const,
      write_statement_count: 0 as const,
      expected_write_count: 0 as const,
    },
    arbitrary_allocation_performed: false as const,
    planned_values_used_to_manufacture_realized: false as const,
    persistence_implemented: false as const,
  };
  return deepFreeze({
    ...material,
    report_fingerprint: sha256Canonical(material),
  });
}

export function createP014RealizedImportDryRun(
  source: P014CertifiedRealizedSource,
): P014RealizedControlledImpossibilityReport {
  const facts = readP014CertifiedRealizedSourceFacts(source);
  return buildReport(facts.public_identity, facts.positions);
}

/** Test-only pure derivation. It grants no source or persistence authority. */
export function deriveP014RealizedImportPreviewForTest(options: {
  source: P014CertifiedRealizedSource;
  positions: readonly P014RealizedSourcePosition[];
}): P014RealizedControlledImpossibilityReport {
  return buildReport(options.source, options.positions);
}
