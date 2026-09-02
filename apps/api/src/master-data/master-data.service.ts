import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import type { ActorContext } from '../database/transaction.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  ClientCreatePayload,
  ClientPatchPayload,
  ClientRecord,
  CurrencyRecord,
  MasterDataListQuery,
  MasterDataListResponse,
  P026Currency,
  StatusPayload,
  UnitCreatePayload,
  UnitPatchPayload,
  UnitRecord,
} from './master-data.types.js';
import { P026_MASTER_DATA_CONTRACT } from './master-data.types.js';

interface ClientRow extends QueryResultRow {
  readonly id: string;
  readonly legal_name: string;
  readonly display_name: string;
  readonly tax_id: string | null;
  readonly active: boolean;
  readonly row_version: string | number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

interface CurrencyRow extends QueryResultRow {
  readonly code: string;
  readonly name: string;
  readonly decimal_places: number;
  readonly active: boolean;
  readonly row_version: string | number;
  readonly updated_at: string;
}

interface UnitRow extends QueryResultRow {
  readonly code: string;
  readonly name: string;
  readonly category: string | null;
  readonly active: boolean;
  readonly row_version: string | number;
  readonly updated_at: string;
}

function version(value: string | number): number {
  return Number(value);
}

function escapedLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/gu, '\\$&')}%`;
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function mapMutationError(error: unknown, kind: 'client' | 'unit'): never {
  switch (databaseErrorCode(error)) {
    case '23505':
      throw new ConflictException(
        kind === 'client' ? 'P026_CLIENT_CONFLICT' : 'P026_UNIT_CONFLICT',
      );
    case '23514':
      throw new UnprocessableEntityException('P026_CONSTRAINT_INVALID');
    case '42501':
      throw new ConflictException('P026_FORBIDDEN');
    default:
      throw error;
  }
}

function clientRecord(row: ClientRow): ClientRecord {
  return {
    id: row.id,
    legalName: row.legal_name,
    displayName: row.display_name,
    taxId: row.tax_id,
    active: row.active,
    rowVersion: version(row.row_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function currencyRecord(row: CurrencyRow): CurrencyRecord {
  return {
    code: row.code as P026Currency,
    name: row.name,
    decimalPlaces: row.decimal_places,
    active: row.active,
    rowVersion: version(row.row_version),
    updatedAt: row.updated_at,
  };
}

function unitRecord(row: UnitRow): UnitRecord {
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    active: row.active,
    rowVersion: version(row.row_version),
    updatedAt: row.updated_at,
  };
}

function response<T>(items: readonly T[]): MasterDataListResponse<T> {
  return { contract: P026_MASTER_DATA_CONTRACT, items };
}

@Injectable()
export class MasterDataService {
  constructor(private readonly database: DatabaseService) {}

  async listClients(
    query: MasterDataListQuery,
    actor: ActorContext,
  ): Promise<MasterDataListResponse<ClientRecord>> {
    return this.database.actorTransaction(actor, async (client) => {
      const { where, values } = this.filters(query, ['legal_name', 'display_name']);
      const result = await client.query<ClientRow>(
        `select id, legal_name, display_name, tax_id, active, row_version, created_at, updated_at, deleted_at
         from ltc_m.clients
         ${where}
         order by display_name asc, id asc`,
        values,
      );
      return response(result.rows.map(clientRecord));
    });
  }

  async createClient(payload: ClientCreatePayload, actor: ActorContext): Promise<ClientRecord> {
    return this.database.actorTransaction(actor, async (client) => {
      try {
        const result = await client.query<{ readonly id: string }>(
          `insert into ltc_m.clients (legal_name, display_name, tax_id)
           values ($1::text, $2::text, $3::text)
           returning id`,
          [payload.legalName, payload.displayName, payload.taxId ?? null],
        );
        const id = result.rows[0]?.id;
        const row = id ? await this.findClient(client, id) : undefined;
        if (!row) throw new Error('P026_CLIENT_RESULT_MISSING');
        return clientRecord(row);
      } catch (error) {
        mapMutationError(error, 'client');
      }
    });
  }

  async updateClient(
    id: string,
    payload: ClientPatchPayload,
    actor: ActorContext,
  ): Promise<ClientRecord> {
    return this.database.actorTransaction(actor, async (client) => {
      if (!(await this.findClient(client, id)))
        throw new NotFoundException('P026_CLIENT_NOT_FOUND');
      const values: unknown[] = [];
      const assignments: string[] = [];
      const add = (column: string, value: unknown) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}::text`);
      };
      if (payload.legalName !== undefined) add('legal_name', payload.legalName);
      if (payload.displayName !== undefined) add('display_name', payload.displayName);
      if (payload.taxId !== undefined) add('tax_id', payload.taxId);
      values.push(id, payload.expectedVersion);
      try {
        const result = await client.query<{ readonly id: string }>(
          `update ltc_m.clients
           set ${assignments.join(', ')}
           where id = $${values.length - 1}::uuid and row_version = $${values.length}::bigint
           returning id`,
          values,
        );
        if (!result.rows[0]) throw new ConflictException('P026_CLIENT_VERSION_CONFLICT');
        const row = await this.findClient(client, id);
        if (!row) throw new NotFoundException('P026_CLIENT_NOT_FOUND');
        return clientRecord(row);
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
        mapMutationError(error, 'client');
      }
    });
  }

  async setClientStatus(
    id: string,
    payload: StatusPayload,
    actor: ActorContext,
  ): Promise<ClientRecord> {
    return this.database.actorTransaction(
      { ...actor, justification: payload.justification },
      async (client) => {
        if (!(await this.findClient(client, id)))
          throw new NotFoundException('P026_CLIENT_NOT_FOUND');
        const result = await client.query<{ readonly id: string }>(
          `update ltc_m.clients
         set active = $1::boolean
         where id = $2::uuid and row_version = $3::bigint
         returning id`,
          [payload.active, id, payload.expectedVersion],
        );
        if (!result.rows[0]) throw new ConflictException('P026_CLIENT_VERSION_CONFLICT');
        const row = await this.findClient(client, id);
        if (!row) throw new NotFoundException('P026_CLIENT_NOT_FOUND');
        return clientRecord(row);
      },
    );
  }

  async listCurrencies(
    query: MasterDataListQuery,
    actor: ActorContext,
  ): Promise<MasterDataListResponse<CurrencyRecord>> {
    return this.database.actorTransaction(actor, async (client) => {
      const values: unknown[] = [];
      const filters = [`code in ('BRL', 'USD')`];
      this.appendStatusFilter(query, filters);
      if (query.search) {
        values.push(escapedLikePattern(query.search));
        filters.push(
          `(code ilike $${values.length} escape E'\\\\' or name ilike $${values.length} escape E'\\\\')`,
        );
      }
      const result = await client.query<CurrencyRow>(
        `select code, name, decimal_places, active, row_version, updated_at
         from ltc_m.currencies where ${filters.join(' and ')} order by code`,
        values,
      );
      return response(result.rows.map(currencyRecord));
    });
  }

  async setCurrencyStatus(
    code: P026Currency,
    payload: StatusPayload,
    actor: ActorContext,
  ): Promise<CurrencyRecord> {
    return this.database.actorTransaction(
      { ...actor, justification: payload.justification },
      async (client) => {
        const current = await this.findCurrency(client, code);
        if (!current) throw new NotFoundException('P026_CURRENCY_NOT_FOUND');
        const result = await client.query<{ readonly code: string }>(
          `update ltc_m.currencies
         set active = $1::boolean
         where code = $2::text and row_version = $3::bigint
         returning code`,
          [payload.active, code, payload.expectedVersion],
        );
        if (!result.rows[0]) throw new ConflictException('P026_VERSION_CONFLICT');
        const row = await this.findCurrency(client, code);
        if (!row) throw new NotFoundException('P026_CURRENCY_NOT_FOUND');
        return currencyRecord(row);
      },
    );
  }

  async listUnits(
    query: MasterDataListQuery,
    actor: ActorContext,
  ): Promise<MasterDataListResponse<UnitRecord>> {
    return this.database.actorTransaction(actor, async (client) => {
      const { where, values } = this.filters(query, ['code', 'name', 'category']);
      const result = await client.query<UnitRow>(
        `select code, name, category, active, row_version, updated_at
         from ltc_m.units ${where} order by name asc, code asc`,
        values,
      );
      return response(result.rows.map(unitRecord));
    });
  }

  async createUnit(payload: UnitCreatePayload, actor: ActorContext): Promise<UnitRecord> {
    return this.database.actorTransaction(actor, async (client) => {
      try {
        const result = await client.query<{ readonly code: string }>(
          `insert into ltc_m.units (code, name, category)
           values ($1::text, $2::text, $3::text)
           returning code`,
          [payload.code, payload.name, payload.category],
        );
        const code = result.rows[0]?.code;
        const row = code ? await this.findUnit(client, code) : undefined;
        if (!row) throw new Error('P026_UNIT_RESULT_MISSING');
        return unitRecord(row);
      } catch (error) {
        mapMutationError(error, 'unit');
      }
    });
  }

  async updateUnit(
    code: string,
    payload: UnitPatchPayload,
    actor: ActorContext,
  ): Promise<UnitRecord> {
    return this.database.actorTransaction(actor, async (client) => {
      if (!(await this.findUnit(client, code))) throw new NotFoundException('P026_UNIT_NOT_FOUND');
      const values: unknown[] = [];
      const assignments: string[] = [];
      if (payload.name !== undefined) {
        values.push(payload.name);
        assignments.push(`name = $${values.length}::text`);
      }
      if (payload.category !== undefined) {
        values.push(payload.category);
        assignments.push(`category = $${values.length}::text`);
      }
      values.push(code, payload.expectedVersion);
      try {
        const result = await client.query<{ readonly code: string }>(
          `update ltc_m.units set ${assignments.join(', ')}
           where code = $${values.length - 1}::text and row_version = $${values.length}::bigint
           returning code`,
          values,
        );
        if (!result.rows[0]) throw new ConflictException('P026_VERSION_CONFLICT');
        const row = await this.findUnit(client, code);
        if (!row) throw new NotFoundException('P026_UNIT_NOT_FOUND');
        return unitRecord(row);
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
        mapMutationError(error, 'unit');
      }
    });
  }

  async setUnitStatus(
    code: string,
    payload: StatusPayload,
    actor: ActorContext,
  ): Promise<UnitRecord> {
    return this.database.actorTransaction(
      { ...actor, justification: payload.justification },
      async (client) => {
        if (!(await this.findUnit(client, code)))
          throw new NotFoundException('P026_UNIT_NOT_FOUND');
        const result = await client.query<{ readonly code: string }>(
          `update ltc_m.units set active = $1::boolean
         where code = $2::text and row_version = $3::bigint
         returning code`,
          [payload.active, code, payload.expectedVersion],
        );
        if (!result.rows[0]) throw new ConflictException('P026_VERSION_CONFLICT');
        const row = await this.findUnit(client, code);
        if (!row) throw new NotFoundException('P026_UNIT_NOT_FOUND');
        return unitRecord(row);
      },
    );
  }

  private filters(query: MasterDataListQuery, columns: readonly string[]) {
    const values: unknown[] = [];
    const filters: string[] = [];
    this.appendStatusFilter(query, filters);
    if (query.search) {
      values.push(escapedLikePattern(query.search));
      const placeholder = `$${values.length}`;
      filters.push(
        `(${columns.map((column) => `${column} ilike ${placeholder} escape E'\\\\'`).join(' or ')})`,
      );
    }
    return { where: filters.length ? `where ${filters.join(' and ')}` : '', values };
  }

  private appendStatusFilter(query: MasterDataListQuery, filters: string[]): void {
    if (query.status === 'active') filters.push('active = true');
    if (query.status === 'inactive') filters.push('active = false');
  }

  private async findClient(client: PoolClient, id: string): Promise<ClientRow | undefined> {
    const result = await client.query<ClientRow>(
      `select id, legal_name, display_name, tax_id, active, row_version, created_at, updated_at, deleted_at
       from ltc_m.clients where id = $1::uuid`,
      [id],
    );
    return result.rows[0];
  }

  private async findCurrency(
    client: PoolClient,
    code: P026Currency,
  ): Promise<CurrencyRow | undefined> {
    const result = await client.query<CurrencyRow>(
      `select code, name, decimal_places, active, row_version, updated_at
       from ltc_m.currencies where code = $1::text`,
      [code],
    );
    return result.rows[0];
  }

  private async findUnit(client: PoolClient, code: string): Promise<UnitRow | undefined> {
    const result = await client.query<UnitRow>(
      `select code, name, category, active, row_version, updated_at
       from ltc_m.units where code = $1::text`,
      [code],
    );
    return result.rows[0];
  }
}
