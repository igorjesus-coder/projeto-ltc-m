import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn(), isAuthenticated: true, isLoading: false }),
}));

import { resolveRoute } from '../app/routes';
import { AuthorizationContext, type AuthorizationContextValue } from '../auth/authorization';
import { MonthlyPlanningPage } from './MonthlyPlanningPage';

const authorization: AuthorizationContextValue = {
  status: 'ready',
  profile: {
    authenticated: true,
    user: { id: 'p029-user', displayName: 'P029 User' },
    role: 'editor',
    capabilities: ['data:read', 'financial:read', 'forecast:edit_draft'],
  },
  can: (capability) => ['data:read', 'financial:read', 'forecast:edit_draft'].includes(capability),
  refresh: () => undefined,
};

describe('rota e estrutura do editor P029', () => {
  it('expõe rota protegida e controles de seleção', () => {
    expect(resolveRoute('/planning').id).toBe('monthly-planning');
    expect(resolveRoute('/planning').protected).toBe(true);
    const html = renderToStaticMarkup(
      <AuthorizationContext.Provider value={authorization}>
        <MonthlyPlanningPage />
      </AuthorizationContext.Provider>,
    );
    expect(html).toContain('Editor de programação mensal');
    expect(html).toContain('planning-project');
    expect(html).toContain('planning-version');
    expect(html).toContain('Aplicar período');
  });
});
