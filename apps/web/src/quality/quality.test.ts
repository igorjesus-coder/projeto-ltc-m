import { describe, expect, it } from 'vitest';

import {
  parseQualityResponse,
  readQualityQuery,
  resolveQualityNavigation,
  serializeQualityQuery,
} from './quality';

const projectId = '00000000-0000-4000-8000-000000034101';

describe('contrato local da central de qualidade P034', () => {
  it('preserva filtros e paginação na query string', () => {
    const query = readQualityQuery(
      `?projectId=${projectId}&rule=UNPLANNED_BALANCE&severity=WARNING&origin=project&search=Projeto%20A&sort=severity&order=desc&page=2&pageSize=50`,
    );
    expect(query).toEqual({
      projectId,
      rule: 'UNPLANNED_BALANCE',
      severity: 'WARNING',
      origin: 'project',
      search: 'Projeto A',
      sort: 'severity',
      order: 'desc',
      page: 2,
      pageSize: 50,
    });
    expect(serializeQualityQuery(query)).toContain('rule=UNPLANNED_BALANCE');
    expect(serializeQualityQuery(query)).toContain('pageSize=50');
  });

  it('valida envelope, severity/origin e não aceita contrato diferente', () => {
    expect(() => parseQualityResponse({ contract: 'other', items: [] })).toThrow(
      'P034_RESPONSE_INVALID',
    );
    expect(
      parseQualityResponse({
        contract: 'ltcm.p034.data-quality-center.v3',
        items: [
          {
            id: 'p034:1',
            project: { id: projectId, code: 'P034-001' },
            rule: { code: 'PROJECT_DATA_STALE', label: 'Projeto desatualizado' },
            severity: 'WARNING',
            origin: { entity: 'project', findingOrigin: 'projects' },
          },
        ],
        page: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
      }).items[0]?.rule.code,
    ).toBe('PROJECT_DATA_STALE');
  });

  it('resolve apenas destinos semânticos internos e preserva returnTo seguro', () => {
    expect(
      resolveQualityNavigation(
        { target: 'project_item', projectId },
        '/quality?severity=ERROR',
        'https://ltcm.example',
      ),
    ).toBe(`/projects/${projectId}/items?returnTo=%2Fquality%3Fseverity%3DERROR`);
    expect(
      resolveQualityNavigation(
        { target: 'project', projectId: 'https://evil.example' },
        'https://evil.example/steal',
        'https://ltcm.example',
      ),
    ).toBeNull();
    expect(resolveQualityNavigation(undefined, '/quality')).toBeNull();
  });
});
