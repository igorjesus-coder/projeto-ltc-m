import { describe, expect, it } from 'vitest';

import {
  formatMoney,
  parsePortfolioResponse,
  readPortfolioQuery,
  serializePortfolioQuery,
} from './project-portfolio';

describe('contrato local do portfólio P023', () => {
  it('hidrata e serializa o contexto da lista na query string', () => {
    const query = readPortfolioQuery(
      '?search=Cliente%20A&status=active&sort=client&order=desc&page=2&pageSize=50',
    );
    expect(query).toEqual({
      search: 'Cliente A',
      status: 'active',
      sort: 'client',
      order: 'desc',
      page: 2,
      pageSize: 50,
    });
    expect(serializePortfolioQuery(query)).toBe(
      'search=Cliente+A&status=active&sort=client&order=desc&page=2&pageSize=50',
    );
  });

  it('mantém valores monetários exatos na apresentação', () => {
    expect(formatMoney('123456789012345.67', 'BRL')).toContain('123.456.789.012.345,67');
    expect(formatMoney(null, 'BRL')).toBe('Indisponível');
  });

  it('rejeita resposta sem contrato ou decimal textual seguro', () => {
    expect(() =>
      parsePortfolioResponse({
        contract: 'other',
        items: [],
        page: 1,
        pageSize: 25,
        totalItems: 0,
        totalPages: 0,
      }),
    ).toThrow('P023_RESPONSE_INVALID');
  });
});
