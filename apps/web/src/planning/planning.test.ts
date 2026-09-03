import { describe, expect, it } from 'vitest';

import { decimalToCents, formatCents, parsePlanningEditorResponse } from './planning';

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
});
