import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ActorContext } from '../database/transaction.js';
import { DatabaseService } from '../database/database.service.js';
import {
  deriveP034DuplicateFindings,
  type P034DuplicateFinding,
  type P034DuplicatePayload,
  type P034ProvenanceReference,
} from './p015-duplicate-adapter.js';
import {
  P034_DATA_QUALITY_CONTRACT,
  type QualityFinding,
  type QualityOriginEntity,
  type QualityQuery,
  type QualityReference,
  type QualityResponse,
  type QualityRuleCode,
  type QualitySeverity,
} from './quality.types.js';

interface QualityRow {
  readonly id: string;
  readonly project_id: string;
  readonly project_code: string;
  readonly project_name: string;
  readonly rule_code: string;
  readonly severity: string;
  readonly expected_value: string | null;
  readonly observed_value: string | null;
  readonly delta: string | null;
  readonly currency_code: string | null;
  readonly finding_origin: string | null;
  readonly origin_entity: string;
  readonly origin_entity_id: string | null;
  readonly source_reference: string | null;
  readonly database_reference: string | null;
  readonly evidence: Record<string, unknown> | null;
  readonly explanation: string | null;
  readonly remediation: string | null;
  readonly provenance_payload: P034DuplicatePayload | null;
  readonly total_items: string;
}

const MATERIAL_ACTUAL_FILTER = `events.metric_type = 'billing_actual'
    and events.status = 'posted'`;

const SNAPSHOT_GUARD_SQL = `
with latest_snapshots as (
  select distinct on (snapshots.project_id) snapshots.project_id
  from ltc_m.p034_provenance_snapshots as snapshots
  join ltc_m.projects as projects on projects.id = snapshots.project_id
  where snapshots.status = 'success'
    and projects.status = 'active'
    and projects.deleted_at is null
    and ($1::uuid is null or snapshots.project_id = $1::uuid)
  order by snapshots.project_id, snapshots.authority_revision desc
)
select count(*)::bigint as snapshot_count
from latest_snapshots`;

export interface ActualEventQualityInput {
  readonly metricType: string;
  readonly status: string;
}

export function isMaterialBillingActual(event: ActualEventQualityInput): boolean {
  return event.metricType === 'billing_actual' && event.status === 'posted';
}

export interface QualityClock {
  readonly now: () => Date;
}

@Injectable()
export class SystemQualityClock implements QualityClock {
  now(): Date {
    return new Date();
  }
}

const RULE_LABELS: Readonly<Record<QualityRuleCode, string>> = {
  PROJECT_VALUE_MISMATCH: 'Contrato x item',
  UNPLANNED_BALANCE: 'Saldo não programado',
  MISSING_REQUIRED_FIELD: 'Item incompleto',
  PROJECT_DATA_STALE: 'Projeto desatualizado',
  DUPLICATE_PROJECT_SOURCE_IDENTITY: 'Duplicidade',
  DUPLICATE_ITEM_SOURCE_IDENTITY: 'Duplicidade',
  GRAIN_MISMATCH: 'Divergência de moeda/unidade',
};

const SORT_EXPRESSIONS = {
  severity: 'severity_rank',
  project: 'project_code',
  rule: 'rule_code',
  origin: 'origin_entity',
  id: 'id',
} as const;

