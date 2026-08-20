import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import {
  P012PersistenceError,
  type P012ActorContext,
  type P012LogicalEnvironment,
  type P012PersistenceOperation,
  type P012PersistencePlan,
  type P012PersistencePort,
  type P012PersistenceTransaction,
  type P012SnapshotScope,
  type P012StagingRecord,
} from '../../src/item-persistence.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PROJECT_CODE = /^\d{4}-\d{2}-\d{5}$/u;
const PROJECT_LOCK_NAMESPACE = 'ltc_m.p012.project:';
const SUPPORTED_UNITS = ['SERV', 'UN', 'US'] as const;
const LOCAL_DATABASE = /^ltcm_(?:ci|local|test)(?:_[a-z0-9_]+)?$/u;
const AUTHORIZED_TEST_POOLS = new WeakMap<
  Pool,
  { environment: P012LogicalEnvironment; databaseName: string }
>();

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface P012PostgresAdapterOptions {
  environment: P012LogicalEnvironment;
  pool: Pool;
  setLocalRuntimeRoleForTests?: boolean;
}

export interface P012PostgresTestHarness {
  readonly adapter: P012PersistencePort;
  close(): Promise<void>;
}

export interface P012LoopbackDatabaseTarget {
  databaseName: string;
  hostname: '127.0.0.1' | 'localhost' | '[::1]';
  port: 5432;
}

function sanitized(code: ConstructorParameters<typeof P012PersistenceError>[0]): never {
  throw new P012PersistenceError(code);
}

function rawHostname(value: string): string {
  const protocolEnd = value.indexOf('://');
  const authorityEndCandidates = [
    value.indexOf('/', protocolEnd + 3),
    value.indexOf('?', protocolEnd + 3),
    value.indexOf('#', protocolEnd + 3),
  ].filter((index) => index >= 0);
  const authorityEnd =
    authorityEndCandidates.length === 0 ? value.length : Math.min(...authorityEndCandidates);
  const authority = value.slice(protocolEnd + 3, authorityEnd);
  const hostAndPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostAndPort.startsWith('[')) {
    const closingBracket = hostAndPort.indexOf(']');
    return closingBracket < 0 ? hostAndPort : hostAndPort.slice(0, closingBracket + 1);
  }
  const colon = hostAndPort.lastIndexOf(':');
  return colon < 0 ? hostAndPort : hostAndPort.slice(0, colon);
}

export function parseP012LoopbackDatabaseUrlForTestHarness(
  value: string,
): P012LoopbackDatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    sanitized('P012_PERSISTENCE_NOT_AUTHORIZED');
  }
  const hostname = parsed.hostname.toLowerCase();
  const suppliedHostname = rawHostname(value).toLowerCase();
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const port = parsed.port === '' ? 5432 : Number(parsed.port);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(hostname) ||
    suppliedHostname !== hostname ||
    !LOCAL_DATABASE.test(databaseName) ||
    parsed.pathname !== `/${encodeURIComponent(databaseName)}` ||
    port !== 5432 ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    sanitized('P012_PERSISTENCE_NOT_AUTHORIZED');
  }
  return Object.freeze({
    databaseName,
    hostname: hostname as P012LoopbackDatabaseTarget['hostname'],
    port: 5432,
  });
}

function stringField(row: QueryResultRow, key: string): string {
  const value: unknown = row[key];
  if (typeof value !== 'string') sanitized('P012_PERSISTENCE_RESULT_MISMATCH');
  return value;
}

function nullableStringField(row: QueryResultRow, key: string): string | null {
  const value: unknown = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') sanitized('P012_PERSISTENCE_RESULT_MISMATCH');
  return value;
}

function booleanField(row: QueryResultRow, key: string): boolean {
  const value: unknown = row[key];
  if (typeof value !== 'boolean') sanitized('P012_PERSISTENCE_RESULT_MISMATCH');
  return value;
}

function integerField(row: QueryResultRow, key: string): number {
  const value: unknown = row[key];
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9]\d*$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    sanitized('P012_PERSISTENCE_RESULT_MISMATCH');
  }
  return parsed;
}

