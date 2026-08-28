import { describe, expect, it } from 'vitest';

import {
  ENVIRONMENT_CATEGORIES,
  loadPublicEnvironment,
  requireAuth0Environment,
} from './environment';

describe('contrato público de ambiente', () => {
  it('carrega somente configuração pública e aplica defaults locais seguros', () => {
    expect(loadPublicEnvironment({})).toEqual({
      appEnvironment: 'local',
      apiBaseUrl: 'http://localhost:3000',
      auth0: null,
    });
    expect(ENVIRONMENT_CATEGORIES.SERVER_ONLY).toContain('database connection configuration');
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
      auth0: null,
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

  it('valida a configuração pública Auth0 e falha fechado quando incompleta', () => {
    const environment = loadPublicEnvironment({
      VITE_AUTH0_DOMAIN: 'tenant.example.auth0.com',
      VITE_AUTH0_CLIENT_ID: 'client-id',
      VITE_AUTH0_AUDIENCE: 'https://api.example.invalid',
      VITE_AUTH0_REDIRECT_URI: 'http://localhost:5173/callback',
    });
    expect(environment.auth0).toEqual({
      domain: 'tenant.example.auth0.com',
      clientId: 'client-id',
      audience: 'https://api.example.invalid',
      redirectUri: 'http://localhost:5173/callback',
    });
    expect(() => loadPublicEnvironment({ VITE_AUTH0_DOMAIN: 'tenant.example.auth0.com' })).toThrow(
      'P020_AUTH0_CONFIG_INCOMPLETE',
    );
    expect(() =>
      loadPublicEnvironment({ VITE_AUTH0_REDIRECT_URI: 'http://localhost:5173' }),
    ).toThrow('P020_AUTH0_CONFIG_INCOMPLETE');
    expect(() =>
      requireAuth0Environment(loadPublicEnvironment({}), 'http://localhost:5173'),
    ).toThrow('P020_AUTH0_CONFIG_MISSING');
  });
});
