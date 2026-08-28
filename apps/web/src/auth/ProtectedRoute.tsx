import type { ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

import { getSafeReturnTo } from './navigation';

interface ProtectedRouteProps {
  readonly children: ReactNode;
}

function LoginPrompt() {
  const { loginWithRedirect } = useAuth0();

  return (
    <section className="auth-page" aria-labelledby="auth-login-title">
      <p className="eyebrow">Autenticação necessária</p>
      <h1 id="auth-login-title">Entre para acessar o LTC-M</h1>
      <p>O conteúdo da aplicação está disponível somente para usuários autenticados.</p>
      <button
        className="primary-button"
        type="button"
        onClick={() => {
          void loginWithRedirect({
            appState: {
              returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
            },
          });
        }}
      >
        Entrar com Auth0
      </button>
    </section>
  );
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { error, isAuthenticated, isLoading, loginWithRedirect } = useAuth0();

  if (isLoading) return <p role="status">Verificando sua sessão…</p>;

  if (error) {
    return (
      <section className="auth-page" aria-labelledby="auth-error-title">
        <p className="eyebrow">Sessão indisponível</p>
        <h1 id="auth-error-title">Não foi possível validar sua sessão</h1>
        <p>Inicie uma nova autenticação para continuar.</p>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            void loginWithRedirect({
              appState: {
                returnTo: getSafeReturnTo(window.location.pathname, window.location.origin),
              },
            });
          }}
        >
          Autenticar novamente
        </button>
      </section>
    );
  }

  return isAuthenticated ? <>{children}</> : <LoginPrompt />;
}
