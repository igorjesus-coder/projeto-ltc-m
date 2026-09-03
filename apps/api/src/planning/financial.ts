import type { PlanningFinancialSummary } from './planning.types.js';

export function parseFinancialCents(value: string): bigint {
  if (!/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/u.test(value)) {
    throw new Error('P030_FINANCIAL_VALUE_INVALID');
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ''] = unsigned.split('.');
  const result = BigInt(integer ?? '0') * 100n + BigInt((fraction ?? '').padEnd(2, '0'));
  return negative ? -result : result;
}

export function formatFinancialCents(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function calculateFinancialSummary(
  contractValueText: string,
  actualPostedText: string,
  plannedDraftText: string,
  currency: string,
  canOverrideBalance: boolean,
): PlanningFinancialSummary {
  const contractValue = parseFinancialCents(contractValueText);
  const actualPosted = parseFinancialCents(actualPostedText);
  const plannedDraft = parseFinancialCents(plannedDraftText);
  const rawBalance = contractValue - actualPosted - plannedDraft;
  const nonNegativeBalance = rawBalance > 0n ? rawBalance : 0n;
  return {
    contractValue: formatFinancialCents(contractValue),
    actualPosted: formatFinancialCents(actualPosted),
    plannedDraft: formatFinancialCents(plannedDraft),
    rawBalance: formatFinancialCents(rawBalance),
    distributableBalance: formatFinancialCents(nonNegativeBalance),
    unplannedBalance: formatFinancialCents(nonNegativeBalance),
    hasExcess: rawBalance < 0n,
    currency,
    canOverrideBalance,
  };
}
