import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ActorContext } from '../database/transaction.js';
import { DatabaseService } from '../database/database.service.js';
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
  readonly total_items: string;
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
  ACTUAL_STATUS_UNRESOLVED: 'Status do realizado não resolvido',
  UNPLANNED_BALANCE: 'Saldo não programado',
  MISSING_REQUIRED_FIELD: 'Item incompleto',
  PROJECT_DATA_STALE: 'Projeto desatualizado',
  DUPLICATE_PROJECT_SOURCE_IDENTITY: 'Duplicidade',
  DUPLICATE_ITEM_SOURCE_IDENTITY: 'Duplicidade',
  IMPORT_DUPLICATION: 'Duplicidade',
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
with p016_findings as (
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
    case when quality.finding_code = 'ACTUAL_STATUS_UNRESOLVED' then 'actual_event' else 'project' end as origin_entity,
    case when quality.finding_code = 'ACTUAL_STATUS_UNRESOLVED' then null::uuid else coalesce(quality.project_item_id, quality.project_id) end as origin_entity_id,
    quality.source_reference,
    quality.database_reference,
    null::jsonb as evidence,
    null::text as explanation,
    quality.remediation_class as remediation
  from ltc_m.v_tableau_data_quality as quality
  join ltc_m.projects as projects on projects.id = quality.project_id
  where quality.finding_id is not null and quality.finding_code is not null
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
    'correct_database'::text as remediation
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
    jsonb_build_object('evaluatedAt', $1::timestamptz, 'thresholdDays', 30) as evidence,
    'Project data is older than the 30-day freshness threshold.'::text as explanation,
    'correct_database'::text as remediation
  from ltc_m.projects as projects
  where projects.deleted_at is null
    and projects.updated_at is not null
    and $1::timestamptz - projects.updated_at > interval '30 days'
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
  where events.metric_type = 'billing_actual'
    and events.status = 'posted'
    and events.currency_code = projects.base_currency
  group by events.project_id
), actual_currency_issues as (
  select distinct events.project_id
  from ltc_m.financial_actual_events as events
  join ltc_m.projects as projects on projects.id = events.project_id
  where events.currency_code is distinct from projects.base_currency
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
    'correct_database'::text as remediation
  from ltc_m.projects as projects
  join official_plan_counts as counts on counts.project_id = projects.id and counts.official_plan_count = 1
  left join planned_totals as planned on planned.project_id = projects.id
  left join posted_actuals as actuals on actuals.project_id = projects.id
  left join actual_currency_issues as currency_issues on currency_issues.project_id = projects.id
  where projects.deleted_at is null
    and projects.contract_value is not null
    and currency_issues.project_id is null
    and greatest(projects.contract_value - coalesce(actuals.actual_amount, 0) - coalesce(planned.planned_amount, 0), 0) > 0
), findings as (
  select * from p016_findings
  union all select * from incomplete_findings
  union all select * from stale_findings
  union all select * from balance_findings
), findings_labeled as (
  select
    findings.*,
    case findings.rule_code
      when 'PROJECT_VALUE_MISMATCH' then 'Contrato x item'
      when 'ACTUAL_STATUS_UNRESOLVED' then 'Status do realizado não resolvido'
      when 'UNPLANNED_BALANCE' then 'Saldo não programado'
      when 'MISSING_REQUIRED_FIELD' then 'Item incompleto'
      when 'PROJECT_DATA_STALE' then 'Projeto desatualizado'
      when 'DUPLICATE_PROJECT_SOURCE_IDENTITY' then 'Duplicidade'
      when 'DUPLICATE_ITEM_SOURCE_IDENTITY' then 'Duplicidade'
      when 'IMPORT_DUPLICATION' then 'Duplicidade'
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

function asSeverity(value: string): QualitySeverity {
  return value as QualitySeverity;
}

function asOrigin(value: string): QualityOriginEntity {
  return value as QualityOriginEntity;
}

function toFinding(row: QualityRow): QualityFinding {
  const rule = row.rule_code as QualityRuleCode;
  const origin = asOrigin(row.origin_entity);
  const sourceReferences = row.source_reference ? [reference('source', row.source_reference)] : [];
  const databaseReferences = row.database_reference
    ? [reference('database', row.database_reference)]
    : [];
  const navigationAction =
    origin === 'project_item' && row.origin_entity_id
      ? {
          target: 'project_item' as const,
          projectId: row.project_id,
          entityId: row.origin_entity_id,
        }
      : origin === 'actual_event'
        ? {
            target: 'realized_event' as const,
            projectId: row.project_id,
            ...(row.origin_entity_id ? { entityId: row.origin_entity_id } : {}),
          }
        : origin === 'plan_version' || rule === 'UNPLANNED_BALANCE'
          ? { target: 'planning' as const, projectId: row.project_id }
          : { target: 'project' as const, projectId: row.project_id };
  return {
    id: row.id,
    project: { id: row.project_id, code: row.project_code, name: row.project_name },
    rule: { code: rule, label: RULE_LABELS[rule] },
    severity: asSeverity(row.severity),
    expectedValue: row.expected_value,
    observedValue: row.observed_value,
    delta: row.delta,
    currencyCode: row.currency_code,
    origin: {
      findingOrigin: row.finding_origin,
      entity: origin,
      ...(sourceReferences.length > 0 ? { sourceReferences } : {}),
      ...(databaseReferences.length > 0 ? { databaseReferences } : {}),
    },
    ...(row.evidence ? { evidence: row.evidence } : {}),
    ...(row.explanation ? { explanation: row.explanation } : {}),
    ...(row.remediation ? { remediation: row.remediation } : {}),
    navigationAction,
  };
}

@Injectable()
export class QualityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly clock: QualityClock = new SystemQualityClock(),
  ) {}

  async list(query: QualityQuery, actor: ActorContext): Promise<QualityResponse> {
    return this.database.actorTransaction(actor, async (client) => {
      const values: unknown[] = [this.clock.now().toISOString()];
      const filters: string[] = [];
      if (query.projectId) {
        values.push(query.projectId);
        filters.push(`project_id = $${values.length}::uuid`);
      }
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
      const offset = (query.page - 1) * query.pageSize;
      values.push(query.pageSize, offset);
      const limitPlaceholder = `$${values.length - 1}`;
      const offsetPlaceholder = `$${values.length}`;
      const direction = query.order === 'desc' ? 'desc' : 'asc';
      const result = await client.query<QualityRow>(
        `${FINDINGS_SQL}${where}
        order by ${SORT_EXPRESSIONS[query.sort]} ${direction}${query.sort === 'project' && query.order === 'asc' ? ', rule_code asc' : ''}, id asc
limit ${limitPlaceholder}::integer offset ${offsetPlaceholder}::bigint`,
        values,
      );
      const totalItems = Number(result.rows[0]?.total_items ?? 0);
      return {
        contract: P034_DATA_QUALITY_CONTRACT,
        items: result.rows.map(toFinding),
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
      };
    });
  }
}
