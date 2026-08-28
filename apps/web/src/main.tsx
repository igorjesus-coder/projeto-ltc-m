import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';

import { App } from './app/App';
import { AppErrorBoundary } from './app/AppErrorBoundary';
import { publicEnvironment, requireAuth0Environment } from './app/environment';
import { getSafeReturnTo } from './auth/navigation';
import { AuthorizationProvider } from './auth/authorization';
import './styles/global.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Elemento raiz não encontrado.');
}

const auth0 = requireAuth0Environment(publicEnvironment, window.location.origin);

createRoot(rootElement).render(
  <StrictMode>
    <Auth0Provider
      domain={auth0.domain}
      clientId={auth0.clientId}
      cacheLocation="memory"
      useRefreshTokens={false}
      authorizationParams={{ audience: auth0.audience, redirect_uri: auth0.redirectUri }}
      onRedirectCallback={(appState) => {
        const returnTo = getSafeReturnTo(appState?.returnTo, window.location.origin);
        window.history.replaceState({}, document.title, returnTo);
      }}
    >
      <AppErrorBoundary>
        <AuthorizationProvider>
          <App pathname={window.location.pathname} />
        </AuthorizationProvider>
      </AppErrorBoundary>
    </Auth0Provider>
  </StrictMode>,
);
