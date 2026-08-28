import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    getAccessTokenSilently: vi.fn(),
    isAuthenticated: true,
    isLoading: false,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    user: { email: 'test@example.invalid' },
  }),
}));

import { App } from './App';
import { AppErrorBoundary, AppErrorFallback } from './AppErrorBoundary';

describe('scaffold da aplicação', () => {
  it('renderiza a rota raiz com landmarks e navegação acessível', () => {
    const html = renderToStaticMarkup(<App pathname="/" />);

    expect(html).toContain('<header');
    expect(html).toContain('<nav aria-label="Navegação principal"');
    expect(html).toContain('<main id="main-content"');
    expect(html).toContain('<h1 id="home-title"');
    expect(html).toContain('Pular para o conteúdo');
    expect(html).toContain('aria-current="page"');
  });

  it('renderiza fallback significativo para uma rota desconhecida', () => {
    const html = renderToStaticMarkup(<App pathname="/nao-existe" />);

    expect(html).toContain('Página não encontrada');
    expect(html).toContain('Voltar para o início');
    expect(html).not.toContain('aria-current="page"');
  });

  it('mantém fallback de erro sem expor detalhes internos', () => {
    const state = AppErrorBoundary.getDerivedStateFromError();
    const html = renderToStaticMarkup(<AppErrorFallback />);

    expect(state).toEqual({ hasError: true });
    expect(html).toContain('Não foi possível iniciar o LTC-M');
    expect(html).not.toContain('stack');
  });
});