function timestampField(row: QueryResultRow, key: string): string | null {
  const value: unknown = row[key];
  if (value === null) return null;
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (date === null || Number.isNaN(date.valueOf())) {
    sanitized('P012_PERSISTENCE_RESULT_MISMATCH');
  }
  return date.toISOString();
}

function assertActor(actor: P012ActorContext): void {
  if (
    !UUID.test(actor.appUserId) ||
    actor.authSubject.trim() === '' ||
    actor.requestId.trim() === '' ||
    actor.requestId.length > 200 ||
    actor.source !== 'import' ||
    (actor.justification !== null && actor.justification.length > 2000)
  ) {
    sanitized('P012_PERSISTENCE_NOT_AUTHORIZED');
  }
}

function assertScope(scope: P012SnapshotScope): void {
  const candidates = new Set<string>();
  const codes = new Set<string>();
  for (const project of scope.projects) {
    if (
      !/^project-[0-9a-f]{24}$/u.test(project.project_candidate_id) ||
      !PROJECT_CODE.test(project.project_code) ||
      (project.expected_id !== null && !UUID.test(project.expected_id)) ||
      candidates.has(project.project_candidate_id) ||
      codes.has(project.project_code)
    ) {
      sanitized('P012_PERSISTENCE_PLAN_MISMATCH');
    }
    candidates.add(project.project_candidate_id);
    codes.add(project.project_code);
  }
}

async function establishActor(
  client: Queryable,
  actor: P012ActorContext,
  setLocalRuntimeRoleForTests: boolean,
): Promise<void> {
  assertActor(actor);
  if (setLocalRuntimeRoleForTests) await client.query('set local role ltc_m_runtime');
  await client.query(
    `select ltc_m.set_actor_context(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, false
     )`,
    [actor.appUserId, actor.authSubject, actor.requestId, actor.justification, actor.source],
  );
  const authorization = await client.query(
    `select app_user_id::text as app_user_id, app_role::text as app_role
       from ltc_m.authorization_context()`,
  );
  const row = authorization.rows[0];
  if (
    authorization.rowCount !== 1 ||
    row === undefined ||
    row['app_user_id'] !== actor.appUserId ||
    row['app_role'] !== 'admin'
  ) {
    sanitized('P012_PERSISTENCE_NOT_AUTHORIZED');
  }
}

async function attestLocalDatabase(client: Queryable, expectedDatabaseName: string): Promise<void> {
  const result = await client.query(`select pg_catalog.current_database() as database_name`);
  const row = result.rows[0];
  if (result.rowCount !== 1 || row === undefined || row['database_name'] !== expectedDatabaseName) {
    sanitized('P012_PERSISTENCE_NOT_AUTHORIZED');
  }
}

function assertLoopbackPeer(client: PoolClient): void {
  const remoteAddress = (
    client as PoolClient & {
      connection?: { stream?: { remoteAddress?: unknown } };
    }
  ).connection?.stream?.remoteAddress;
  if (
    typeof remoteAddress !== 'string' ||
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress.toLowerCase())
  ) {
    sanitized('P012_PERSISTENCE_NOT_AUTHORIZED');
  }
}

function itemProjection(row: QueryResultRow): Record<string, unknown> {
  return {
    id: stringField(row, 'id'),
    project_id: stringField(row, 'project_id'),
    source_line_key: stringField(row, 'source_line_key'),
    line_number: integerField(row, 'line_number'),
    item_code: nullableStringField(row, 'item_code'),
    description: nullableStringField(row, 'description'),
    quantity: stringField(row, 'quantity'),
    unit_code: stringField(row, 'unit_code'),
    currency_code: stringField(row, 'currency_code'),
    unit_price: stringField(row, 'unit_price'),
    total_amount: stringField(row, 'total_amount'),
    active: booleanField(row, 'active'),
    deleted_at: timestampField(row, 'deleted_at'),
    row_version: integerField(row, 'row_version'),
  };
}

