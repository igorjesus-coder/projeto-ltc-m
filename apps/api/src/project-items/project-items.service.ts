import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import type { Role } from '../auth/authorization.js';
import type { ActorContext } from '../database/transaction.js';
import { DatabaseService } from '../database/database.service.js';
import {
  P027_PROJECT_ITEMS_CONTRACT,
  type P027Currency,
  type ProjectItemCatalogOption,
  type ProjectItemCreatePayload,
  type ProjectItemDuplicatePayload,
  type ProjectItemInactivatePayload,
  type ProjectItemPatchPayload,
  type ProjectItemRecord,
  type ProjectItemsResponse,
} from './project-items.types.js';

interface ProjectRow extends QueryResultRow {
  readonly id: string;
  readonly base_currency: P027Currency;
  readonly project_status: string;
  readonly deleted_at: string | null;
  readonly currency_active: boolean;
}

interface ItemRow extends QueryResultRow {
  readonly id: string;
  readonly project_id: string;
  readonly source_line_key: string;
  readonly line_number: number;
  readonly item_code: string | null;
  readonly description: string | null;
  readonly quantity: string;
  readonly unit_code: string;
  readonly unit_name: string;
  readonly unit_available: boolean;
  readonly currency_code: P027Currency;
  readonly currency_name: string;
  readonly currency_available: boolean;
  readonly unit_price: string;
  readonly total_amount: string;
  readonly active: boolean;
  readonly deleted_at: string | null;
  readonly row_version: string | number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface UnitRow extends QueryResultRow {
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function mapMutationError(error: unknown): never {
  switch (databaseErrorCode(error)) {
    case '23505':
      throw new ConflictException('P027_ITEM_CONFLICT');
    case '23503':
      throw new UnprocessableEntityException('P027_REFERENCE_UNAVAILABLE');
    case '23514':
      throw new UnprocessableEntityException('P027_CONSTRAINT_INVALID');
    case '42501':
      throw new ConflictException('P027_FORBIDDEN');
    default:
      throw error;
  }
}

function rowVersion(value: string | number): number {
  return Number(value);
}

function toItem(row: ItemRow): ProjectItemRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceLineKey: row.source_line_key,
    lineNumber: row.line_number,
    itemCode: row.item_code,
    description: row.description,
    quantity: row.quantity,
    unitCode: row.unit_code,
    unitName: row.unit_name,
    unitAvailable: row.unit_available,
    currencyCode: row.currency_code,
    currencyName: row.currency_name,
    currencyAvailable: row.currency_available,
    unitPrice: row.unit_price,
    totalAmount: row.total_amount,
    active: row.active,
    deletedAt: row.deleted_at,
    rowVersion: rowVersion(row.row_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureProjectWritable(project: ProjectRow, role: Role): void {
  if (project.deleted_at !== null) throw new NotFoundException('P027_PROJECT_NOT_FOUND');
  if (role === 'editor' && project.project_status !== 'active') {
    throw new ConflictException('P027_PROJECT_STATUS_NOT_EDITABLE');
  }
}

@Injectable()
export class ProjectItemsService {
  constructor(private readonly database: DatabaseService) {}

  async list(projectId: string, actor: ActorContext): Promise<ProjectItemsResponse> {
    return this.database.actorTransaction(actor, async (client) => {
      const project = await this.findProject(client, projectId);
      if (!project || project.deleted_at !== null) {
        throw new NotFoundException('P027_PROJECT_NOT_FOUND');
      }
      const result = await client.query<ItemRow>(
        `select
           project_items.id,
           project_items.project_id,
           project_items.source_line_key,
           project_items.line_number,
           project_items.item_code,
           project_items.description,
           project_items.quantity,
           project_items.unit_code,
           units.name as unit_name,
           units.active as unit_available,
           project_items.currency_code,
           currencies.name as currency_name,
           currencies.active as currency_available,
           project_items.unit_price,
           project_items.total_amount,
           project_items.active,
           project_items.deleted_at,
           project_items.row_version,
           project_items.created_at,
           project_items.updated_at
         from ltc_m.project_items
         join ltc_m.units on units.code = project_items.unit_code
         join ltc_m.currencies on currencies.code = project_items.currency_code
         where project_items.project_id = $1::uuid
           and project_items.deleted_at is null
         order by project_items.line_number asc, project_items.id asc`,
        [projectId],
      );
      const units = await client.query<UnitRow>(
        `select code, name, active
         from ltc_m.units
         where active = true
            or exists (
              select 1 from ltc_m.project_items as historical_items
              where historical_items.project_id = $1::uuid
                and historical_items.unit_code = ltc_m.units.code
                and historical_items.deleted_at is null
            )
         order by active desc, code asc`,
        [projectId],
      );
      return {
        contract: P027_PROJECT_ITEMS_CONTRACT,
        projectId,
        projectCurrency: project.base_currency,
        projectCurrencyAvailable: project.currency_active,
        units: units.rows.map((unit): ProjectItemCatalogOption => unit),
        items: result.rows.map(toItem),
      };
    });
  }

  async create(
    projectId: string,
    payload: ProjectItemCreatePayload,
    actor: ActorContext,
    role: Role,
  ): Promise<ProjectItemRecord> {
    return this.database.actorTransaction(actor, async (client) => {
      const project = await this.lockProject(client, projectId);
      if (!project) throw new NotFoundException('P027_PROJECT_NOT_FOUND');
      ensureProjectWritable(project, role);
      this.ensureCurrency(payload.currencyCode, project);
      await this.ensureActiveUnit(client, payload.unitCode);
      return this.insertItem(client, projectId, project.base_currency, payload);
    });
  }

  async update(
    projectId: string,
    itemId: string,
    payload: ProjectItemPatchPayload,
    actor: ActorContext,
    role: Role,
  ): Promise<ProjectItemRecord> {
    return this.database.actorTransaction(actor, async (client) => {
      const project = await this.findProject(client, projectId);
      if (!project) throw new NotFoundException('P027_PROJECT_NOT_FOUND');
      ensureProjectWritable(project, role);
      const current = await this.findItem(client, projectId, itemId);
      if (!current) throw new NotFoundException('P027_ITEM_NOT_FOUND');
      if (payload.currencyCode !== undefined) this.ensureCurrency(payload.currencyCode, project);
      if (payload.unitCode !== undefined && payload.unitCode !== current.unit_code) {
        await this.ensureActiveUnit(client, payload.unitCode);
      }

      const values: unknown[] = [];
      const assignments: string[] = [];
      const add = (column: string, value: unknown, cast: string) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}::${cast}`);
      };
      if (payload.itemCode !== undefined) add('item_code', payload.itemCode, 'text');
      if (payload.description !== undefined) add('description', payload.description, 'text');
      if (payload.quantity !== undefined) add('quantity', payload.quantity, 'numeric');
      if (payload.unitCode !== undefined) add('unit_code', payload.unitCode, 'text');
      if (payload.currencyCode !== undefined) add('currency_code', payload.currencyCode, 'text');
      if (payload.unitPrice !== undefined) add('unit_price', payload.unitPrice, 'numeric');
      values.push(itemId, projectId, payload.expectedVersion);
      try {
        const result = await client.query<{ readonly id: string }>(
          `update ltc_m.project_items
           set ${assignments.join(', ')}
           where id = $${values.length - 2}::uuid
             and project_id = $${values.length - 1}::uuid
             and row_version = $${values.length}::bigint
             and deleted_at is null
           returning id`,
          values,
        );
        if (!result.rows[0]) throw new ConflictException('P027_ITEM_VERSION_CONFLICT');
        const row = await this.findItem(client, projectId, itemId);
        if (!row) throw new NotFoundException('P027_ITEM_NOT_FOUND');
        return toItem(row);
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
        mapMutationError(error);
      }
    });
  }

  async duplicate(
    projectId: string,
    itemId: string,
    payload: ProjectItemDuplicatePayload,
    actor: ActorContext,
    role: Role,
  ): Promise<ProjectItemRecord> {
    return this.database.actorTransaction(actor, async (client) => {
      const project = await this.lockProject(client, projectId);
      if (!project) throw new NotFoundException('P027_PROJECT_NOT_FOUND');
      ensureProjectWritable(project, role);
      const source = await this.findItem(client, projectId, itemId);
      if (!source) throw new NotFoundException('P027_ITEM_NOT_FOUND');
      if (rowVersion(source.row_version) !== payload.expectedVersion) {
        throw new ConflictException('P027_ITEM_VERSION_CONFLICT');
      }
      this.ensureCurrency(source.currency_code, project);
      await this.ensureActiveUnit(client, source.unit_code);
      const lineNumber = await this.nextLineNumber(client, projectId);
      try {
        const result = await client.query<{ readonly id: string }>(
          `insert into ltc_m.project_items (
             project_id, source_line_key, line_number, item_code, description,
             quantity, unit_code, currency_code, unit_price, active
           ) values ($1::uuid, $2::text, $3::integer, $4::text, $5::text,
             $6::numeric, $7::text, $8::text, $9::numeric, true)
           returning id`,
          [
            projectId,
            `manual:${randomUUID()}`,
            lineNumber,
            source.item_code,
            source.description,
            source.quantity,
            source.unit_code,
            project.base_currency,
            source.unit_price,
          ],
        );
        const id = result.rows[0]?.id;
        const row = id ? await this.findItem(client, projectId, id) : undefined;
        if (!row) throw new Error('P027_DUPLICATE_RESULT_MISSING');
        return toItem(row);
      } catch (error) {
        mapMutationError(error);
      }
    });
  }

  async inactivate(
    projectId: string,
    itemId: string,
    payload: ProjectItemInactivatePayload,
    actor: ActorContext,
    role: Role,
  ): Promise<ProjectItemRecord> {
    return this.database.actorTransaction(
      { ...actor, justification: payload.justification },
      async (client) => {
        const project = await this.findProject(client, projectId);
        if (!project) throw new NotFoundException('P027_PROJECT_NOT_FOUND');
        ensureProjectWritable(project, role);
        const current = await this.findItem(client, projectId, itemId);
        if (!current) throw new NotFoundException('P027_ITEM_NOT_FOUND');
        if (!current.active) throw new ConflictException('P027_ITEM_ALREADY_INACTIVE');
        const result = await client.query<{ readonly id: string }>(
          `update ltc_m.project_items
           set active = false
           where id = $1::uuid
             and project_id = $2::uuid
             and row_version = $3::bigint
             and deleted_at is null
           returning id`,
          [itemId, projectId, payload.expectedVersion],
        );
        if (!result.rows[0]) throw new ConflictException('P027_ITEM_VERSION_CONFLICT');
        const row = await this.findItem(client, projectId, itemId);
        if (!row) throw new NotFoundException('P027_ITEM_NOT_FOUND');
        return toItem(row);
      },
    );
  }

  private ensureCurrency(currency: P027Currency, project: ProjectRow): void {
    if (currency !== project.base_currency || !project.currency_active) {
      throw new UnprocessableEntityException('P027_PROJECT_CURRENCY_UNAVAILABLE');
    }
  }

  private async ensureActiveUnit(client: PoolClient, code: string): Promise<void> {
    const result = await client.query<{ readonly active: boolean }>(
      `select active from ltc_m.units where code = $1::text`,
      [code],
    );
    if (!result.rows[0]?.active) throw new UnprocessableEntityException('P027_UNIT_UNAVAILABLE');
  }

  private async insertItem(
    client: PoolClient,
    projectId: string,
    currencyCode: P027Currency,
    payload: ProjectItemCreatePayload,
  ): Promise<ProjectItemRecord> {
    const lineNumber = await this.nextLineNumber(client, projectId);
    try {
      const result = await client.query<{ readonly id: string }>(
        `insert into ltc_m.project_items (
           project_id, source_line_key, line_number, item_code, description,
           quantity, unit_code, currency_code, unit_price, active
         ) values ($1::uuid, $2::text, $3::integer, $4::text, $5::text,
           $6::numeric, $7::text, $8::text, $9::numeric, true)
         returning id`,
        [
          projectId,
          `manual:${randomUUID()}`,
          lineNumber,
          payload.itemCode,
          payload.description,
          payload.quantity,
          payload.unitCode,
          currencyCode,
          payload.unitPrice,
        ],
      );
      const id = result.rows[0]?.id;
      const row = id ? await this.findItem(client, projectId, id) : undefined;
      if (!row) throw new Error('P027_CREATE_RESULT_MISSING');
      return toItem(row);
    } catch (error) {
      mapMutationError(error);
    }
  }

  private async nextLineNumber(client: PoolClient, projectId: string): Promise<number> {
    const result = await client.query<{ readonly line_number: number }>(
      `select coalesce(max(line_number), 0)::integer + 1 as line_number
       from ltc_m.project_items
       where project_id = $1::uuid`,
      [projectId],
    );
    return result.rows[0]?.line_number ?? 1;
  }

  private async lockProject(
    client: PoolClient,
    projectId: string,
  ): Promise<ProjectRow | undefined> {
    return this.findProject(client, projectId, true);
  }

  private async findProject(
    client: PoolClient,
    projectId: string,
    forUpdate = false,
  ): Promise<ProjectRow | undefined> {
    const result = await client.query<ProjectRow>(
      `select
         projects.id,
         projects.base_currency,
         projects.status::text as project_status,
         projects.deleted_at,
         exists (
           select 1 from ltc_m.currencies
           where currencies.code = projects.base_currency and currencies.active = true
         ) as currency_active
       from ltc_m.projects
       where projects.id = $1::uuid
       ${forUpdate ? 'for update' : ''}`,
      [projectId],
    );
    return result.rows[0];
  }

  private async findItem(
    client: PoolClient,
    projectId: string,
    itemId: string,
  ): Promise<ItemRow | undefined> {
    const result = await client.query<ItemRow>(
      `select
         project_items.id,
         project_items.project_id,
         project_items.source_line_key,
         project_items.line_number,
         project_items.item_code,
         project_items.description,
         project_items.quantity,
         project_items.unit_code,
         units.name as unit_name,
         units.active as unit_available,
         project_items.currency_code,
         currencies.name as currency_name,
         currencies.active as currency_available,
         project_items.unit_price,
         project_items.total_amount,
         project_items.active,
         project_items.deleted_at,
         project_items.row_version,
         project_items.created_at,
         project_items.updated_at
       from ltc_m.project_items
       join ltc_m.units on units.code = project_items.unit_code
       join ltc_m.currencies on currencies.code = project_items.currency_code
       where project_items.id = $1::uuid
         and project_items.project_id = $2::uuid
         and project_items.deleted_at is null`,
      [itemId, projectId],
    );
    return result.rows[0];
  }
}
