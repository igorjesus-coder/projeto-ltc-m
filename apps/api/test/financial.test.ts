import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateFinancialSummary,
  formatFinancialCents,
  parseFinancialCents,
} from '../src/planning/financial.js';

test('P030 calcula saldo bruto e saldo distribuível sem truncar excesso', () => {
  assert.deepEqual(calculateFinancialSummary('1000.00', '200.00', '300.00', 'BRL', false), {
    contractValue: '1000.00',
    actualPosted: '200.00',
    plannedDraft: '300.00',
    rawBalance: '500.00',
    distributableBalance: '500.00',
    unplannedBalance: '500.00',
    hasExcess: false,
    currency: 'BRL',
    canOverrideBalance: false,
  });
  assert.equal(calculateFinancialSummary('1000', '200', '800', 'BRL', false).rawBalance, '0.00');
  const excess = calculateFinancialSummary('1000', '200', '900', 'BRL', false);
  assert.equal(excess.rawBalance, '-100.00');
  assert.equal(excess.distributableBalance, '0.00');
  assert.equal(excess.hasExcess, true);
});

test('P030 usa somente centavos inteiros para valores financeiros', () => {
  assert.equal(
    formatFinancialCents(parseFinancialCents('0.01') + parseFinancialCents('0.02')),
    '0.03',
  );
  assert.equal(formatFinancialCents(parseFinancialCents('-100.00')), '-100.00');
  assert.throws(() => parseFinancialCents('1.001'), /P030_FINANCIAL_VALUE_INVALID/u);
});
