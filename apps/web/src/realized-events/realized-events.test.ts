import { describe, expect, it } from 'vitest';

import {
  P032_REALIZED_EVENTS_CONTRACT,
  formatRealizedMoney,
  parseRealizedEventsResponse,
  realizedStatusLabel,
} from './realized-events';

const event = {
  id: '00000000-0000-4000-8000-000000032201',
  projectId: '00000000-0000-4000-8000-000000032101',
  projectItemId: null,
  itemCode: null,
  itemDescription: null,
  metricType: 'billing_actual',
  competenceDate: '2026-09-01',
  sourceKey: 'source-1',
  documentNumber: null,
  installmentKey: null,
  amount: '1234.50',
  currencyCode: 'BRL',
  status: 'cancelled',
  notes: null,
  rowVersion: 2,
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
};

describe('P032 realized events contract', () => {
  it('preserves cancelled history and exposes only billing_actual', () => {
    const response = parseRealizedEventsResponse({
      contract: P032_REALIZED_EVENTS_CONTRACT,
      projectId: event.projectId,
      project: { code: 'P032', name: 'Projeto', currencyCode: 'BRL' },
      projectItems: [],
      events: [event],
    });

    expect(response.events[0]?.status).toBe('cancelled');
    expect(response.events[0]?.metricType).toBe('billing_actual');
    expect(realizedStatusLabel('posted')).toBe('Publicado');
    expect(formatRealizedMoney('1234.50', 'BRL')).toContain('1.234,50');
  });

  it('rejects another metric or malformed response', () => {
    expect(() =>
      parseRealizedEventsResponse({ contract: 'wrong', projectItems: [], events: [] }),
    ).toThrow('P032_RESPONSE_INVALID');
    expect(() =>
      parseRealizedEventsResponse({
        contract: P032_REALIZED_EVENTS_CONTRACT,
        projectId: event.projectId,
        project: { code: 'P032', name: 'Projeto', currencyCode: 'BRL' },
        projectItems: [],
        events: [{ ...event, metricType: 'receipt_actual' }],
      }),
    ).toThrow('P032_RESPONSE_INVALID');
  });
});
