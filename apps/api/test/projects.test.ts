import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ProjectsService } from '../src/projects/projects.service.js';
import { parseProjectId, parseProjectPortfolioQuery } from '../src/projects/projects.types.js';

const actor = Object.freeze({
  appUserId: '00000000-0000-4000-8000-000000023001',
  authSubject: 'auth0|p023-viewer',
  requestId: 'p023-request',
  source: 'api' as const,
});

const portfolioRow = {
  project_id: '00000000-0000-4000-8000-000000023101',
  project_code: 'P-023-001',
  client_name: 'Cliente P023',
  project_status: 'active',
  currency_code: 'BRL',
  contract_value: '1000.00',
  unscheduled_balance: '250.00',
  unscheduled_balance_status: 'available',
  updated_at: '2026-08-31T12:00:00.000Z',
  alert_count: 1,
  alerts_summary: 'PROJECT_VALUE_MISMATCH',
  total_items: '3',
};

test('P023 valida parâmetros, defaults e rejeita query arbitrária', () => {
  assert.deepEqual(parseProjectPortfolioQuery({}), {
    sort: 'code',
    order: 'asc',
    page: 1,
    pageSize: 25,
  });
  assert.deepEqual(
    parseProjectPortfolioQuery({
      search: '  cliente  ',
      status: 'active',
      sort: 'unscheduledBalance',
      order: 'desc',
      page: '2',
      pageSize: '50',
    }),
    {
      search: 'cliente',
      status: 'active',
      sort: 'unscheduledBalance',
      order: 'desc',
      page: 2,
      pageSize: 50,
    },
  );
  assert.throws(
    () => parseProjectPortfolioQuery({ sql: 'drop table projects' }),
    (error: unknown) => error instanceof BadRequestException,
  );
  assert.throws(
    () => parseProjectPortfolioQuery({ pageSize: '101' }),
    (error: unknown) => error instanceof BadRequestException,
  );
  assert.throws(
    () => parseProjectId('not-a-uuid'),
    (error: unknown) => error instanceof BadRequestException,
  );
});

test('P023 lista uma linha por projeto com SQL parametrizado, escape e ordenação determinística', async () => {
  let sql = '';
  let values: readonly unknown[] = [];
  const database = {
    actorTransaction: async <T>(
      receivedActor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<T>,
    ) => {
      assert.deepEqual(receivedActor, actor);
      return operation({
        query: async <Row>(text: string, receivedValues?: readonly unknown[]) => {
          sql = text;
          values = receivedValues ?? [];
          return { rows: [portfolioRow as Row] };
        },
      });
    },
  };
  const service = new ProjectsService(database as never);

  const response = await service.list(
    {
      search: '50%_\\',
      status: 'active',
      sort: 'unscheduledBalance',
      order: 'desc',
      page: 2,
      pageSize: 25,
    },
    actor,
  );

  assert.equal(response.contract, 'ltcm.p023.project-portfolio-list.v1');
  assert.equal(response.totalItems, 3);
  assert.equal(response.totalPages, 1);
  assert.equal(response.items[0]?.unscheduledBalance, '250.00');
  assert.match(sql, /ilike \$1 escape E'\\\\'/u);
  assert.match(sql, /official_plan_count = 1/u);
  assert.match(sql, /greatest\(/u);
  assert.match(sql, /order by unscheduled_balance desc nulls last, project_id asc/u);
  assert.deepEqual(values, ['%50\\%\\_\\\\%', 'active', 25, 25]);
  assert.doesNotMatch(sql, /\$\{(sort|order|search)\}/u);
});

test('P023 detalhe é somente leitura e falha fechado quando não encontra projeto visível', async () => {
  let calls = 0;
  const database = {
    actorTransaction: async <T>(
      _receivedActor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<T>,
    ) =>
      operation({
        query: async <Row>() => {
          calls += 1;
          return {
            rows: [
              {
                project_id: '00000000-0000-4000-8000-000000023101',
                project_code: 'P-023-001',
                project_name: 'Projeto P023',
                client_name: 'Cliente P023',
                project_status: 'active',
                currency_code: 'BRL',
                contract_value: '1000.00',
                updated_at: '2026-08-31T12:00:00.000Z',
              } as Row,
            ],
          };
        },
      }),
  };
  const service = new ProjectsService(database as never);
  const detail = await service.getById('00000000-0000-4000-8000-000000023101', actor);
  assert.equal(detail.name, 'Projeto P023');
  assert.equal(detail.contract, 'ltcm.p023.project-portfolio-list.v1');
  assert.equal(calls, 1);

  const missingDatabase = {
    actorTransaction: async <T>(
      _receivedActor: typeof actor,
      operation: (client: {
        query: <Row>(text: string, values?: readonly unknown[]) => Promise<{ rows: Row[] }>;
      }) => Promise<T>,
    ) => operation({ query: async <Row>() => ({ rows: [] as Row[] }) }),
  };
  await assert.rejects(
    new ProjectsService(missingDatabase as never).getById(
      '00000000-0000-4000-8000-000000023199',
      actor,
    ),
    (error: unknown) => error instanceof NotFoundException,
  );
});