const FINDINGS_SQL = `
with latest_snapshots as (
  select distinct on (snapshots.project_id)
    snapshots.id,
    snapshots.project_id
  from ltc_m.p034_provenance_snapshots as snapshots
  join ltc_m.projects as projects on projects.id = snapshots.project_id
  where snapshots.status = 'success'
    and projects.status = 'active'
    and projects.deleted_at is null
  order by snapshots.project_id, snapshots.authority_revision desc
), p016_findings as (
  select
    quality.finding_id as id,
    quality.project_id,
    quality.project_code,
    projects.project_name,
    quality.finding_code as rule_code,
    quality.severity,
    quality.expected_value::text as expected_value,
    quality.observed_value::text as observed_value,
    quality.delta::text as delta,
    quality.currency_code,
    quality.finding_origin,
    'project'::text as origin_entity,
    coalesce(quality.project_item_id, quality.project_id) as origin_entity_id,
    quality.source_reference,
    quality.database_reference,
    null::jsonb as evidence,
    null::text as explanation,
    quality.remediation_class as remediation,
    null::jsonb as provenance_payload
  from ltc_m.v_tableau_data_quality as quality
  join ltc_m.projects as projects on projects.id = quality.project_id
  where quality.finding_id is not null
    and quality.finding_code = 'PROJECT_VALUE_MISMATCH'
), incomplete_findings as (
  select
    concat('p034:missing-required-field:', items.id::text, ':', missing.field_name) as id,
    projects.id as project_id,
    projects.project_code,
    projects.project_name,
    'MISSING_REQUIRED_FIELD'::text as rule_code,
    'ERROR'::text as severity,
    null::text as expected_value,
    null::text as observed_value,
    null::text as delta,
    projects.base_currency as currency_code,
    'p015_database_projection'::text as finding_origin,
    'project_item'::text as origin_entity,
    items.id as origin_entity_id,
    null::text as source_reference,
    concat('ltc_m.project_items:', items.id::text) as database_reference,
    jsonb_build_object('field', missing.field_name, 'sourceLineKey', items.source_line_key) as evidence,
    concat('Required item field is missing: ', missing.field_name) as explanation,
    'correct_database'::text as remediation,
    null::jsonb as provenance_payload
  from ltc_m.project_items as items
  join ltc_m.projects as projects on projects.id = items.project_id
  cross join lateral (
    values
      ('description', nullif(btrim(items.description), '') is null),
      ('quantity', items.quantity is null),
      ('unit_code', nullif(btrim(items.unit_code), '') is null),
      ('currency_code', nullif(btrim(items.currency_code), '') is null)
  ) as missing(field_name, is_missing)
  where items.active
    and items.deleted_at is null
    and projects.deleted_at is null
    and missing.is_missing
), stale_findings as (
  select
    concat('p034:project-data-stale:', projects.id::text) as id,
    projects.id as project_id,
    projects.project_code,
    projects.project_name,
    'PROJECT_DATA_STALE'::text as rule_code,
    'WARNING'::text as severity,
    null::text as expected_value,
    projects.updated_at::text as observed_value,
    null::text as delta,
    projects.base_currency as currency_code,
    'projects'::text as finding_origin,
    'project'::text as origin_entity,
    projects.id as origin_entity_id,
    null::text as source_reference,
    concat('ltc_m.projects:', projects.id::text) as database_reference,
    jsonb_build_object('evaluatedAt', $2::timestamptz, 'thresholdDays', 30) as evidence,
    'Project data is older than the 30-day freshness threshold.'::text as explanation,
    'correct_database'::text as remediation,
    null::jsonb as provenance_payload
  from ltc_m.projects as projects
  where projects.deleted_at is null
    and projects.updated_at is not null
    and $2::timestamptz - projects.updated_at > interval '30 days'
), official_plan_counts as (
  select scopes.project_id, count(distinct scopes.plan_version_id)::integer as official_plan_count
  from ltc_m.financial_plan_scopes as scopes
  join ltc_m.plan_versions as versions on versions.id = scopes.plan_version_id
  join ltc_m.projects as projects on projects.id = scopes.project_id
  where scopes.metric_type = 'billing_planned'
    and scopes.planning_level = 'item'
    and versions.status in ('approved', 'locked')
    and scopes.currency_code = projects.base_currency
  group by scopes.project_id
), planned_totals as (
  select lines.project_id, sum(lines.amount) as planned_amount
  from ltc_m.financial_plan_lines as lines
  join official_plan_counts as counts on counts.project_id = lines.project_id and counts.official_plan_count = 1
  join ltc_m.plan_versions as versions on versions.id = lines.plan_version_id and versions.status in ('approved', 'locked')
  join ltc_m.projects as projects on projects.id = lines.project_id and lines.currency_code = projects.base_currency
  where lines.metric_type = 'billing_planned' and lines.planning_level = 'item'
  group by lines.project_id
), posted_actuals as (
  select events.project_id, sum(events.amount) as actual_amount
  from ltc_m.financial_actual_events as events
  join ltc_m.projects as projects on projects.id = events.project_id
  where ${MATERIAL_ACTUAL_FILTER}
    and events.currency_code = projects.base_currency
  group by events.project_id
), actual_currency_issues as (
  select distinct events.project_id
  from ltc_m.financial_actual_events as events
  join ltc_m.projects as projects on projects.id = events.project_id
  where ${MATERIAL_ACTUAL_FILTER}
    and events.currency_code is distinct from projects.base_currency
  group by events.project_id
), grain_findings as (
  select
    concat('p034:grain-mismatch:', projects.id::text, ':', items.id::text) as id,
    projects.id as project_id,
    projects.project_code,
    projects.project_name,
    'GRAIN_MISMATCH'::text as rule_code,
    'ERROR'::text as severity,
    null::text as expected_value,
    null::text as observed_value,
    null::text as delta,
    items.currency_code as currency_code,
    'p034_database_projection'::text as finding_origin,
    'project_item'::text as origin_entity,
    items.id as origin_entity_id,
    null::text as source_reference,
    concat('ltc_m.project_items:', items.id::text) as database_reference,
    jsonb_build_object(
      'sourceLineKey', items.source_line_key,
      'projectCurrency', projects.base_currency,
      'itemCurrency', items.currency_code
    ) as evidence,
    'Item and project currencies are incompatible; values were not summed.'::text as explanation,
    'correct_source'::text as remediation,
    null::jsonb as provenance_payload
  from ltc_m.project_items as items
  join ltc_m.projects as projects on projects.id = items.project_id
  where items.active
    and items.deleted_at is null
    and projects.deleted_at is null
    and projects.base_currency is not null
    and items.currency_code is not null
    and items.currency_code <> projects.base_currency
), balance_findings as (
  select
    concat('p034:unplanned-balance:', projects.id::text) as id,
    projects.id as project_id,
    projects.project_code,
    projects.project_name,
    'UNPLANNED_BALANCE'::text as rule_code,
    'WARNING'::text as severity,
    '0'::text as expected_value,
    greatest(projects.contract_value - coalesce(actuals.actual_amount, 0) - coalesce(planned.planned_amount, 0), 0)::text as observed_value,
    greatest(projects.contract_value - coalesce(actuals.actual_amount, 0) - coalesce(planned.planned_amount, 0), 0)::text as delta,
    projects.base_currency as currency_code,
    'p023_database_projection'::text as finding_origin,
    'project'::text as origin_entity,
    projects.id as origin_entity_id,
    null::text as source_reference,
    concat('ltc_m.projects:', projects.id::text) as database_reference,
    jsonb_build_object('contractValue', projects.contract_value::text, 'postedActual', coalesce(actuals.actual_amount, 0)::text, 'planned', coalesce(planned.planned_amount, 0)::text) as evidence,
    'The canonical balance remains positive after posted actuals and the official item plan.'::text as explanation,
    'correct_database'::text as remediation,
    null::jsonb as provenance_payload
  from ltc_m.projects as projects
  join official_plan_counts as counts on counts.project_id = projects.id and counts.official_plan_count = 1
  left join planned_totals as planned on planned.project_id = projects.id
  left join posted_actuals as actuals on actuals.project_id = projects.id
  left join actual_currency_issues as currency_issues on currency_issues.project_id = projects.id
  where projects.deleted_at is null
    and projects.contract_value is not null
    and currency_issues.project_id is null
    and greatest(projects.contract_value - coalesce(actuals.actual_amount, 0) - coalesce(planned.planned_amount, 0), 0) > 0
), project_duplicate_groups as (
  select
    observations.snapshot_id,
    observations.project_id,
    observations.project_code,
    jsonb_agg(
      jsonb_build_object(
        'project_code', observations.project_code,
        'project_id', observations.project_id::text,
        'source_references', coalesce((
          select jsonb_agg(jsonb_build_object('kind', source_refs.kind, 'locator', source_refs.locator, 'fingerprint', source_refs.fingerprint) order by source_refs.reference_ordinal)
          from ltc_m.p034_provenance_source_references as source_refs
          where source_refs.project_observation_id = observations.id
        ), '[]'::jsonb)
      ) order by observations.occurrence_ordinal
    ) as project_observations
  from latest_snapshots as latest
  join ltc_m.p034_provenance_project_observations as observations on observations.snapshot_id = latest.id
  group by observations.snapshot_id, observations.project_id, observations.project_code
  having count(*) > 1
), item_duplicate_groups as (
  select
    observations.snapshot_id,
    observations.project_id,
    observations.project_code,
    observations.source_line_key,
    jsonb_agg(
      jsonb_build_object(
        'project_code', observations.project_code,
        'source_line_key', observations.source_line_key,
        'item_id', observations.item_id,
        'source_references', coalesce((
          select jsonb_agg(jsonb_build_object('kind', source_refs.kind, 'locator', source_refs.locator, 'fingerprint', source_refs.fingerprint) order by source_refs.reference_ordinal)
          from ltc_m.p034_provenance_source_references as source_refs
          where source_refs.item_observation_id = observations.id
        ), '[]'::jsonb)
      ) order by observations.occurrence_ordinal
    ) as item_observations
  from latest_snapshots as latest
  join ltc_m.p034_provenance_item_observations as observations on observations.snapshot_id = latest.id
  group by observations.snapshot_id, observations.project_id, observations.project_code, observations.source_line_key
  having count(*) > 1
), provenance_findings as (
  select
    concat('p034-provenance-project:', groups.snapshot_id::text, ':', groups.project_code) as id,
    groups.project_id,
    groups.project_code,
    projects.project_name,
    'DUPLICATE_PROJECT_SOURCE_IDENTITY'::text as rule_code,
    'ERROR'::text as severity,
    null::text as expected_value,
    null::text as observed_value,
    null::text as delta,
    projects.base_currency as currency_code,
    'p015_provenance_adapter'::text as finding_origin,
    'import'::text as origin_entity,
    null::uuid as origin_entity_id,
    null::text as source_reference,
    null::text as database_reference,
    null::jsonb as evidence,
    null::text as explanation,
    'investigate_duplicate'::text as remediation,
    jsonb_build_object('project_observations', groups.project_observations, 'item_observations', '[]'::jsonb) as provenance_payload
  from project_duplicate_groups as groups
  join ltc_m.projects as projects on projects.id = groups.project_id
  union all
  select
    concat('p034-provenance-item:', groups.snapshot_id::text, ':', groups.project_code, ':', groups.source_line_key) as id,
    groups.project_id,
    groups.project_code,
    projects.project_name,
    'DUPLICATE_ITEM_SOURCE_IDENTITY'::text as rule_code,
    'ERROR'::text as severity,
    null::text as expected_value,
    null::text as observed_value,
    null::text as delta,
    projects.base_currency as currency_code,
    'p015_provenance_adapter'::text as finding_origin,
    'import'::text as origin_entity,
    null::uuid as origin_entity_id,
    null::text as source_reference,
    null::text as database_reference,
    null::jsonb as evidence,
    null::text as explanation,
    'investigate_duplicate'::text as remediation,
    jsonb_build_object(
      'project_observations', coalesce((
        select jsonb_build_array(jsonb_build_object(
          'project_code', observations.project_code,
          'project_id', observations.project_id::text,
          'source_references', coalesce((
            select jsonb_agg(jsonb_build_object('kind', source_refs.kind, 'locator', source_refs.locator, 'fingerprint', source_refs.fingerprint) order by source_refs.reference_ordinal)
            from ltc_m.p034_provenance_source_references as source_refs
            where source_refs.project_observation_id = observations.id
          ), '[]'::jsonb)
        ))
        from ltc_m.p034_provenance_project_observations as observations
        where observations.snapshot_id = groups.snapshot_id
          and observations.project_code = groups.project_code
        order by observations.occurrence_ordinal
        limit 1
      ), '[]'::jsonb),
      'item_observations', groups.item_observations
    ) as provenance_payload
  from item_duplicate_groups as groups
  join ltc_m.projects as projects on projects.id = groups.project_id
), findings as (
  select * from p016_findings
  union all select * from incomplete_findings
  union all select * from stale_findings
  union all select * from grain_findings
  union all select * from balance_findings
  union all select * from provenance_findings
), findings_labeled as (
  select
    findings.*,
    case findings.rule_code
      when 'PROJECT_VALUE_MISMATCH' then 'Contrato x item'
      when 'UNPLANNED_BALANCE' then 'Saldo não programado'
      when 'MISSING_REQUIRED_FIELD' then 'Item incompleto'
      when 'PROJECT_DATA_STALE' then 'Projeto desatualizado'
      when 'DUPLICATE_PROJECT_SOURCE_IDENTITY' then 'Duplicidade'
      when 'DUPLICATE_ITEM_SOURCE_IDENTITY' then 'Duplicidade'
      when 'GRAIN_MISMATCH' then 'Divergência de moeda/unidade'
      else findings.rule_code
    end as rule_label
  from findings
)
select
  findings_labeled.*,
  case findings_labeled.severity when 'BLOCKING' then 1 when 'ERROR' then 2 when 'WARNING' then 3 else 4 end as severity_rank,
  count(*) over()::bigint as total_items
from findings_labeled
where 1 = 1
`;

function escapedLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/gu, '\\$&')}%`;
}

function reference(kind: QualityReference['kind'], locator: string): QualityReference {
  return {
    kind,
    locator,
    fingerprint: createHash('sha256').update(locator).digest('hex'),
  };
}

function provenanceReference(value: P034ProvenanceReference): QualityReference {
  return { kind: value.kind, locator: value.locator, fingerprint: value.fingerprint };
}

function asSeverity(value: string): QualitySeverity {
  if (!['INFO', 'WARNING', 'ERROR', 'BLOCKING'].includes(value)) {
    throw new Error('P034_SOURCE_SEVERITY_INVALID');
  }
  return value as QualitySeverity;
}

function asOrigin(value: string): QualityOriginEntity {
  if (!['project', 'project_item', 'plan_version', 'actual_event', 'import'].includes(value)) {
    throw new Error('P034_SOURCE_ORIGIN_INVALID');
  }
  return value as QualityOriginEntity;
}

function toFinding(row: QualityRow, duplicate?: P034DuplicateFinding): QualityFinding {
  const id = duplicate?.finding_id ?? row.id;
  const projectId = duplicate?.project_id ?? row.project_id;
  const projectCode = duplicate?.project_code ?? row.project_code;
  if (!id || !projectId || !projectCode || !row.project_name || !row.rule_code) {
    throw new Error('P034_SOURCE_FINDING_INVALID');
  }
  if (!Object.prototype.hasOwnProperty.call(RULE_LABELS, row.rule_code)) {
    throw new Error('P034_SOURCE_RULE_INVALID');
  }
  const rule = row.rule_code as QualityRuleCode;
  const origin = asOrigin(duplicate ? 'import' : row.origin_entity);
  const sourceReferences = duplicate
    ? duplicate.source_references.map(provenanceReference)
    : row.source_reference
      ? [reference('source', row.source_reference)]
      : [];
  const databaseReferences = row.database_reference
    ? [reference('database', row.database_reference)]
    : [];
  const navigationAction =
    origin === 'project_item' && row.origin_entity_id
      ? { target: 'project_item' as const, projectId, entityId: row.origin_entity_id }
      : origin === 'actual_event'
        ? {
            target: 'realized_event' as const,
            projectId,
            ...(row.origin_entity_id ? { entityId: row.origin_entity_id } : {}),
          }
        : origin === 'plan_version' || rule === 'UNPLANNED_BALANCE'
          ? { target: 'planning' as const, projectId }
          : { target: 'project' as const, projectId };
  return {
    id,
    project: { id: projectId, code: projectCode, name: row.project_name },
    rule: { code: rule, label: RULE_LABELS[rule] },
    severity: asSeverity(duplicate?.severity ?? row.severity),
    expectedValue: duplicate ? null : row.expected_value,
    observedValue: duplicate ? null : row.observed_value,
    delta: duplicate ? null : row.delta,
    currencyCode: duplicate ? null : row.currency_code,
    origin: {
      findingOrigin: duplicate ? 'p015_provenance_adapter' : row.finding_origin,
      entity: origin,
      ...(sourceReferences.length > 0 ? { sourceReferences } : {}),
      ...(databaseReferences.length > 0 ? { databaseReferences } : {}),
    },
    ...(duplicate
      ? { explanation: duplicate.explanation, remediation: duplicate.remediation_class }
      : {}),
    ...(!duplicate && row.evidence ? { evidence: row.evidence } : {}),
    ...(!duplicate && row.explanation ? { explanation: row.explanation } : {}),
    ...(!duplicate && row.remediation ? { remediation: row.remediation } : {}),
    navigationAction,
  };
}

function expandRow(row: QualityRow): readonly QualityFinding[] {
  if (!row.provenance_payload) return [toFinding(row)];
  const findings = deriveP034DuplicateFindings(row.provenance_payload);
  const matching = findings.filter((finding) => finding.finding_code === row.rule_code);
  if (matching.length !== 1) throw new Error('P034_PROVENANCE_ADAPTER_CARDINALITY_INVALID');
  return matching.map((finding) => toFinding(row, finding));
}

@Injectable()
export class QualityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly clock: QualityClock = new SystemQualityClock(),
  ) {}

  async list(query: QualityQuery, actor: ActorContext): Promise<QualityResponse> {
    return this.database.actorTransaction(actor, async (client) => {
      const projectId = query.projectId ?? null;
      const guard = await client.query<{ snapshot_count: string }>(SNAPSHOT_GUARD_SQL, [projectId]);
      if (Number(guard.rows[0]?.snapshot_count ?? 0) === 0) {
        throw new ServiceUnavailableException('P034_PROVENANCE_SNAPSHOT_UNAVAILABLE');
      }
      const values: unknown[] = [projectId, this.clock.now().toISOString()];
      const filters: string[] = [];
      if (query.projectId) filters.push('project_id = $1::uuid');
      if (query.rule) {
        values.push(query.rule);
        filters.push(`rule_code = $${values.length}::text`);
      }
      if (query.severity) {
        values.push(query.severity);
        filters.push(`severity = $${values.length}::text`);
      }
      if (query.origin) {
        values.push(query.origin);
        filters.push(`origin_entity = $${values.length}::text`);
      }
      if (query.search) {
        values.push(escapedLikePattern(query.search));
        const placeholder = `$${values.length}`;
        filters.push(
          `(project_code ilike ${placeholder} escape E'\\\\' or project_name ilike ${placeholder} escape E'\\\\' or rule_code ilike ${placeholder} escape E'\\\\' or rule_label ilike ${placeholder} escape E'\\\\' or origin_entity ilike ${placeholder} escape E'\\\\' or finding_origin ilike ${placeholder} escape E'\\\\')`,
        );
      }
      const where = filters.length > 0 ? `  and ${filters.join('\n  and ')}` : '';
      const direction = query.order === 'desc' ? 'desc' : 'asc';
      const result = await client.query<QualityRow>(
        `${FINDINGS_SQL}${where}
         order by ${SORT_EXPRESSIONS[query.sort]} ${direction}${query.sort === 'project' && query.order === 'asc' ? ', rule_code asc' : ''}, id asc`,
        values,
      );
      const findings = result.rows.flatMap(expandRow);
      const totalItems = findings.length;
      const offset = (query.page - 1) * query.pageSize;
      return {
        contract: P034_DATA_QUALITY_CONTRACT,
        items: findings.slice(offset, offset + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
      };
    });
  }
}
