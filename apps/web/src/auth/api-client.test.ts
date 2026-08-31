import { describe, expect, it, vi } from 'vitest';

import {
  ApiRequestError,
  AuthenticationRequiredError,
  createAuthenticatedApiClient,
} from './api-client';

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

  it('envia JSON sem persistir token e preserva somente código sanitizado de erro', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'P024_VERSION_CONFLICT' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = createAuthenticatedApiClient({
      baseUrl: 'https://api.example.invalid',
      audience: 'https://api.example.invalid',
      getAccessToken: vi.fn(async () => 'synthetic-token'),
      fetchImpl,
    });
    await expect(
      client.sendJson('/projects/project-1', 'PATCH', { expectedVersion: 1 }),
    ).rejects.toEqual(expect.objectContaining({ status: 409, code: 'P024_VERSION_CONFLICT' }));
    const requestInit = (fetchImpl.mock.calls[0] as unknown[] | undefined)?.[1] as RequestInit;
    expect(requestInit.method).toBe('PATCH');
    expect(new Headers(requestInit.headers).get('Authorization')).toBe('Bearer synthetic-token');
    expect(await new Response(requestInit.body).json()).toEqual({ expectedVersion: 1 });
    expect(fetchImpl.mock.results).toBeDefined();
    expect(new ApiRequestError(409, 'P024_VERSION_CONFLICT').code).toBe('P024_VERSION_CONFLICT');
  });
});
