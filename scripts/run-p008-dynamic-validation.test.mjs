import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertValidP009Aliases,
  parseOptions,
  parseMigrationList,
  renderComprehensiveP008,
  renderComprehensiveP009,
  renderScenario,
  validateHarnessSources,
} from './run-p008-dynamic-validation.mjs';
import {
  p009ScenarioRequestId,
  renderComprehensiveP009 as renderP009WithContexts,
  validateP009ScenarioSource,
  validateRequestAuditTrace,
} from './sql-rendering.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('aceita o harness oficial D26/D27 e os hashes das migrations aplicadas', () => {
  assert.deepEqual(validateHarnessSources(rootDirectory), []);
});

test('renderiza identificadores exclusivos sem deixar placeholders', () => {
  const rendered = renderScenario(
    "select '{{UUID_PREFIX}}001', 'p008-{{RUN_TOKEN}}|viewer';",
    'r20260731-test',
  );
  assert.doesNotMatch(rendered, /\{\{/u);
  assert.match(rendered, /p008-r20260731-test\|viewer/u);
  assert.match(rendered, /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}/u);
});

test('renderiza a suíte abrangente sem alterar a estrutura transacional', () => {
  const rendered = renderComprehensiveP008(
    "begin; select '00000000-0000-4000-8000-000000008001', 'p008-viewer', 'P008'; rollback;",
    'r20260731-test',
  );
  assert.match(rendered, /^begin;/u);
  assert.match(rendered, /rollback;$/u);
  assert.doesNotMatch(rendered, /00000000-0000-4000-8000-000000008/u);
});

test('valida argumentos sem aceitar modos ou run IDs ambíguos', () => {
  assert.deepEqual(parseOptions(['--check']), {
    check: true,
    dryRun: false,
    worker: false,
    runId: null,
    artifactDirectory: null,
  });
  assert.throws(() => parseOptions(['--check', '--dry-run']));
  assert.throws(() => parseOptions(['--run-id', '../escape']));
  assert.throws(() => parseOptions(['--worker']));
  assert.deepEqual(parseOptions(['--worker', '--artifact-directory', '.tmp/evidence']), {
    check: false,
    dryRun: false,
    worker: true,
    runId: null,
    artifactDirectory: '.tmp/evidence',
  });
  assert.throws(() => parseOptions(['--unknown']));
});

test('interpreta a saída JSON atual da lista de migrations', () => {
  assert.deepEqual(
    parseMigrationList(
      '{"migrations":[{"local":"20260731103001","remote":"20260731103001"}],"message":"ok"}',
    ),
    [{ local: '20260731103001', remote: '20260731103001' }],
  );
  assert.throws(() => parseMigrationList('sem json'));
});

test('renderiza fixtures P009 sem alterar aliases SQL', () => {
  const rendered = renderComprehensiveP009(
    "select '00000000-0000-4000-8000-000000009001', 'p009|viewer' as p009_rejection_partial_integrity, 'P009 Viewer';",
    'r20260803-test',
  );
  assert.doesNotMatch(rendered, /00000000-0000-4000-8000-000000009/u);
  assert.match(rendered, /'p009-r20260803-test\|viewer'/u);
  assert.match(rendered, /as p009_rejection_partial_integrity/u);
  assert.match(rendered, /'P009-r20260803-test Viewer'/u);
});

test('rejeita alias P009 renderizado com caractere invalido', () => {
  assert.throws(
    () => assertValidP009Aliases('select true as p009-rejection-partial-integrity;'),
    /alias SQL P009 renderizado invalido: p009-rejection-partial-integrity/u,
  );
});

test('renderiza as duas conexoes D23 com identidades administrativas distintas', () => {
  const source = fs.readFileSync(
    new URL('../database/audit/p008-runtime/connection-d23-concurrency.sql', import.meta.url),
    'utf8',
  );
  const first = renderScenario(source, 'r20260731-d23-a');
  const second = renderScenario(source, 'r20260731-d23-b');

  assert.match(source, /session_user\s*<>\s*'postgres'/u);
  assert.match(source, /current_user\s*<>\s*'ltc_m_runtime'/u);
  assert.match(source, /set_actor_context\(/u);
  assert.doesNotMatch(first, /\{\{/u);
  assert.doesNotMatch(second, /\{\{/u);
  assert.notEqual(first, second);
});

test('mantem a Fase A antes da Fase B e bloqueia B sem phase_a_passed', () => {
  const source = fs.readFileSync(
    new URL('./run-p008-dynamic-validation.mjs', import.meta.url),
    'utf8',
  );
  const phaseA = source.indexOf("await executeStage(report, 'p009_phase_a_bootstrap'");
  const phaseB = source.indexOf("await continueStage('p009_full_validation'");

  assert.ok(phaseA >= 0);
  assert.ok(phaseB > phaseA);
  assert.match(
    source,
    /assertCondition\(phaseAPassed, 'Fase A não produziu phase_a_passed=true'\)/u,
  );
  assert.match(
    source,
    /'Parcialmente concluída — validação final P009 falhou, estado remoto limpo'/u,
  );
  assert.match(source, /'Falha crítica — resíduo ou delta após D33'/u);
});

test('valida dois request IDs distintos na sequencia contexto DML auditoria', () => {
  const requestA = p009ScenarioRequestId('r20260803-d32-test', 'batch:create');
  const requestB = p009ScenarioRequestId('r20260803-d32-test', 'sheet:create');

  assert.notEqual(requestA, requestB);
  assert.equal(
    validateRequestAuditTrace([
      { type: 'begin', connection: 'a' },
      { type: 'set-context', connection: 'a', requestId: requestA },
      { type: 'dml', connection: 'a', scenario: 'batch:create' },
      {
        type: 'audit',
        connection: 'a',
        scenario: 'batch:create',
        expectedRequestId: requestA,
        auditedRequestId: requestA,
      },
      { type: 'set-context', connection: 'a', requestId: requestB },
      { type: 'dml', connection: 'a', scenario: 'sheet:create' },
      {
        type: 'audit',
        connection: 'a',
        scenario: 'sheet:create',
        expectedRequestId: requestB,
        auditedRequestId: requestB,
      },
      { type: 'rollback', connection: 'a' },
    ]),
    true,
  );
});

test('rejeita expectativa divergente e DML sem contexto', () => {
  assert.throws(
    () =>
      validateRequestAuditTrace([
        { type: 'begin', connection: 'a' },
        { type: 'set-context', connection: 'a', requestId: 'request-a' },
        { type: 'dml', connection: 'a', scenario: 'batch:create' },
        {
          type: 'audit',
          connection: 'a',
          scenario: 'batch:create',
          expectedRequestId: 'request-b',
          auditedRequestId: 'request-a',
        },
      ]),
    /expectativa diverge do contexto/u,
  );
  assert.throws(
    () =>
      validateRequestAuditTrace([
        { type: 'begin', connection: 'a' },
        { type: 'dml', connection: 'a', scenario: 'batch:create' },
      ]),
    /DML sem request no contexto/u,
  );
});

test('impede vazamento após rollback e entre conexões', () => {
  assert.throws(
    () =>
      validateRequestAuditTrace([
        { type: 'begin', connection: 'a' },
        { type: 'set-context', connection: 'a', requestId: 'request-a' },
        { type: 'rollback', connection: 'a' },
        { type: 'begin', connection: 'a' },
        { type: 'dml', connection: 'a', scenario: 'sheet:create' },
      ]),
    /DML sem request no contexto/u,
  );
  assert.throws(
    () =>
      validateRequestAuditTrace([
        { type: 'begin', connection: 'a' },
        { type: 'set-context', connection: 'a', requestId: 'request-a' },
        { type: 'begin', connection: 'b' },
        { type: 'dml', connection: 'b', scenario: 'sheet:create' },
      ]),
    /DML sem request no contexto/u,
  );
});

test('usa o contexto mais recente antes do DML e não o setup anterior', () => {
  assert.equal(
    validateRequestAuditTrace([
      { type: 'begin', connection: 'a' },
      { type: 'set-context', connection: 'a', requestId: 'request-setup' },
      { type: 'set-context', connection: 'a', requestId: 'request-scenario' },
      { type: 'dml', connection: 'a', scenario: 'batch:update' },
      {
        type: 'audit',
        connection: 'a',
        scenario: 'batch:update',
        expectedRequestId: 'request-scenario',
        auditedRequestId: 'request-scenario',
      },
      { type: 'rollback', connection: 'a' },
    ]),
    true,
  );
});

test('gate de fluxo rejeita expectativa que não corresponde ao cenário configurado', () => {
  const valid = `
-- @p009-context request-a editor
-- @p009-dml request-a
select true;
-- @p009-after-dml request-a
-- @p009-audit request-a {{P009_REQUEST:request-a}}
select true;
-- @p009-context request-b editor
-- @p009-dml request-b
select true;
-- @p009-after-dml request-b
-- @p009-audit request-b {{P009_REQUEST:request-b}}
select true;
`;
  assert.deepEqual(validateP009ScenarioSource(valid, ['request-a', 'request-b']).audits, [
    'request-a',
    'request-b',
  ]);
  assert.throws(
    () =>
      validateP009ScenarioSource(
        valid.replace(
          '@p009-audit request-a {{P009_REQUEST:request-a}}',
          '@p009-audit request-a {{P009_REQUEST:request-b}}',
        ),
        ['request-a', 'request-b'],
      ),
    /expectativa de request divergente/u,
  );
});

test('suite P009 renderizada configura e confirma todos os contextos D32', () => {
  const source = fs.readFileSync(
    new URL('../database/audit/ltcm-p009-staging-tests.sql', import.meta.url),
    'utf8',
  );
  const rendered = renderP009WithContexts(source, 'r20260803-d32-test');
  const requests = [
    ...rendered.matchAll(/-- p009-context \S+ (r20260803-d32-test:p009:\S+)/gu),
  ].map((match) => match[1]);

  assert.equal(new Set(requests).size, 13);
  assert.equal(requests.length, 13);
  assert.equal((source.match(/@p009-after-dml /gu) ?? []).length, 13);
  assert.doesNotMatch(rendered, /p009-request-setup|\{\{P009_REQUEST:/u);
  assert.match(rendered, /request_contract/u);
  assert.match(rendered, /as p009_terminal_evidence/u);
  assert.doesNotMatch(rendered, /p009-[^'|]+-p009-[^'|]+\|(?:viewer|editor|admin)/u);
});