async function readSnapshot(
  client: Queryable,
  scope: P012SnapshotScope,
  lockRows: boolean,
): Promise<unknown> {
  assertScope(scope);
  const codes = scope.projects.map(({ project_code }) => project_code);
  const projectsResult =
    codes.length === 0
      ? { rows: [] as QueryResultRow[], rowCount: 0 }
      : await client.query(
          `select id::text as id, project_code, base_currency as currency_code,
                  status = 'active' as active, deleted_at
             from ltc_m.projects
            where project_code = any($1::text[])
              and deleted_at is null
            order by project_code collate "C", id${lockRows ? ' for share' : ''}`,
          [codes],
        );
  const scopeByCode = new Map(scope.projects.map((project) => [project.project_code, project]));
  const seenCodes = new Set<string>();
  const projects = projectsResult.rows.map((row) => {
    const projectCode = stringField(row, 'project_code');
    const expected = scopeByCode.get(projectCode);
    const id = stringField(row, 'id');
    if (
      expected === undefined ||
      seenCodes.has(projectCode) ||
      (expected.expected_id !== null && expected.expected_id !== id)
    ) {
      sanitized('P012_PERSISTENCE_SNAPSHOT_CHANGED');
    }
    seenCodes.add(projectCode);
    return {
      id,
      project_candidate_id: expected.project_candidate_id,
      project_code: projectCode,
      currency_code: stringField(row, 'currency_code'),
      active: booleanField(row, 'active'),
      deleted_at: timestampField(row, 'deleted_at'),
    };
  });
  for (const expected of scope.projects) {
    if (expected.expected_id !== null && !seenCodes.has(expected.project_code)) {
      sanitized('P012_PROJECT_TARGET_UNRESOLVED');
    }
  }
  const currenciesResult = await client.query(
    `select code, active
       from ltc_m.currencies
      order by code collate "C"`,
  );
  const unitsResult = await client.query(
    `select code, active
       from ltc_m.units
      where code = any($1::text[])
      order by code collate "C"`,
    [[...SUPPORTED_UNITS]],
  );
  const projectIds = projects.map(({ id }) => id);
  const itemsResult =
    projectIds.length === 0
      ? { rows: [] as QueryResultRow[], rowCount: 0 }
      : await client.query(
          `select id::text as id, project_id::text as project_id, source_line_key,
                  line_number, item_code, description, quantity::text as quantity,
                  unit_code, currency_code, unit_price::text as unit_price,
                  total_amount::text as total_amount, active, deleted_at,
                  row_version::text as row_version
             from ltc_m.project_items
            where project_id = any($1::uuid[])
            order by project_id, source_line_key collate "C", id${lockRows ? ' for share' : ''}`,
          [projectIds],
        );
  return {
    contract: 'ltcm.p012.existing-items-snapshot.v1',
    currencies: currenciesResult.rows.map((row) => ({
      code: stringField(row, 'code'),
      active: booleanField(row, 'active'),
    })),
    units: unitsResult.rows.map((row) => ({
      code: stringField(row, 'code'),
      active: booleanField(row, 'active'),
    })),
    projects,
    items: itemsResult.rows.map(itemProjection),
  };
}

class PostgresP012Transaction implements P012PersistenceTransaction {
  constructor(private readonly client: PoolClient) {}

  async acquireProjectLocks(projectIds: string[]): Promise<void> {
    const canonical = [...new Set(projectIds)].sort((left, right) =>
      left.localeCompare(right, 'en'),
    );
    if (
      canonical.length !== projectIds.length ||
      canonical.some((projectId) => !UUID.test(projectId))
    ) {
      sanitized('P012_PERSISTENCE_PLAN_MISMATCH');
    }
    for (const projectId of canonical) {
      await this.client.query(
        `select pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended($1::text, 0)
         )`,
        [`${PROJECT_LOCK_NAMESPACE}${projectId}`],
      );
    }
  }

  async readExistingItemsSnapshot(scope: P012SnapshotScope): Promise<unknown> {
    return readSnapshot(this.client, scope, true);
  }

