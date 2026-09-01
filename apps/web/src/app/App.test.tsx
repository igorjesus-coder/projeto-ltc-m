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
import { AuthorizationContext } from '../auth/authorization';
import type { AuthorizationContextValue } from '../auth/authorization';
import { AppShell } from '../layouts/AppShell';
import { resolveRoute } from './routes';

const readyAuthorization: AuthorizationContextValue = {
  status: 'ready' as const,
  profile: {
    authenticated: true as const,
    user: { id: 'p021-test', displayName: 'P021 Test' },
    role: 'viewer' as const,
    capabilities: ['data:read', 'financial:read'] as const,
  },
  can: (capability) => ['data:read', 'financial:read'].includes(capability),
  refresh: () => undefined,
};

const adminAuthorization: AuthorizationContextValue = {
  status: 'ready',
  profile: {
    authenticated: true,
    user: { id: 'p026-admin', displayName: 'P026 Admin' },
    role: 'admin',
    capabilities: ['catalog:manage'],
  },
  can: () => true,
  refresh: () => undefined,
};

describe('scaffold da aplicação', () => {
  it('renderiza a rota raiz com landmarks e navegação acessível', () => {
    const html = renderToStaticMarkup(
      <AuthorizationContext.Provider value={readyAuthorization}>
        <App pathname="/" />
      </AuthorizationContext.Provider>,
    );

    expect(html).toContain('<header');
    expect(html).toContain('<nav aria-label="Navegação principal"');
    expect(html).toContain('<main id="main-content"');
    expect(html).toContain('<h1 id="home-title"');
    expect(html).toContain('Pular para o conteúdo');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('Cadastros mestres');
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

  it('expõe o contrato estrutural da navegação responsiva', () => {
    const html = renderToStaticMarkup(
      <AppShell currentRoute="home">
        <p>Conteúdo</p>
      </AppShell>,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="mobile-primary-navigation"');
    expect(html).toContain('aria-label="Navegação móvel"');
    expect(html).toContain('aria-label="Navegação principal"');
    expect(html).toContain('<aside class="desktop-navigation">');
  });

  it('resolve a lista e o detalhe de projetos como rotas protegidas', () => {
    expect(resolveRoute('/projects', '').id).toBe('projects');
    expect(resolveRoute('/projects/00000000-0000-4000-8000-000000023101', '').id).toBe(
      'project-detail',
    );
    expect(resolveRoute('/projects', '?status=active&page=2').protected).toBe(true);
  });

  it('resolve as rotas protegidas de criação e edição P024', () => {
    expect(resolveRoute('/projects/new', '').id).toBe('project-new');
    expect(resolveRoute('/projects/00000000-0000-4000-8000-000000023101/edit', '').id).toBe(
      'project-edit',
    );
    expect(resolveRoute('/projects/new', '').protected).toBe(true);
  });

  it('exibe navegação administrativa somente para catalog:manage', () => {
    const adminHtml = renderToStaticMarkup(
      <AuthorizationContext.Provider value={adminAuthorization}>
        <AppShell currentRoute="home">
          <p>Conteúdo</p>
        </AppShell>
      </AuthorizationContext.Provider>,
    );
    expect(adminHtml).toContain('Cadastros mestres');
    expect(resolveRoute('/admin/clients', '').id).toBe('admin-master-data');
  });
});
