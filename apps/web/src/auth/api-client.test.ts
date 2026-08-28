import { describe, expect, it, vi } from 'vitest';

import { AuthenticationRequiredError, createAuthenticatedApiClient } from './api-client';

describe('cliente autenticado da API', () => {
  it('obtém token pelo SDK e envia bearer sem persistência manual', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = createAuthenticatedApiClient({
      baseUrl: 'https://api.example.invalid',
      audience: 'https://api.example.invalid',
      getAccessToken: vi.fn(async () => 'synthetic-token'),
      fetchImpl,
    });

    await client.get('/auth/me');

    const requestInit = (fetchImpl.mock.calls[0] as unknown[] | undefined)?.[1] as
      RequestInit | undefined;
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://api.example.invalid/auth/me'),
      requestInit,
    );
    expect(new Headers(requestInit?.headers).get('Authorization')).toBe('Bearer synthetic-token');
  });

  it('transforma 401 em erro controlado e rejeita token vazio', async () => {
    const getAccessToken = vi.fn(async () => 'synthetic-token');
    const client = createAuthenticatedApiClient({
      baseUrl: 'https://api.example.invalid',
      audience: 'https://api.example.invalid',
      getAccessToken,
      fetchImpl: vi.fn(async () => new Response('{}', { status: 401 })),
    });
    await expect(client.get('/auth/me')).rejects.toBeInstanceOf(AuthenticationRequiredError);

    const emptyClient = createAuthenticatedApiClient({
      baseUrl: 'https://api.example.invalid',
      audience: 'https://api.example.invalid',
      getAccessToken: vi.fn(async () => ' '),
      fetchImpl: vi.fn(),
    });
    await expect(emptyClient.get('/auth/me')).rejects.toThrow('P020_AUTHENTICATION_REQUIRED');
  });
});
