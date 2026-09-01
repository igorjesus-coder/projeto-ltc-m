import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import type { ActorContext } from '../database/transaction.js';
import { DatabaseService } from '../database/database.service.js';
import type { Role } from '../auth/authorization.js';
import {
  P023_PROJECT_PORTFOLIO_CONTRACT,
  type ProjectDetail,
  type ProjectPortfolioItem,
  type ProjectPortfolioQuery,
  type ProjectPortfolioResponse,
  type ProjectStatus,
  type UnscheduledBalanceStatus,
} from './projects.types.js';
import {
  P024_PROJECT_CREATE_EDIT_CONTRACT,
  type ProjectClassification,
  type ProjectCurrency,
  type ProjectOptionsResponse,
  type ProjectPatchPayload,
  type ProjectWritePayload,
  type ProjectWriteResponse,
} from './projects-write.types.js';

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

interface ProjectWriteRow extends QueryResultRow {
  readonly project_id: string;
  readonly project_code: string;
  readonly project_name: string;
  readonly client_id: string;
  readonly client_name: string;
  readonly client_active: boolean;
  readonly client_deleted_at: string | null;
  readonly reporting_group: string | null;
  readonly classification: string;
  readonly project_status: string;
  readonly currency_code: string;
  readonly currency_available: boolean;
  readonly contract_value: string;
  readonly opening_balance: string | null;
  readonly budget_cost: string | null;
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly data_reference_date: string | null;
  readonly notes: string | null;
  readonly version: number;
  readonly updated_at: string;
}

interface ProjectOptionRow extends QueryResultRow {
  readonly id: string;
  readonly display_name: string;
}

