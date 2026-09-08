import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import type { ActorContext } from '../database/transaction.js';
import { DatabaseService } from '../database/database.service.js';
import {
  P032_REALIZED_EVENTS_CONTRACT,
  type RealizedEventCancelPayload,
  type RealizedEventCreatePayload,
  type RealizedEventItemOption,
  type RealizedEventPatchPayload,
  type RealizedEventRecord,
  type RealizedEventStatus,
  type RealizedEventsResponse,
} from './realized-events.types.js';

interface ProjectRow extends QueryResultRow {
  readonly id: string;
  readonly project_code: string;
  readonly project_name: string;
  readonly base_currency: string;
  readonly deleted_at: string | null;
}

interface EventRow extends QueryResultRow {
  readonly id: string;
  readonly project_id: string;
  readonly project_item_id: string | null;
  readonly item_code: string | null;
  readonly item_description: string | null;
  readonly competence_date: string;
  readonly source_key: string;
  readonly document_number: string | null;
  readonly installment_key: string | null;
  readonly amount: string;
  readonly currency_code: string;
  readonly status: RealizedEventStatus;
  readonly notes: string | null;
  readonly row_version: string | number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ItemRow extends QueryResultRow {
  readonly id: string;
  readonly item_code: string | null;
  readonly description: string | null;
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function mapMutationError(error: unknown): never {
  switch (databaseErrorCode(error)) {
    case '23505':
      throw new ConflictException('P032_SOURCE_KEY_CONFLICT');
    case '23503':
      throw new UnprocessableEntityException('P032_REFERENCE_UNAVAILABLE');
    case '23514':
      throw new UnprocessableEntityException('P032_CONSTRAINT_INVALID');
    case '42501':
      throw new ConflictException('P032_FORBIDDEN');
    default:
      throw error;
  }
}

function toEvent(row: EventRow): RealizedEventRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectItemId: row.project_item_id,
    itemCode: row.item_code,
    itemDescription: row.item_description,
    metricType: 'billing_actual',
    competenceDate: row.competence_date,
    sourceKey: row.source_key,
    documentNumber: row.document_number,
    installmentKey: row.installment_key,
    amount: row.amount,
    currencyCode: row.currency_code,
    status: row.status,
    notes: row.notes,
    rowVersion: Number(row.row_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class RealizedEventsService {
  constructor(private readonly database: DatabaseService) {}

  async list(projectId: string, actor: ActorContext): Promise<RealizedEventsResponse> {
    return this.database.actorTransaction(actor, async (client) => {
      const project = await this.findProject(client, projectId);
      if (!project) throw new NotFoundException('P032_PROJECT_NOT_FOUND');
      const events = await client.query<EventRow>(
        `${this.eventQuery()} order by events.competence_date asc, events.created_at asc, events.id asc`,
        [projectId],
      );
      const items = await client.query<ItemRow>(
        `select id, item_code, description
           from ltc_m.project_items
          where project_id = $1::uuid
            and deleted_at is null
          order by line_number asc, id asc`,
        [projectId],
      );
      return {
        contract: P032_REALIZED_EVENTS_CONTRACT,
        projectId,
        project: {
          code: project.project_code,
          name: project.project_name,
          currencyCode: project.base_currency,
        },
        projectItems: items.rows.map((item): RealizedEventItemOption => ({
          id: item.id,
          itemCode: item.item_code,
          description: item.description,
        })),
        events: events.rows.map(toEvent),
      };
    });
  }

  async create(
    projectId: string,
    payload: RealizedEventCreatePayload,
    actor: ActorContext,
  ): Promise<RealizedEventRecord> {
    return this.database.actorTransaction(actor, async (client) => {
      const project = await this.findProject(client, projectId);
      if (!project) throw new NotFoundException('P032_PROJECT_NOT_FOUND');
      this.ensureCurrency(payload.currencyCode, project);
      await this.ensureItem(client, projectId, payload.projectItemId);
      try {
        const result = await client.query<{ readonly id: string }>(
          `insert into ltc_m.financial_actual_events (
             project_id, project_item_id, metric_type, competence_date, source_key,
             document_number, installment_key, amount, currency_code,
             created_by_user_id, updated_by_user_id, notes
           ) values (
             $1::uuid, $2::uuid, 'billing_actual'::ltc_m.actual_financial_metric,
             $3::date, $4::text, $5::text, $6::text, $7::numeric, $8::text,
             $9::uuid, $9::uuid, $10::text
           ) returning id`,
          [
            projectId,
            payload.projectItemId,
            payload.competenceDate,
            payload.sourceKey,
            payload.documentNumber,
            payload.installmentKey,
            payload.amount,
            project.base_currency,
            actor.appUserId,
            payload.notes,
          ],
        );
        return this.result(client, projectId, result.rows[0]?.id);
      } catch (error) {
        mapMutationError(error);
      }
    });
  }

  async update(
    projectId: string,
    eventId: string,
    payload: RealizedEventPatchPayload,
    actor: ActorContext,
  ): Promise<RealizedEventRecord> {
    return this.database.actorTransaction(actor, async (client) => {
      const project = await this.findProject(client, projectId);
      if (!project) throw new NotFoundException('P032_PROJECT_NOT_FOUND');
      const current = await this.findEvent(client, projectId, eventId);
      if (!current) throw new NotFoundException('P032_EVENT_NOT_FOUND');
      if (current.status === 'cancelled') throw new ConflictException('P032_EVENT_TERMINAL');
      if (payload.currencyCode !== undefined) this.ensureCurrency(payload.currencyCode, project);
      if (payload.projectItemId !== undefined)
        await this.ensureItem(client, projectId, payload.projectItemId);

      const values: unknown[] = [];
      const assignments: string[] = [];
      const add = (column: string, value: unknown, cast: string) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}::${cast}`);
      };
      if (payload.projectItemId !== undefined)
        add('project_item_id', payload.projectItemId, 'uuid');
      if (payload.competenceDate !== undefined)
        add('competence_date', payload.competenceDate, 'date');
      if (payload.sourceKey !== undefined) add('source_key', payload.sourceKey, 'text');
      if (payload.documentNumber !== undefined)
        add('document_number', payload.documentNumber, 'text');
      if (payload.installmentKey !== undefined)
        add('installment_key', payload.installmentKey, 'text');
      if (payload.amount !== undefined) add('amount', payload.amount, 'numeric');
      if (payload.currencyCode !== undefined) add('currency_code', payload.currencyCode, 'text');
      if (payload.notes !== undefined) add('notes', payload.notes, 'text');
      values.push(actor.appUserId, eventId, projectId, payload.expectedVersion);
      try {
        const result = await client.query<{ readonly id: string }>(
          `update ltc_m.financial_actual_events
              set ${assignments.join(', ')}, updated_by_user_id = $${values.length - 3}::uuid
            where id = $${values.length - 2}::uuid
              and project_id = $${values.length - 1}::uuid
              and row_version = $${values.length}::bigint
              and status in ('draft', 'posted')
            returning id`,
          values,
        );
        if (!result.rows[0]) throw new ConflictException('P032_EVENT_VERSION_CONFLICT');
        return this.result(client, projectId, eventId);
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
        mapMutationError(error);
      }
    });
  }

  async publish(
    projectId: string,
    eventId: string,
    expectedVersion: number,
    actor: ActorContext,
  ): Promise<RealizedEventRecord> {
    return this.transition(projectId, eventId, expectedVersion, 'posted', actor);
  }

  async cancel(
    projectId: string,
    eventId: string,
    payload: RealizedEventCancelPayload,
    actor: ActorContext,
  ): Promise<RealizedEventRecord> {
    return this.database.actorTransaction(
      { ...actor, justification: payload.justification },
      async (client) => {
        const project = await this.findProject(client, projectId);
        if (!project) throw new NotFoundException('P032_PROJECT_NOT_FOUND');
        const current = await this.findEvent(client, projectId, eventId);
        if (!current) throw new NotFoundException('P032_EVENT_NOT_FOUND');
        if (current.status === 'cancelled') throw new ConflictException('P032_EVENT_TERMINAL');
        try {
          const result = await client.query<{ readonly id: string }>(
            `update ltc_m.financial_actual_events
                set status = 'cancelled'::ltc_m.actual_status,
                    updated_by_user_id = $1::uuid
              where id = $2::uuid
                and project_id = $3::uuid
                and row_version = $4::bigint
                and status in ('draft', 'posted')
              returning id`,
            [actor.appUserId, eventId, projectId, payload.expectedVersion],
          );
          if (!result.rows[0]) throw new ConflictException('P032_EVENT_VERSION_CONFLICT');
          return this.result(client, projectId, eventId);
        } catch (error) {
          if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
          mapMutationError(error);
        }
      },
    );
  }

  private async transition(
    projectId: string,
    eventId: string,
    expectedVersion: number,
    target: 'posted',
    actor: ActorContext,
  ): Promise<RealizedEventRecord> {
    return this.database.actorTransaction(actor, async (client) => {
      const project = await this.findProject(client, projectId);
      if (!project) throw new NotFoundException('P032_PROJECT_NOT_FOUND');
      const current = await this.findEvent(client, projectId, eventId);
      if (!current) throw new NotFoundException('P032_EVENT_NOT_FOUND');
      if (current.status === 'posted') throw new ConflictException('P032_EVENT_ALREADY_POSTED');
      if (current.status === 'cancelled') throw new ConflictException('P032_EVENT_TERMINAL');
      try {
        const result = await client.query<{ readonly id: string }>(
          `update ltc_m.financial_actual_events
              set status = $1::ltc_m.actual_status, updated_by_user_id = $2::uuid
            where id = $3::uuid
              and project_id = $4::uuid
              and row_version = $5::bigint
              and status = 'draft'
            returning id`,
          [target, actor.appUserId, eventId, projectId, expectedVersion],
        );
        if (!result.rows[0]) throw new ConflictException('P032_EVENT_VERSION_CONFLICT');
        return this.result(client, projectId, eventId);
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
        mapMutationError(error);
      }
    });
  }

  private async findProject(
    client: PoolClient,
    projectId: string,
  ): Promise<ProjectRow | undefined> {
    const result = await client.query<ProjectRow>(
      `select id, project_code, project_name, base_currency, deleted_at
         from ltc_m.projects
        where id = $1::uuid
        limit 1`,
      [projectId],
    );
    const project = result.rows[0];
    return project && project.deleted_at === null ? project : undefined;
  }

  private async findEvent(
    client: PoolClient,
    projectId: string,
    eventId: string,
  ): Promise<EventRow | undefined> {
    const result = await client.query<EventRow>(`${this.eventQuery()} and events.id = $2::uuid`, [
      projectId,
      eventId,
    ]);
    return result.rows[0];
  }

  private eventQuery(): string {
    return `select
              events.id, events.project_id, events.project_item_id,
              project_items.item_code, project_items.description as item_description,
              events.competence_date::text, events.source_key, events.document_number,
              events.installment_key, events.amount::text, events.currency_code,
              events.status::text as status, events.notes, events.row_version,
              events.created_at::text, events.updated_at::text
            from ltc_m.financial_actual_events as events
            left join ltc_m.project_items as project_items
              on project_items.id = events.project_item_id
             and project_items.project_id = events.project_id
           where events.project_id = $1::uuid`;
  }

  private async ensureItem(
    client: PoolClient,
    projectId: string,
    itemId: string | null,
  ): Promise<void> {
    if (itemId === null) return;
    const result = await client.query<{ readonly id: string }>(
      `select id from ltc_m.project_items where id = $1::uuid and project_id = $2::uuid limit 1`,
      [itemId, projectId],
    );
    if (!result.rows[0]) throw new UnprocessableEntityException('P032_PROJECT_ITEM_UNAVAILABLE');
  }

  private ensureCurrency(currencyCode: string, project: ProjectRow): void {
    if (currencyCode !== project.base_currency) {
      throw new UnprocessableEntityException('P032_PROJECT_CURRENCY_INVALID');
    }
  }

  private async result(
    client: PoolClient,
    projectId: string,
    eventId: string | undefined,
  ): Promise<RealizedEventRecord> {
    if (!eventId) throw new Error('P032_RESULT_MISSING');
    const row = await this.findEvent(client, projectId, eventId);
    if (!row) throw new Error('P032_RESULT_MISSING');
    return toEvent(row);
  }
}
