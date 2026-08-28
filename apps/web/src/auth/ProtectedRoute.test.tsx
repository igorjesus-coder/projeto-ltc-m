import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth0 } from '@auth0/auth0-react';

import { ProtectedRoute } from './ProtectedRoute';

vi.mock('@auth0/auth0-react', () => ({ useAuth0: vi.fn() }));

const mockedUseAuth0 = vi.mocked(useAuth0);

describe('rota protegida', () => {
  beforeEach(() => {
    mockedUseAuth0.mockReturnValue({
      error: null,
      isAuthenticated: false,
      isLoading: false,
      loginWithRedirect: vi.fn(),
    } as never);
  });

  it('não renderiza conteúdo protegido durante loading', () => {
    mockedUseAuth0.mockReturnValue({
      error: null,
      isAuthenticated: false,
      isLoading: true,
      loginWithRedirect: vi.fn(),
    } as never);
    const html = renderToStaticMarkup(
      <ProtectedRoute>
        <p>conteúdo protegido</p>
      </ProtectedRoute>,
    );
    expect(html).toContain('Verificando sua sessão');
    expect(html).not.toContain('conteúdo protegido');
  });

  it('substitui conteúdo protegido por login quando não autenticado', () => {
    const html = renderToStaticMarkup(
      <ProtectedRoute>
        <p>conteúdo protegido</p>
      </ProtectedRoute>,
    );
    expect(html).toContain('Entrar com Auth0');
    expect(html).not.toContain('conteúdo protegido');
  });

  it('renderiza conteúdo protegido somente com sessão válida', () => {
    mockedUseAuth0.mockReturnValue({
      error: null,
      isAuthenticated: true,
      isLoading: false,
      loginWithRedirect: vi.fn(),
    } as never);
    const html = renderToStaticMarkup(
      <ProtectedRoute>
        <p>conteúdo protegido</p>
      </ProtectedRoute>,
    );
    expect(html).toContain('conteúdo protegido');
  });

  it('mostra erro sanitizado para falha de sessão', () => {
    mockedUseAuth0.mockReturnValue({
      error: new Error('segredo interno'),
      isAuthenticated: false,
      isLoading: false,
      loginWithRedirect: vi.fn(),
    } as never);
    const html = renderToStaticMarkup(
      <ProtectedRoute>
        <p>protegido</p>
      </ProtectedRoute>,
    );
    expect(html).toContain('Não foi possível validar sua sessão');
    expect(html).not.toContain('segredo interno');
  });
});
