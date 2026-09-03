import { describe, expect, it } from 'vitest';

import {
  addDistributionToValues,
  buildPlanningEntries,
  decimalToCents,
  distributeBalance,
  formatCents,
  parsePercentage,
  parsePlanningEditorResponse,
  planningCellKey,
} from './planning';

describe('contrato P029 de planejamento', () => {
  it('calcula decimais sem erro binário', () => {
    const value = (decimalToCents('0.1') ?? 0n) + (decimalToCents('0.2') ?? 0n);
    expect(formatCents(value)).toBe('0.30');
  });

  it('preserva a virada de ano na ordem canônica', () => {
    const response = parsePlanningEditorResponse({
      contract: 'ltcm.p029.monthly-planning-editor.v1',
      project: {
        projectId: 'p',
        code: 'P',
        name: 'Projeto',
        currencyCode: 'BRL',
        status: 'active',
      },
      version: {
        versionId: 'v',
        name: 'V1',
        status: 'draft',
        rowVersion: 1,
        contentRevision: 1,
        editable: true,
        isBaseline: false,
      },
      competences: [
        { value: '2026-12-01', label: '12/2026' },
        { value: '2027-01-01', label: '01/2027' },
      ],
      items: [],
      entries: [],
      projectTotals: [],
      financial: {
        contractValue: '100.00',
        actualPosted: '0.00',
        plannedDraft: '0.00',
        rawBalance: '100.00',
        distributableBalance: '100.00',
        unplannedBalance: '100.00',
        hasExcess: false,
        currency: 'BRL',
        canOverrideBalance: false,
      },
      range: { from: '2026-12-01', to: '2027-01-01' },
    });
    expect(response.competences.map((item) => item.value)).toEqual(['2026-12-01', '2027-01-01']);
  });

  it('monta um batch com alterações de vários itens e competências', () => {
    const response = parsePlanningEditorResponse({
      contract: 'ltcm.p029.monthly-planning-editor.v1',
      project: {
        projectId: 'p',
        code: 'P',
        name: 'Projeto',
        currencyCode: 'BRL',
        status: 'active',
      },
      version: {
        versionId: 'v',
        name: 'V1',
        status: 'draft',
        rowVersion: 1,
        contentRevision: 1,
        editable: true,
        isBaseline: false,
      },
      competences: [
        { value: '2026-12-01', label: '12/2026' },
        { value: '2027-01-01', label: '01/2027' },
      ],
      items: [
        {
          itemId: 'item-a',
          sourceLineKey: 'line-a',
          itemCode: 'A',
          description: 'Item A',
          lineNumber: 1,
          active: true,
        },
        {
          itemId: 'item-b',
          sourceLineKey: 'line-b',
          itemCode: 'B',
          description: 'Item B',
          lineNumber: 2,
          active: true,
        },
      ],
      entries: [],
      projectTotals: [],
      financial: {
        contractValue: '100.00',
        actualPosted: '0.00',
        plannedDraft: '10.00',
        rawBalance: '90.00',
        distributableBalance: '90.00',
        unplannedBalance: '90.00',
        hasExcess: false,
        currency: 'BRL',
        canOverrideBalance: false,
      },
      range: { from: '2026-12-01', to: '2027-01-01' },
    });
    const original = {
      [planningCellKey('item-a', '2026-12-01')]: '1.00',
      [planningCellKey('item-a', '2027-01-01')]: '2.00',
      [planningCellKey('item-b', '2026-12-01')]: '3.00',
      [planningCellKey('item-b', '2027-01-01')]: '4.00',
    };
    const values = {
      ...original,
      [planningCellKey('item-a', '2026-12-01')]: '2',
      [planningCellKey('item-b', '2027-01-01')]: '5.5',
    };
    expect(buildPlanningEntries(response, values, original)).toEqual([
      { itemId: 'item-a', competence: '2026-12-01', amount: '2.00' },
      { itemId: 'item-b', competence: '2027-01-01', amount: '5.50' },
    ]);
  });

  it('distribui 100,00 em centavos com residual e ordem independente da entrada', () => {
    expect(
      distributeBalance(10_000n, [
        { itemId: 'item-b', competence: '2027-01-01', weight: '33.3333' },
        { itemId: 'item-a', competence: '2026-12-01', weight: '33.3333' },
        { itemId: 'item-c', competence: '2027-01-01', weight: '33.3334' },
      ]),
    ).toEqual([
      { itemId: 'item-a', competence: '2026-12-01', amount: '33.34' },
      { itemId: 'item-b', competence: '2027-01-01', amount: '33.33' },
      { itemId: 'item-c', competence: '2027-01-01', amount: '33.33' },
    ]);
  });

  it('valida pesos exatos e respeita pesos diferentes', () => {
    expect(
      distributeBalance(10_000n, [
        { itemId: 'a', competence: '2026-12-01', weight: '50' },
        { itemId: 'b', competence: '2026-12-01', weight: '30' },
        { itemId: 'c', competence: '2026-12-01', weight: '20' },
      ]),
    ).toEqual([
      { itemId: 'a', competence: '2026-12-01', amount: '50.00' },
      { itemId: 'b', competence: '2026-12-01', amount: '30.00' },
      { itemId: 'c', competence: '2026-12-01', amount: '20.00' },
    ]);
    expect(parsePercentage('NaN')).toBeNull();
    expect(parsePercentage('Infinity')).toBeNull();
    expect(parsePercentage('-1')).toBeNull();
    expect(parsePercentage('')).toBeNull();
    expect(parsePercentage('100.01')).toBeNull();
    expect(() =>
      distributeBalance(100n, [{ itemId: 'a', competence: '2026-12-01', weight: '99.99' }]),
    ).toThrow('P030_PERCENT_TOTAL_INVALID');
    expect(
      distributeBalance(10_000n, [{ itemId: 'a', competence: '2026-12-01', weight: '100' }]),
    ).toEqual([{ itemId: 'a', competence: '2026-12-01', amount: '100.00' }]);
    expect(
      distributeBalance(1n, [
        { itemId: 'a', competence: '2026-12-01', weight: '50' },
        { itemId: 'b', competence: '2026-12-01', weight: '50' },
      ]),
    ).toEqual([
      { itemId: 'a', competence: '2026-12-01', amount: '0.01' },
      { itemId: 'b', competence: '2026-12-01', amount: '0.00' },
    ]);
    expect(() =>
      distributeBalance(100n, [
        { itemId: 'a', competence: '2026-12-01', weight: '50' },
        { itemId: 'a', competence: '2026-12-01', weight: '50' },
      ]),
    ).toThrow('P030_DISTRIBUTION_DUPLICATE_DESTINATION');
    expect(
      addDistributionToValues({ [planningCellKey('a', '2026-12-01')]: '10.00' }, [
        { itemId: 'a', competence: '2026-12-01', amount: '20.00' },
      ]),
    ).toEqual({ [planningCellKey('a', '2026-12-01')]: '30.00' });
  });
});