  async validateBatchAndStaging(plan: P012PersistencePlan): Promise<P012StagingRecord[]> {
    const batchResult = await this.client.query(
      `select id::text as id, idempotency_key, source_hash, status::text as status
         from ltc_m.import_batches
        where id = $1::uuid
        for share`,
      [plan.batch.id],
    );
    const batch = batchResult.rows[0];
    if (
      batchResult.rowCount !== 1 ||
      batch === undefined ||
      batch['idempotency_key'] !== plan.batch.idempotency_key ||
      batch['source_hash'] !== plan.batch.source_hash ||
      !['received', 'validating', 'loaded'].includes(String(batch['status']))
    ) {
      sanitized('P012_PERSISTENCE_STAGING_MISMATCH');
    }
    if (plan.operations.length === 0) return [];
    const sourceRows = plan.operations.map(({ staging }) => staging.source_row_number);
    if (new Set(sourceRows).size !== sourceRows.length) {
      sanitized('P012_PERSISTENCE_PLAN_MISMATCH');
    }
    const rowsResult = await this.client.query(
      `select staging.id::text as staging_row_id,
              staging.source_row_number,
              staging.row_hash,
              staging.target_table,
              staging.target_record_id::text as target_record_id
         from ltc_m.import_batch_sheets as sheets
         join ltc_m.import_staging_rows as staging
           on staging.import_batch_sheet_id = sheets.id
        where sheets.import_batch_id = $1::uuid
          and sheets.sheet_key = 'monthly_revenue'
          and staging.source_row_number = any($2::integer[])
        order by staging.source_row_number
        for share of staging`,
      [plan.batch.id, sourceRows],
    );
    const operationByRow = new Map(
      plan.operations.map((operation) => [operation.staging.source_row_number, operation]),
    );
    const records = rowsResult.rows.map((row) => {
      const sourceRow = integerField(row, 'source_row_number');
      const operation = operationByRow.get(sourceRow);
      const targetTable = nullableStringField(row, 'target_table');
      const targetRecordId = nullableStringField(row, 'target_record_id');
      if (
        operation === undefined ||
        stringField(row, 'row_hash') !== operation.staging.row_hash ||
        (targetTable === null) !== (targetRecordId === null) ||
        (targetTable !== null &&
          (targetTable !== 'project_items' ||
            operation.expected_target_id === null ||
            targetRecordId !== operation.expected_target_id))
      ) {
        sanitized('P012_PERSISTENCE_STAGING_MISMATCH');
      }
      return {
        candidate_id: operation.candidate_id,
        staging_row_id: stringField(row, 'staging_row_id'),
        target_table: targetTable,
        target_record_id: targetRecordId,
      };
    });
    if (records.length !== plan.operations.length) {
      sanitized('P012_PERSISTENCE_STAGING_MISMATCH');
    }
    return records;
  }

  async insertItem(operation: P012PersistenceOperation): Promise<unknown> {
    const result = await this.client.query(
      `insert into ltc_m.project_items
         (project_id, source_line_key, line_number, item_code, description,
          quantity, unit_code, currency_code, unit_price, active, notes)
       values
         ($1::uuid, $2::text, $3::integer, $4::text, $5::text,
          $6::numeric, $7::text, $8::text, $9::numeric, true, null)
       returning id::text as id, project_id::text as project_id, source_line_key,
                 line_number, item_code, description, quantity::text as quantity,
                 unit_code, currency_code, unit_price::text as unit_price,
                 total_amount::text as total_amount, active, deleted_at,
                 row_version::text as row_version`,
      [
        operation.project_id,
        operation.source_line_key,
        operation.line_number,
        operation.item_code,
        operation.description,
        operation.quantity,
        operation.unit_code,
        operation.currency_code,
        operation.unit_price,
      ],
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined) {
      sanitized('P012_PERSISTENCE_RESULT_MISMATCH');
    }
    return itemProjection(row);
  }

