import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import type { ActorContext } from '../database/transaction.js';
import { DatabaseService } from '../database/database.service.js';
import { calculateFinancialSummary, parseFinancialCents } from './financial.js';
import {
  P029_MONTHLY_PLANNING_CONTRACT,
  P029_PLANNED_METRIC,
  type PlanningBatchPayload,
  type PlanningCompetence,
  type PlanningEditorResponse,
  type PlanningEntry,
  type PlanningFinancialSummary,
  type PlanningItem,
  type PlanningMonthQuery,
  type PlanningMonthlyTotal,
  type PlanningProjectOption,
  type PlanningProjectsResponse,
  type PlanningVersionOption,
  type PlanningVersionsResponse,
  P029_MAX_RANGE_MONTHS,
} from './planning.types.js';

interface ProjectRow extends QueryResultRow {
  readonly project_id: string;
  readonly project_code: string;
  readonly project_name: string;
  readonly currency_code: string;
  readonly contract_value: string;
  readonly project_status: string;
  readonly start_date: string | null;
  readonly end_date: string | null;
}

interface VersionRow extends QueryResultRow {
  readonly version_id: string;
  readonly version_name: string;
  readonly version_status: string;
  readonly row_version: string | number;
  readonly content_revision: string | number;
  readonly is_baseline: boolean;
}

interface ItemRow extends QueryResultRow {
  readonly item_id: string;
  readonly source_line_key: string;
  readonly item_code: string | null;
  readonly description: string | null;
  readonly line_number: number;
  readonly active: boolean;
}

interface EntryRow extends QueryResultRow {
  readonly item_id: string;
  readonly competence_month: string;
  readonly amount: string;
  readonly row_version: string | number;
}

interface TotalRow extends QueryResultRow {
  readonly competence_month: string;
  readonly amount: string;
}

interface BoundRow extends QueryResultRow {
  readonly min_month: string | null;
  readonly max_month: string | null;
}

interface FinancialRow extends QueryResultRow {
  readonly contract_value: string;
  readonly currency_code: string;
  readonly actual_posted: string;
  readonly planned_draft: string;
  readonly currency_mismatch: boolean;
  readonly planned_currency_mismatch: boolean;
}

interface PlanAmountRow extends QueryResultRow {
  readonly item_id: string;
  readonly competence_month: string;
  readonly amount: string;
}

function version(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('P029_ROW_VERSION_INVALID');
  return parsed;
}

function mapFinancialQueryError(error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === '22003'
  ) {
    throw new UnprocessableEntityException('P030_FINANCIAL_AGGREGATE_OVERFLOW');
  }
  throw error;
}

function projectOption(row: ProjectRow): PlanningProjectOption {
  return {
    projectId: row.project_id,
    code: row.project_code,
    name: row.project_name,
    currencyCode: row.currency_code,
    status: row.project_status,
  };
}

function versionOption(row: VersionRow): PlanningVersionOption {
  return {
    versionId: row.version_id,
    name: row.version_name,
    status: row.version_status,
    rowVersion: version(row.row_version),
    contentRevision: version(row.content_revision),
    editable: row.version_status === 'draft',
    isBaseline: row.is_baseline,
  };
}

function monthLabel(value: string): string {
  const [year, month] = value.slice(0, 7).split('-');
  return `${month}/${year}`;
}

