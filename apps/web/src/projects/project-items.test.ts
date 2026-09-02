import { describe, expect, it } from 'vitest';

import {
  P027_PROJECT_ITEMS_CONTRACT,
  formatProjectItemMoney,
  parseProjectItemsResponse,
} from './project-items';

const item = {
  id: '00000000-0000-4000-8000-000000027201',
  projectId: '00000000-0000-4000-8000-000000027101',
  sourceLineKey: 'manual:source',
  lineNumber: 1,
  itemCode: 'ITEM-1',
  description: 'Item',
  quantity: '2.0000',
  unitCode: 'UN',
  unitName: 'Unidade',
  unitAvailable: true,
  currencyCode: 'BRL',
  currencyName: 'Real brasileiro',
  currencyAvailable: true,
  unitPrice: '10.5000',
  totalAmount: '21.00',
  active: true,
  deletedAt: null,
  rowVersion: 3,
  createdAt: '2026-09-02T12:00:00.000Z',
  updatedAt: '2026-09-02T12:00:00.000Z',
};

describe('P027 project items contract', () => {
  it('parses catalog, repeated codes and database total without client calculation', () => {
    const response = parseProjectItemsResponse({
      contract: P027_PROJECT_ITEMS_CONTRACT,
      projectId: item.projectId,
      projectCurrency: 'BRL',
      projectCurrencyAvailable: true,
      units: [
        { code: 'UN', name: 'Unidade', active: true },
        { code: 'H', name: 'Hora', active: false },
      ],
      items: [item, { ...item, id: '00000000-0000-4000-8000-000000027202', lineNumber: 2 }],
    });

    expect(response.items).toHaveLength(2);
    expect(response.items[0]?.totalAmount).toBe('21.00');
    expect(response.units[1]?.active).toBe(false);
    expect(formatProjectItemMoney('21.00', 'BRL')).toContain('21,00');
  });

  it('rejects an invalid contract, currency or decimal response', () => {
    expect(() => parseProjectItemsResponse({ contract: 'wrong', units: [], items: [] })).toThrow(
      'P027_RESPONSE_INVALID',
    );
    expect(() =>
      parseProjectItemsResponse({
        contract: P027_PROJECT_ITEMS_CONTRACT,
        projectId: item.projectId,
        projectCurrency: 'EUR',
        projectCurrencyAvailable: true,
        units: [],
        items: [],
      }),
    ).toThrow('P027_RESPONSE_INVALID');
    expect(() =>
      parseProjectItemsResponse({
        contract: P027_PROJECT_ITEMS_CONTRACT,
        projectId: item.projectId,
        projectCurrency: 'BRL',
        projectCurrencyAvailable: true,
        units: [],
        items: [{ ...item, totalAmount: 'not-a-decimal' }],
      }),
    ).toThrow('P027_RESPONSE_INVALID');
  });
});
