import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseOptions,
  parseMigrationList,
  renderComprehensiveP008,
  renderScenario,
  validateHarnessSources,
} from './run-p008-dynamic-validation.mjs';

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
  assert.deepEqual(parseOptions(['--check']), { check: true, dryRun: false, runId: null });
  assert.throws(() => parseOptions(['--check', '--dry-run']));
  assert.throws(() => parseOptions(['--run-id', '../escape']));
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