function monthsBetween(from: string, to: string): readonly PlanningCompetence[] {
  const result: PlanningCompetence[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  const distance = (endYear - year) * 12 + endMonth - month + 1;
  if (distance > P029_MAX_RANGE_MONTHS)
    throw new UnprocessableEntityException('P029_RANGE_TOO_LARGE');
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const value = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-01`;
    result.push({ value, label: monthLabel(value) });
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return result;
}

function mapEntry(row: EntryRow): PlanningEntry {
  return {
    itemId: row.item_id,
    competence: row.competence_month,
    amount: row.amount,
    rowVersion: version(row.row_version),
  };
}

function mapTotal(row: TotalRow): PlanningMonthlyTotal {
  return { competence: row.competence_month, amount: row.amount };
}

@Injectable()
export class PlanningService {
  constructor(private readonly database: DatabaseService) {}

  async projects(actor: ActorContext): Promise<PlanningProjectsResponse> {
    return this.database.actorTransaction(actor, async (client) => {
      const result = await client.query<ProjectRow>(
        `select
           id as project_id,
           project_code,
           project_name,
           base_currency as currency_code,
           contract_value::text,
           status::text as project_status,
           start_date,
           end_date
         from ltc_m.projects
         where deleted_at is null
         order by project_code asc, id asc`,
      );
      return {
        contract: P029_MONTHLY_PLANNING_CONTRACT,
        projects: result.rows.map(projectOption),
      };
    });
  }

  async versions(projectId: string, actor: ActorContext): Promise<PlanningVersionsResponse> {
    return this.database.actorTransaction(actor, async (client) => {
      const project = await this.findProject(client, projectId);
      if (!project) throw new NotFoundException('P029_PROJECT_NOT_FOUND');
      const result = await client.query<VersionRow>(
        `select
           versions.id as version_id,
           versions.name as version_name,
           versions.status::text as version_status,
           versions.row_version,
           versions.content_revision,
           versions.is_baseline
         from ltc_m.plan_versions as versions
         join ltc_m.financial_plan_scopes as scopes
           on scopes.plan_version_id = versions.id
         where scopes.project_id = $1::uuid
           and scopes.metric_type = $2::ltc_m.planned_financial_metric
           and scopes.planning_level = 'item'::ltc_m.planning_level
         order by versions.created_at desc, versions.id desc`,
        [projectId, P029_PLANNED_METRIC],
      );
      return {
        contract: P029_MONTHLY_PLANNING_CONTRACT,
        projectId,
        versions: result.rows.map(versionOption),
      };
    });
  }

  async editor(
    projectId: string,
    query: PlanningMonthQuery,
    actor: ActorContext,
    canOverrideBalance = false,
  ): Promise<PlanningEditorResponse> {
    return this.database.actorTransaction(actor, async (client) =>
      this.readEditor(client, projectId, query, canOverrideBalance),
    );
  }

  async save(
    projectId: string,
    versionId: string,
    payload: PlanningBatchPayload,
    actor: ActorContext,
    canOverrideBalance = false,
  ): Promise<PlanningEditorResponse> {
    return this.database.actorTransaction(
      { ...actor, justification: payload.justification },
      async (client) => {
        const project = await this.findProject(client, projectId);
        if (!project) throw new NotFoundException('P029_PROJECT_NOT_FOUND');
        const versionResult = await client.query<VersionRow>(
          `select
             versions.id as version_id,
             versions.name as version_name,
             versions.status::text as version_status,
             versions.row_version,
             versions.content_revision,
             versions.is_baseline
           from ltc_m.plan_versions as versions
           join ltc_m.financial_plan_scopes as scopes
             on scopes.plan_version_id = versions.id
           where versions.id = $1::uuid
             and scopes.project_id = $2::uuid
             and scopes.metric_type = $3::ltc_m.planned_financial_metric
             and scopes.planning_level = 'item'::ltc_m.planning_level
           for update`,
          [versionId, projectId, P029_PLANNED_METRIC],
        );
        const plan = versionResult.rows[0];
        if (!plan) throw new NotFoundException('P029_VERSION_NOT_FOUND');
        if (plan.version_status !== 'draft') {
          throw new ConflictException('P029_VERSION_NOT_EDITABLE');
        }
        if (version(plan.content_revision) !== payload.expectedVersion) {
          throw new ConflictException('P029_VERSION_CONFLICT');
        }

        const provenance = await client.query<{ readonly exists: boolean }>(
          `select exists (
             select 1
             from ltc_m.monthly_plan_cells
             where plan_version_id = $1::uuid
               and project_id = $2::uuid
          )`,
          [versionId, projectId],
        );
        if (provenance.rows[0]?.exists) {
          throw new ConflictException('P029_BASELINE_IMMUTABLE');
        }

        const itemIds = [...new Set(payload.entries.map((entry) => entry.itemId))];
        const items = await client.query<{ readonly item_id: string; readonly active: boolean }>(
          `select id as item_id, active
           from ltc_m.project_items
           where project_id = $1::uuid
             and id = any($2::uuid[])
             and deleted_at is null`,
          [projectId, itemIds],
        );
        const itemById = new Map(items.rows.map((item) => [item.item_id, item]));
        if (itemById.size !== itemIds.length) {
          throw new UnprocessableEntityException('P029_ITEM_NOT_FOUND');
        }
        if (items.rows.some((item) => !item.active)) {
          throw new UnprocessableEntityException('P029_ITEM_NOT_ELIGIBLE');
        }

        const existingLines = await client.query<PlanAmountRow>(
          `select project_item_id as item_id, competence_month::text, amount::text
           from ltc_m.financial_plan_lines
           where plan_version_id = $1::uuid
             and project_id = $2::uuid
             and metric_type = $3::ltc_m.planned_financial_metric
             and planning_level = 'item'::ltc_m.planning_level`,
          [versionId, projectId, P029_PLANNED_METRIC],
        );
        const existingByKey = new Map<string, bigint>();
        let plannedDraft = 0n;
        for (const line of existingLines.rows) {
          const amount = parseFinancialCents(line.amount);
          existingByKey.set(`${line.item_id}\u0000${line.competence_month}`, amount);
          plannedDraft += amount;
        }
        const finalPlanned = payload.entries.reduce(
          (total, entry) =>
            total -
            (existingByKey.get(`${entry.itemId}\u0000${entry.competence}`) ?? 0n) +
            parseFinancialCents(entry.amount),
          plannedDraft,
        );
        const actualResult = await client
          .query<{
            readonly actual_posted: string;
            readonly currency_mismatch: boolean;
          }>(
            `select coalesce(sum(events.amount), 0)::numeric(20,2)::text as actual_posted
                , exists (
                    select 1
                    from ltc_m.financial_actual_events as mismatch_events
                    join ltc_m.projects as mismatch_projects on mismatch_projects.id = mismatch_events.project_id
                    where mismatch_events.project_id = $1::uuid
                      and mismatch_events.metric_type = 'billing_actual'::ltc_m.actual_financial_metric
                      and mismatch_events.status = 'posted'::ltc_m.actual_status
                      and mismatch_events.currency_code <> mismatch_projects.base_currency
                  ) as currency_mismatch
           from ltc_m.financial_actual_events as events
           join ltc_m.projects as projects on projects.id = events.project_id
           where events.project_id = $1::uuid
             and events.metric_type = 'billing_actual'::ltc_m.actual_financial_metric
             and events.status = 'posted'::ltc_m.actual_status
             and events.currency_code = projects.base_currency`,
            [projectId],
          )
          .catch(mapFinancialQueryError);
        if (actualResult.rows[0]?.currency_mismatch) {
          throw new UnprocessableEntityException('P030_CURRENCY_MISMATCH');
        }
        const actualPosted = parseFinancialCents(actualResult.rows[0]?.actual_posted ?? '0.00');
        const contractValue = parseFinancialCents(project.contract_value);
        if (actualPosted + finalPlanned > contractValue && !canOverrideBalance) {
          throw new ForbiddenException('P030_BALANCE_OVERRIDE_REQUIRED');
        }

        for (const entry of payload.entries) {
          await client.query(
            `insert into ltc_m.financial_plan_lines (
               plan_version_id,
               project_id,
               project_item_id,
               metric_type,
               planning_level,
               competence_month,
               amount,
               currency_code,
               created_by_user_id,
               updated_by_user_id
             ) values (
               $1::uuid,
               $2::uuid,
               $3::uuid,
               $4::ltc_m.planned_financial_metric,
               'item'::ltc_m.planning_level,
               $5::date,
               $6::numeric,
               $7::text,
               $8::uuid,
               $8::uuid
             )
             on conflict (
               plan_version_id,
               project_id,
               project_item_id,
               metric_type,
               competence_month
             ) where planning_level = 'item'::ltc_m.planning_level
             do update set amount = excluded.amount`,
            [
              versionId,
              projectId,
              entry.itemId,
              P029_PLANNED_METRIC,
              entry.competence,
              entry.amount,
              project.currency_code,
              actor.appUserId,
            ],
          );
        }

        const bumped = await client.query<{ readonly content_revision: string | number }>(
          `update ltc_m.plan_versions
           set content_revision = content_revision + 1,
               updated_by_user_id = $1::uuid
           where id = $2::uuid and content_revision = $3::bigint
           returning content_revision`,
          [actor.appUserId, versionId, payload.expectedVersion],
        );
        if (!bumped.rows[0]) throw new ConflictException('P029_BATCH_CONFLICT');
        return this.readEditor(client, projectId, { versionId }, canOverrideBalance);
      },
    );
  }

  private async findProject(
    client: PoolClient,
    projectId: string,
  ): Promise<ProjectRow | undefined> {
    const result = await client.query<ProjectRow>(
      `select
         id as project_id,
         project_code,
         project_name,
         base_currency as currency_code,
         contract_value::text,
         status::text as project_status,
         start_date,
         end_date
       from ltc_m.projects
       where id = $1::uuid and deleted_at is null`,
      [projectId],
    );
    return result.rows[0];
  }

  private async readFinancialSummary(
    client: PoolClient,
    projectId: string,
    versionId: string,
    versionStatus: string,
    canOverrideBalance: boolean,
  ): Promise<PlanningFinancialSummary> {
    const result = await client
      .query<FinancialRow>(
        `select
         projects.contract_value::text,
         projects.base_currency as currency_code,
         coalesce((
           select sum(events.amount)
           from ltc_m.financial_actual_events as events
           where events.project_id = projects.id
             and events.metric_type = 'billing_actual'::ltc_m.actual_financial_metric
             and events.status = 'posted'::ltc_m.actual_status
         ), 0)::numeric(20,2)::text as actual_posted,
         case when $3::text = 'draft' then coalesce((
           select sum(lines.amount)
           from ltc_m.financial_plan_lines as lines
           where lines.plan_version_id = $2::uuid
             and lines.project_id = projects.id
             and lines.metric_type = $4::ltc_m.planned_financial_metric
             and lines.planning_level = 'item'::ltc_m.planning_level
         ), 0)::numeric(20,2)::text else '0.00' end as planned_draft
         , exists (
             select 1
             from ltc_m.financial_actual_events as mismatch_events
             where mismatch_events.project_id = projects.id
               and mismatch_events.metric_type = 'billing_actual'::ltc_m.actual_financial_metric
               and mismatch_events.status = 'posted'::ltc_m.actual_status
               and mismatch_events.currency_code <> projects.base_currency
           ) as currency_mismatch
         , exists (
             select 1
             from ltc_m.financial_plan_lines as mismatch_lines
             where mismatch_lines.plan_version_id = $2::uuid
               and mismatch_lines.project_id = projects.id
               and mismatch_lines.metric_type = $4::ltc_m.planned_financial_metric
               and mismatch_lines.planning_level = 'item'::ltc_m.planning_level
               and mismatch_lines.currency_code <> projects.base_currency
           ) as planned_currency_mismatch
       from ltc_m.projects as projects
       where projects.id = $1::uuid`,
        [projectId, versionId, versionStatus, P029_PLANNED_METRIC],
      )
      .catch(mapFinancialQueryError);
    const row = result.rows[0];
    if (!row) throw new Error('P030_FINANCIAL_STATE_UNAVAILABLE');
    if (row.currency_mismatch || row.planned_currency_mismatch)
      throw new UnprocessableEntityException('P030_CURRENCY_MISMATCH');
    return calculateFinancialSummary(
      row.contract_value,
      row.actual_posted,
      row.planned_draft,
      row.currency_code,
      canOverrideBalance,
    );
  }

  private async readEditor(
    client: PoolClient,
    projectId: string,
    query: PlanningMonthQuery,
    canOverrideBalance: boolean,
  ): Promise<PlanningEditorResponse> {
    const project = await this.findProject(client, projectId);
    if (!project) throw new NotFoundException('P029_PROJECT_NOT_FOUND');
    const versionResult = await client.query<VersionRow>(
      `select
         versions.id as version_id,
         versions.name as version_name,
         versions.status::text as version_status,
           versions.row_version,
           versions.content_revision,
         versions.is_baseline
       from ltc_m.plan_versions as versions
       join ltc_m.financial_plan_scopes as scopes
         on scopes.plan_version_id = versions.id
       where versions.id = $1::uuid
         and scopes.project_id = $2::uuid
         and scopes.metric_type = $3::ltc_m.planned_financial_metric
         and scopes.planning_level = 'item'::ltc_m.planning_level`,
      [query.versionId, projectId, P029_PLANNED_METRIC],
    );
    const plan = versionResult.rows[0];
    if (!plan) throw new NotFoundException('P029_VERSION_NOT_FOUND');

    const boundResult = await client.query<BoundRow>(
      `select min(competence_month)::text as min_month, max(competence_month)::text as max_month
       from ltc_m.financial_plan_lines
       where plan_version_id = $1::uuid
         and project_id = $2::uuid
         and metric_type = $3::ltc_m.planned_financial_metric
         and planning_level = 'item'::ltc_m.planning_level`,
      [query.versionId, projectId, P029_PLANNED_METRIC],
    );
    const bounds = boundResult.rows[0];
    const from = query.from ?? bounds?.min_month ?? project.start_date;
    const to = query.to ?? bounds?.max_month ?? project.end_date;
    const competences = from && to ? monthsBetween(from, to) : [];
    const itemsResult = await client.query<ItemRow>(
      `select
         id as item_id,
         source_line_key,
         item_code,
         description,
         line_number,
         active
       from ltc_m.project_items
       where project_id = $1::uuid and deleted_at is null
       order by line_number asc, id asc`,
      [projectId],
    );
    const rangePredicate = from && to ? 'and competence_month between $4::date and $5::date' : '';
    const entryValues: unknown[] = [
      query.versionId,
      projectId,
      P029_PLANNED_METRIC,
      ...(from && to ? [from, to] : []),
    ];
    const entriesResult = await client.query<EntryRow>(
      `select project_item_id as item_id, competence_month::text, amount::text, row_version
       from ltc_m.financial_plan_lines
       where plan_version_id = $1::uuid
         and project_id = $2::uuid
         and metric_type = $3::ltc_m.planned_financial_metric
         and planning_level = 'item'::ltc_m.planning_level
         ${rangePredicate}
       order by competence_month asc, project_item_id asc`,
      entryValues,
    );
    const totalsResult = await client.query<TotalRow>(
      `select competence_month::text, sum(amount)::numeric(20,2)::text as amount
       from ltc_m.financial_plan_lines
       where plan_version_id = $1::uuid
         and project_id = $2::uuid
         and metric_type = $3::ltc_m.planned_financial_metric
         and planning_level = 'item'::ltc_m.planning_level
         ${rangePredicate}
       group by competence_month
       order by competence_month asc`,
      entryValues,
    );
    const financial = await this.readFinancialSummary(
      client,
      projectId,
      query.versionId,
      plan.version_status,
      canOverrideBalance,
    );
    const versionValue = versionOption(plan);
    return {
      contract: P029_MONTHLY_PLANNING_CONTRACT,
      project: projectOption(project),
      version: versionValue,
      competences,
      items: itemsResult.rows.map((item): PlanningItem => ({
        itemId: item.item_id,
        sourceLineKey: item.source_line_key,
        itemCode: item.item_code,
        description: item.description,
        lineNumber: item.line_number,
        active: item.active,
      })),
      entries: entriesResult.rows.map(mapEntry),
      projectTotals: totalsResult.rows.map(mapTotal),
      financial,
      range: { from: from ?? null, to: to ?? null },
    };
  }
}
