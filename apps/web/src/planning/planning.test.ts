import { describe, expect, it } from 'vitest';

import {
  buildPlanningEntries,
  decimalToCents,
  formatCents,
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
});
