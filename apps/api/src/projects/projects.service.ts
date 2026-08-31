import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import type { ActorContext } from '../database/transaction.js';
import { DatabaseService } from '../database/database.service.js';
import {
  P023_PROJECT_PORTFOLIO_CONTRACT,
  type ProjectDetail,
  type ProjectPortfolioItem,
  type ProjectPortfolioQuery,
  type ProjectPortfolioResponse,
  type ProjectStatus,
  type UnscheduledBalanceStatus,
} from './projects.types.js';

interface PortfolioRow extends QueryResultRow {
  readonly project_id: string;
  readonly project_code: string;
  readonly client_name: string;
  readonly project_status: string;
  readonly currency_code: string;
  readonly contract_value: string | null;
  readonly unscheduled_balance: string | null;
  readonly unscheduled_balance_status: string;
  readonly updated_at: string;
  readonly alert_count: number;
  readonly alerts_summary: string | null;
  readonly total_items: string;
}

interface ProjectDetailRow extends QueryResultRow {
  readonly project_id: string;
  readonly project_code: string;
  readonly project_name: string;
  readonly client_name: string;
  readonly project_status: string;
  readonly currency_code: string;
  readonly contract_value: string | null;
  readonly updated_at: string;
}

const SORT_EXPRESSIONS = Object.freeze({
  code: 'project_code',
  client: 'client_name',
  status: 'project_status',
  contractValue: 'contract_value',
  unscheduledBalance: 'unscheduled_balance',
  updatedAt: 'updated_at',
} as const);

const PORTFOLIO_CTE = `
with official_plan_candidates as (
  select distinct
    scopes.project_id,
    scopes.plan_version_id
  from ltc_m.financial_plan_scopes as scopes
  join ltc_m.plan_versions as versions
    on versions.id = scopes.plan_version_id
  where scopes.metric_type = 'billing_planned'
    and scopes.planning_level = 'item'
    and versions.status in ('approved', 'locked')
),
official_plan_counts as (
  select project_id, count(*)::integer as official_plan_count
  from official_plan_candidates
  group by project_id
),
planned_totals as (
  select
    lines.project_id,
    sum(lines.amount) as billing_planned
  from ltc_m.financial_plan_lines as lines
  join official_plan_candidates as candidates
    on candidates.plan_version_id = lines.plan_version_id
    and candidates.project_id = lines.project_id
  join official_plan_counts as counts
    on counts.project_id = lines.project_id
    and counts.official_plan_count = 1
  where lines.metric_type = 'billing_planned'
    and lines.planning_level = 'item'
  group by lines.project_id
),
posted_actual_totals as (
  select
    events.project_id,
    sum(events.amount) as billing_actual_posted
  from ltc_m.financial_actual_events as events
  where events.metric_type = 'billing_actual'
    and events.status = 'posted'
  group by events.project_id
),
actual_currency_issues as (
  select events.project_id
  from ltc_m.financial_actual_events as events
  join ltc_m.projects as projects
    on projects.id = events.project_id
  where events.metric_type = 'billing_actual'
    and events.status = 'posted'
    and events.currency_code <> projects.base_currency
  group by events.project_id
),
quality_alerts as (
  select
    quality.project_id,
    count(*)::integer as alert_count,
    string_agg(distinct quality.finding_code, ', ' order by quality.finding_code)
      as alerts_summary
  from ltc_m.v_tableau_data_quality as quality
  where quality.project_id is not null
    and quality.finding_code in ('PROJECT_VALUE_MISMATCH', 'ACTUAL_STATUS_UNRESOLVED')
  group by quality.project_id
),
portfolio_rows as (
  select
    projects.id as project_id,
    projects.project_code,
    clients.display_name as client_name,
    projects.status::text as project_status,
    projects.base_currency as currency_code,
    projects.contract_value,
    case
      when projects.contract_value is null then null
      when coalesce(official_plan_counts.official_plan_count, 0) <> 1 then null
      when actual_currency_issues.project_id is not null then null
      else greatest(
        projects.contract_value
        - coalesce(posted_actual_totals.billing_actual_posted, 0)
        - coalesce(planned_totals.billing_planned, 0),
        0
      )
    end as unscheduled_balance,
    case
      when projects.contract_value is null then 'missing_contract'
      when actual_currency_issues.project_id is not null then 'data_quality_issue'
      when official_plan_counts.official_plan_count is null then 'no_official_plan'
      when official_plan_counts.official_plan_count <> 1 then 'ambiguous_official_plan'
      else 'available'
    end as unscheduled_balance_status,
    projects.updated_at,
    coalesce(quality_alerts.alert_count, 0) as alert_count,
    quality_alerts.alerts_summary
  from ltc_m.projects
  join ltc_m.clients
    on clients.id = projects.client_id
  left join official_plan_counts
    on official_plan_counts.project_id = projects.id
  left join planned_totals
    on planned_totals.project_id = projects.id
  left join posted_actual_totals
    on posted_actual_totals.project_id = projects.id
  left join actual_currency_issues
    on actual_currency_issues.project_id = projects.id
  left join quality_alerts
    on quality_alerts.project_id = projects.id
  where projects.deleted_at is null
)
select
  portfolio_rows.*,
  count(*) over()::bigint as total_items
from portfolio_rows
`;

