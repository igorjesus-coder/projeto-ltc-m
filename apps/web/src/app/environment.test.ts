import { describe, expect, it } from 'vitest';

import { ENVIRONMENT_CATEGORIES, loadPublicEnvironment } from './environment';

describe('contrato público de ambiente', () => {
  it('carrega somente configuração pública e aplica defaults locais seguros', () => {
    expect(loadPublicEnvironment({})).toEqual({
      appEnvironment: 'local',
      apiBaseUrl: 'http://localhost:3000',
    });
    expect(ENVIRONMENT_CATEGORIES.SERVER_ONLY).toContain('DATABASE_URL');
  });

  it('normaliza ambiente e URL pública válidos', () => {
    expect(
      loadPublicEnvironment({
        VITE_APP_ENV: 'test',
        VITE_API_BASE_URL: 'https://api.example.invalid/',
      }),
    ).toEqual({
      appEnvironment: 'test',
      apiBaseUrl: 'https://api.example.invalid',
    });
  });

  it('rejeita ambiente, URL com credencial e nome Vite sensível', () => {
    expect(() => loadPublicEnvironment({ VITE_APP_ENV: 'unknown' })).toThrow(
      'P018_APP_ENV_INVALID',
    );
    expect(() =>
      loadPublicEnvironment({ VITE_API_BASE_URL: 'https://user:password@example.invalid' }),
    ).toThrow('P018_PUBLIC_API_URL_INVALID');
    expect(() => loadPublicEnvironment({ VITE_SERVICE_ROLE_KEY: 'not-allowed' })).toThrow(
      'P018_SENSITIVE_BROWSER_ENV_REJECTED',
    );
  });
});