interface ProjectCurrencyOptionRow extends QueryResultRow {
  readonly code: ProjectCurrency;
  readonly name: string;
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

function asProjectClassification(value: string): ProjectClassification {
  return value as ProjectClassification;
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function mapProjectWriteError(error: unknown, currencyChange = false): never {
  switch (databaseErrorCode(error)) {
    case '23505':
      throw new ConflictException('P024_PROJECT_CODE_CONFLICT');
    case '23514':
      throw new UnprocessableEntityException('P024_PROJECT_CONSTRAINT_INVALID');
    case '23503':
      throw new UnprocessableEntityException(
        currencyChange ? 'P024_CURRENCY_CHANGE_CONFLICT' : 'P024_CLIENT_UNAVAILABLE',
      );
    case '42501':
      throw new ConflictException('P024_PROJECT_STATUS_NOT_EDITABLE');
    default:
      throw error;
  }
}

function ensureEditorStatus(role: Role, status: ProjectStatus): void {
  if (role === 'editor' && status !== 'active') {
    throw new ConflictException('P024_PROJECT_STATUS_NOT_EDITABLE');
  }
}

function toProjectWriteResponse(row: ProjectWriteRow): ProjectWriteResponse {
  return {
    contract: P024_PROJECT_CREATE_EDIT_CONTRACT,
    projectId: row.project_id,
    projectCode: row.project_code,
    projectName: row.project_name,
    client: {
      id: row.client_id,
      displayName: row.client_name,
      available: row.client_active && row.client_deleted_at === null,
    },
    reportingGroup: row.reporting_group,
    classification: asProjectClassification(row.classification),
    status: asProjectStatus(row.project_status),
    baseCurrency: row.currency_code as ProjectCurrency,
    currencyAvailable: row.currency_available,
    contractValue: row.contract_value,
    openingBalance: row.opening_balance,
    budgetCost: row.budget_cost,
    startDate: row.start_date,
    endDate: row.end_date,
    dataReferenceDate: row.data_reference_date,
    notes: row.notes,
    version: row.version,
    updatedAt: row.updated_at,
  };
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

  async options(actor: ActorContext): Promise<ProjectOptionsResponse> {
    return this.database.actorTransaction(actor, async (client) => {
      const currencies = await client.query<ProjectCurrencyOptionRow>(
        `select code, name
         from ltc_m.currencies
         where code in ('BRL', 'USD') and active = true
         order by code`,
      );
      const result = await client.query<ProjectOptionRow>(
        `select id, display_name
         from ltc_m.clients
         where active = true and deleted_at is null
         order by display_name asc, id asc`,
      );
      return {
        contract: P024_PROJECT_CREATE_EDIT_CONTRACT,
        currencies: currencies.rows,
        clients: result.rows.map((row) => ({ id: row.id, displayName: row.display_name })),
      };
    });
  }

  async getEditData(projectId: string, actor: ActorContext): Promise<ProjectWriteResponse> {
    return this.database.actorTransaction(actor, async (client) => {
      const row = await this.findWriteById(client, projectId);
      if (!row) throw new NotFoundException('P024_PROJECT_NOT_FOUND');
      return toProjectWriteResponse(row);
    });
  }

  async create(
    payload: ProjectWritePayload,
    actor: ActorContext,
    role: Role,
  ): Promise<ProjectWriteResponse> {
    ensureEditorStatus(role, payload.status);
    return this.database.actorTransaction(actor, async (client) => {
      await this.ensureActiveCurrency(client, payload.baseCurrency);
      await this.ensureActiveClient(client, payload.clientId);
      try {
        const result = await client.query<{ readonly id: string }>(
          `insert into ltc_m.projects (
             project_code,
             project_name,
             client_id,
             reporting_group,
             classification,
             status,
             base_currency,
             contract_value,
             opening_balance,
             budget_cost,
             start_date,
             end_date,
             data_reference_date,
             notes
           ) values (
             $1::text,
             $2::text,
             $3::uuid,
             $4::text,
             $5::ltc_m.project_classification,
             $6::ltc_m.project_status,
             $7::text,
             $8::numeric,
             $9::numeric,
             $10::numeric,
             $11::date,
             $12::date,
             $13::date,
             $14::text
           )
           returning id`,
          [
            payload.projectCode,
            payload.projectName,
            payload.clientId,
            payload.reportingGroup,
            payload.classification,
            payload.status,
            payload.baseCurrency,
            payload.contractValue,
            payload.openingBalance,
            payload.budgetCost,
            payload.startDate,
            payload.endDate,
            payload.dataReferenceDate,
            payload.notes,
          ],
        );
        const id = result.rows[0]?.id;
        if (!id) throw new Error('P024_CREATE_RESULT_MISSING');
        const row = await this.findWriteById(client, id);
        if (!row) throw new Error('P024_CREATE_RESULT_MISSING');
        return toProjectWriteResponse(row);
      } catch (error: unknown) {
        mapProjectWriteError(error);
      }
    });
  }

  async update(
    projectId: string,
    payload: ProjectPatchPayload,
    actor: ActorContext,
    role: Role,
  ): Promise<ProjectWriteResponse> {
    if (payload.status !== undefined) ensureEditorStatus(role, payload.status);
    return this.database.actorTransaction(actor, async (client) => {
      const visible = await client.query<{ readonly id: string; readonly version: number }>(
        `select id, version from ltc_m.projects where id = $1::uuid`,
        [projectId],
      );
      if (!visible.rows[0]) throw new NotFoundException('P024_PROJECT_NOT_FOUND');

      if (payload.clientId !== undefined) await this.ensureActiveClient(client, payload.clientId);
      if (payload.baseCurrency !== undefined)
        await this.ensureActiveCurrency(client, payload.baseCurrency);

      const values: unknown[] = [];
      const assignments: string[] = [];
      const add = (column: string, value: unknown, cast: string) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}::${cast}`);
      };
      if (payload.projectName !== undefined) add('project_name', payload.projectName, 'text');
      if (payload.clientId !== undefined) add('client_id', payload.clientId, 'uuid');
      if (payload.baseCurrency !== undefined) add('base_currency', payload.baseCurrency, 'text');
      if (payload.reportingGroup !== undefined)
        add('reporting_group', payload.reportingGroup, 'text');
      if (payload.classification !== undefined) {
        add('classification', payload.classification, 'ltc_m.project_classification');
      }
      if (payload.status !== undefined) add('status', payload.status, 'ltc_m.project_status');
      if (payload.contractValue !== undefined)
        add('contract_value', payload.contractValue, 'numeric');
      if (payload.openingBalance !== undefined)
        add('opening_balance', payload.openingBalance, 'numeric');
      if (payload.budgetCost !== undefined) add('budget_cost', payload.budgetCost, 'numeric');
      if (payload.startDate !== undefined) add('start_date', payload.startDate, 'date');
      if (payload.endDate !== undefined) add('end_date', payload.endDate, 'date');
      if (payload.dataReferenceDate !== undefined) {
        add('data_reference_date', payload.dataReferenceDate, 'date');
      }
      if (payload.notes !== undefined) add('notes', payload.notes, 'text');
      values.push(projectId, payload.expectedVersion);
      try {
        const updated = await client.query<{ readonly id: string }>(
          `update ltc_m.projects
           set ${assignments.join(', ')}
           where id = $${values.length - 1}::uuid
             and version = $${values.length}::integer
           returning id`,
          values,
        );
        if (!updated.rows[0]) throw new ConflictException('P024_VERSION_CONFLICT');
        const row = await this.findWriteById(client, projectId);
        if (!row) throw new NotFoundException('P024_PROJECT_NOT_FOUND');
        return toProjectWriteResponse(row);
      } catch (error: unknown) {
        if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
        mapProjectWriteError(error, payload.baseCurrency !== undefined);
      }
    });
  }

  private async ensureActiveCurrency(client: PoolClient, code: ProjectCurrency): Promise<void> {
    const result = await client.query<{ readonly available: boolean }>(
      `select exists (
         select 1 from ltc_m.currencies
         where code = $1::text and active = true
       ) as available`,
      [code],
    );
    if (!result.rows[0]?.available)
      throw new UnprocessableEntityException('P024_CURRENCY_UNAVAILABLE');
  }

  private async ensureActiveClient(client: PoolClient, clientId: string): Promise<void> {
    const result = await client.query<{ readonly id: string }>(
      `select id
       from ltc_m.clients
       where id = $1::uuid and active = true and deleted_at is null`,
      [clientId],
    );
    if (!result.rows[0]) throw new UnprocessableEntityException('P024_CLIENT_UNAVAILABLE');
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

  private async findWriteById(
    client: PoolClient,
    projectId: string,
  ): Promise<ProjectWriteRow | undefined> {
    const result = await client.query<ProjectWriteRow>(
      `select
         projects.id as project_id,
         projects.project_code,
         projects.project_name,
         projects.client_id,
         clients.display_name as client_name,
         clients.active as client_active,
         clients.deleted_at as client_deleted_at,
         projects.reporting_group,
         projects.classification::text as classification,
         projects.status::text as project_status,
         projects.base_currency as currency_code,
         exists (
           select 1 from ltc_m.currencies
           where currencies.code = projects.base_currency and currencies.active = true
         ) as currency_available,
         projects.contract_value,
         projects.opening_balance,
         projects.budget_cost,
         projects.start_date,
         projects.end_date,
         projects.data_reference_date,
         projects.notes,
         projects.version,
         projects.updated_at
       from ltc_m.projects
       join ltc_m.clients on clients.id = projects.client_id
       where projects.id = $1::uuid
         and projects.deleted_at is null`,
      [projectId],
    );
    return result.rows[0];
  }
}
