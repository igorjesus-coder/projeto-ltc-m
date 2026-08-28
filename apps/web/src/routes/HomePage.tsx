import { useMemo, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

import { publicEnvironment } from '../app/environment';
import { AuthenticationRequiredError, createAuthenticatedApiClient } from '../auth/api-client';

const foundations = [
  {
    title: 'Aplicação web',
    detail: 'React, TypeScript e Vite em módulos explícitos.',
  },
  {
    title: 'Qualidade',
    detail: 'Lint, testes, acessibilidade e build executáveis sem serviços locais.',
  },
  {
    title: 'Integrações',
    detail: 'API, autenticação e dados permanecem fora do scaffold P018.',
  },
];

export function HomePage() {
  const { getAccessTokenSilently, loginWithRedirect, logout, user } = useAuth0();
  const [apiStatus, setApiStatus] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const auth0Audience = publicEnvironment.auth0?.audience;
  const apiClient = useMemo(() => {
    if (!auth0Audience) return null;
    return createAuthenticatedApiClient({
      baseUrl: publicEnvironment.apiBaseUrl,
      audience: auth0Audience,
      getAccessToken: () =>
        getAccessTokenSilently({ authorizationParams: { audience: auth0Audience } }),
    });
  }, [auth0Audience, getAccessTokenSilently]);

  async function validateApiSession() {
    setSessionExpired(false);
    if (!apiClient) {
      setApiStatus('A API não está configurada neste ambiente.');
      return;
    }
    try {
      const response = await apiClient.get('/auth/me');
      setApiStatus(response.ok ? 'Sessão validada pela API.' : 'A API não confirmou a sessão.');
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        setApiStatus('Sessão expirada. Autentique-se novamente.');
        setSessionExpired(true);
        return;
      }
      setApiStatus('Não foi possível validar a sessão agora.');
    }
  }

  return (
    <>
      <section className="page-heading" aria-labelledby="home-title">
        <p className="eyebrow">Fundação da aplicação</p>
        <h1 id="home-title">Estrutura pronta para evoluir</h1>
        <p>
          O shell estabelece os limites técnicos do frontend sem antecipar funcionalidades de
          cadastro ou integrações de dados.
        </p>
      </section>

      <section className="foundation-panel" aria-labelledby="foundation-title">
        <div className="section-heading">
          <div>
            <h2 id="foundation-title">Baseline do frontend</h2>
            <p>Responsabilidades disponíveis no scaffold atual</p>
          </div>
          <span className="status-indicator">
            <span aria-hidden="true" />
            Pronto para desenvolvimento
          </span>
        </div>

        <ul className="foundation-list">
          {foundations.map((foundation) => (
            <li key={foundation.title}>
              <strong>{foundation.title}</strong>
              <span>{foundation.detail}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="auth-panel" aria-labelledby="session-title">
        <div>
          <h2 id="session-title">Sessão</h2>
          <p>{user?.name ?? user?.email ?? 'Usuário autenticado'}</p>
        </div>
        <div className="auth-actions">
          <button type="button" onClick={() => void validateApiSession()}>
            Validar sessão na API
          </button>
          <button
            type="button"
            onClick={() => void logout({ logoutParams: { returnTo: window.location.origin } })}
          >
            Sair
          </button>
        </div>
        {apiStatus ? <p role="status">{apiStatus}</p> : null}
        {sessionExpired ? (
          <button
            type="button"
            onClick={() =>
              void loginWithRedirect({ appState: { returnTo: window.location.pathname } })
            }
          >
            Autenticar novamente
          </button>
        ) : null}
      </section>
    </>
  );
}