  async linkStaging(stagingRowId: string, itemId: string): Promise<void> {
    if (!UUID.test(stagingRowId) || !UUID.test(itemId)) {
      sanitized('P012_PERSISTENCE_STAGING_MISMATCH');
    }
    await this.client.query(
      `update ltc_m.import_staging_rows
          set target_table = 'project_items', target_record_id = $2::uuid
        where id = $1::uuid
          and target_table is null
          and target_record_id is null`,
      [stagingRowId, itemId],
    );
    const result = await this.client.query(
      `select target_table, target_record_id::text as target_record_id
         from ltc_m.import_staging_rows
        where id = $1::uuid`,
      [stagingRowId],
    );
    const row = result.rows[0];
    if (
      result.rowCount !== 1 ||
      row === undefined ||
      row['target_table'] !== 'project_items' ||
      row['target_record_id'] !== itemId
    ) {
      sanitized('P012_PERSISTENCE_STAGING_MISMATCH');
    }
  }
}

class PostgresP012PersistenceAdapter implements P012PersistencePort {
  private readonly pool: Pool;
  private readonly environment: P012LogicalEnvironment;
  private readonly writeAuthorized: boolean;
  private readonly expectedDatabaseName: string | null;
  private readonly setLocalRuntimeRoleForTests: boolean;

  constructor(options: P012PostgresAdapterOptions) {
    this.pool = options.pool;
    this.environment = options.environment;
    const authorization = AUTHORIZED_TEST_POOLS.get(options.pool);
    this.writeAuthorized = authorization?.environment === options.environment;
    this.expectedDatabaseName = this.writeAuthorized ? (authorization?.databaseName ?? null) : null;
    this.setLocalRuntimeRoleForTests = options.setLocalRuntimeRoleForTests === true;
  }

  async readExistingItemsSnapshot(
    scope: P012SnapshotScope,
    actor: P012ActorContext,
  ): Promise<unknown> {
    if (!this.writeAuthorized || this.expectedDatabaseName === null) {
      sanitized('P012_PERSISTENCE_NOT_AUTHORIZED');
    }
    const client = await this.pool.connect();
    try {
      assertLoopbackPeer(client);
      await client.query('begin isolation level repeatable read read only');
      await attestLocalDatabase(client, this.expectedDatabaseName);
      await establishActor(client, actor, this.setLocalRuntimeRoleForTests);
      const snapshot = await readSnapshot(client, scope, false);
      await client.query('commit');
      return snapshot;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (error instanceof P012PersistenceError) throw error;
      throw new P012PersistenceError('P012_PERSISTENCE_TRANSACTION_FAILED');
    } finally {
      client.release();
    }
  }

  async serializableTransaction<T>(
    environment: P012LogicalEnvironment,
    actor: P012ActorContext,
    work: (transaction: P012PersistenceTransaction) => Promise<T>,
  ): Promise<T> {
    if (
      !this.writeAuthorized ||
      this.expectedDatabaseName === null ||
      environment !== this.environment
    ) {
      sanitized('P012_PERSISTENCE_NOT_AUTHORIZED');
    }
    const client = await this.pool.connect();
    try {
      assertLoopbackPeer(client);
      await client.query('begin isolation level serializable');
      await attestLocalDatabase(client, this.expectedDatabaseName);
      await establishActor(client, actor, this.setLocalRuntimeRoleForTests);
      const result = await work(new PostgresP012Transaction(client));
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createP012PostgresTestHarness(
  environment: P012LogicalEnvironment,
  databaseUrl: string,
  options: { setLocalRuntimeRoleForTests?: boolean } = {},
): P012PostgresTestHarness {
  const target = parseP012LoopbackDatabaseUrlForTestHarness(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  AUTHORIZED_TEST_POOLS.set(pool, { environment, databaseName: target.databaseName });
  const adapter = new PostgresP012PersistenceAdapter({
    environment,
    pool,
    setLocalRuntimeRoleForTests: options.setLocalRuntimeRoleForTests === true,
  });
  let closed = false;
  return Object.freeze({
    adapter,
    async close() {
      if (closed) return;
      closed = true;
      AUTHORIZED_TEST_POOLS.delete(pool);
      await pool.end();
    },
  });
}

export const P012_PROJECT_LOCK_ALGORITHM =
  "pg_advisory_xact_lock(hashtextextended('ltc_m.p012.project:' || project_uuid, 0))";
