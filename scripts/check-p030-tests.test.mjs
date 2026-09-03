import assert from 'node:assert/strict';
import test from 'node:test';

import { checkP030, scanP030Sources } from './check-p030-tests.mjs';

test('aceita os artefatos P030 completos', async () => {
  assert.deepEqual(await checkP030(), []);
});

test('rejeita capability de override fora do admin', () => {
  const issues = scanP030Sources({
    types: 'ltcm.p030.balance-distribution-validations.v1 contractValue',
    service:
      "readFinancialSummary financial_actual_events status = 'posted' financial_plan_lines versionStatus actorTransaction parseFinancialCents P030_BALANCE_OVERRIDE_REQUIRED P030_CURRENCY_MISMATCH content_revision payload.justification",
    financial: 'contractValue - actualPosted - plannedDraft rawBalance < 0n',
    controller: 'forecast:override_balance',
    auth: 'editor: [\n  forecast:override_balance\n],\nadmin: [\n  data:read\n],',
    web: 'distributeBalance P030_PERCENT_TOTAL BigInt P030_MAX_DESTINATIONS addDistributionToValues itemId.localeCompare',
    page: 'selectedCells Distribuir saldo',
    financialTests: "excess.rawBalance, '-100.00'",
    webTests: '33.3333',
    authTests: 'forecast:override_balance',
    apiTests: 'P030 bloqueia excesso',
    postgres: 'P030 PostgreSQL unchanged',
    documentation:
      'P030-D01-DEC-01 P030-D01-DEC-02 P030-D01-DEC-03 P030-D01-DEC-04 P030-D01-DEC-05 P030_CURRENCY_MISMATCH',
    migrationFiles: [],
  });
  assert.ok(issues.includes('override não está restrito ao admin'));
  assert.ok(issues.includes('editor recebeu override indevido'));
});
