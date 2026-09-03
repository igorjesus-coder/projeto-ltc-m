import assert from 'node:assert/strict';
import test from 'node:test';

import { checkP029, scanP029Sources } from './check-p029-tests.mjs';

test('aceita os artefatos P029 completos', async () => {
  assert.deepEqual(await checkP029(), []);
});

test('rejeita a remoção do guard de escrita', async () => {
  const issues = await scanP029Sources({
    types: 'ltcm.p029.monthly-planning-editor.v1',
    controller: 'PUT',
    service: 'actorTransaction for update on conflict insert into ltc_m.financial_plan_lines',
    page: 'MonthlyPlanningPage',
    webTypes: 'BigInt',
    apiTests: 'P029 save envia vários meses',
    webTests: 'decimais sem erro binário',
    documentation: 'P029 — editor de programação mensal',
    migrationFiles: [],
  });
  assert.ok(issues.includes('capability guard ausente'));
});