function asProjectStatus(value: string): ProjectStatus {
  return value as ProjectStatus;
}

function asUnscheduledBalanceStatus(value: string): UnscheduledBalanceStatus {
  return value as UnscheduledBalanceStatus;
}

function toPortfolioItem(row: PortfolioRow): ProjectPortfolioItem {
  return {
    projectId: row.project_id,
    code: row.project_code,
    clientName: row.client_name,
    status: asProjectStatus(row.project_status),
    currencyCode: row.currency_code,
    contractValue: row.contract_value,
    unscheduledBalance: row.unscheduled_balance,
    unscheduledBalanceStatus: asUnscheduledBalanceStatus(row.unscheduled_balance_status),
    updatedAt: row.updated_at,
    alertCount: row.alert_count,
    ...(row.alerts_summary ? { alertsSummary: row.alerts_summary } : {}),
  };
}

function toProjectDetail(row: ProjectDetailRow): ProjectDetail {
  return {
    contract: P023_PROJECT_PORTFOLIO_CONTRACT,
    projectId: row.project_id,
    code: row.project_code,
    name: row.project_name,
    clientName: row.client_name,
    status: asProjectStatus(row.project_status),
    currencyCode: row.currency_code,
    contractValue: row.contract_value,
    updatedAt: row.updated_at,
  };
}

function escapedLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/gu, '\\$&')}%`;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly database: DatabaseService) {}

  async list(query: ProjectPortfolioQuery, actor: ActorContext): Promise<ProjectPortfolioResponse> {
    return this.database.actorTransaction(actor, async (client) => {
      const values: unknown[] = [];
      const filters: string[] = [];

      if (query.search) {
        values.push(escapedLikePattern(query.search));
        const placeholder = `$${values.length}`;
        filters.push(
          `(project_code ilike ${placeholder} escape E'\\\\' or client_name ilike ${placeholder} escape E'\\\\')`,
        );
      }
      if (query.status) {
        values.push(query.status);
        filters.push(`project_status = $${values.length}`);
      }

      const where = filters.length > 0 ? `where ${filters.join('\n  and ')}` : '';
      const sortExpression = SORT_EXPRESSIONS[query.sort];
      const direction = query.order === 'desc' ? 'desc' : 'asc';
      const nulls = query.sort === 'unscheduledBalance' ? ' nulls last' : '';
      const offset = (query.page - 1) * query.pageSize;
      values.push(query.pageSize, offset);
      const limitPlaceholder = `$${values.length - 1}`;
      const offsetPlaceholder = `$${values.length}`;

      const result = await client.query<PortfolioRow>(
        `${PORTFOLIO_CTE}
${where}
order by ${sortExpression} ${direction}${nulls}, project_id asc
limit ${limitPlaceholder}::integer offset ${offsetPlaceholder}::bigint`,
        values,
      );
      const totalItems = Number(result.rows[0]?.total_items ?? 0);

      return {
        contract: P023_PROJECT_PORTFOLIO_CONTRACT,
        items: result.rows.map(toPortfolioItem),
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
      };
    });
  }

  async getById(projectId: string, actor: ActorContext): Promise<ProjectDetail> {
    return this.database.actorTransaction(actor, async (client) => {
      const row = await this.findById(client, projectId);
      if (!row) throw new NotFoundException('P023_PROJECT_NOT_FOUND');
      return toProjectDetail(row);
    });
  }

  private async findById(
    client: PoolClient,
    projectId: string,
  ): Promise<ProjectDetailRow | undefined> {
    const result = await client.query<ProjectDetailRow>(
      `select
         projects.id as project_id,
         projects.project_code,
         projects.project_name,
         clients.display_name as client_name,
         projects.status::text as project_status,
         projects.base_currency as currency_code,
         projects.contract_value,
         projects.updated_at
       from ltc_m.projects
       join ltc_m.clients
         on clients.id = projects.client_id
       where projects.id = $1::uuid
         and projects.deleted_at is null`,
      [projectId],
    );
    return result.rows[0];
  }
}
