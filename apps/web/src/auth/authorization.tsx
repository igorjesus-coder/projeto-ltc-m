/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

import { publicEnvironment } from '../app/environment';
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  createAuthenticatedApiClient,
} from './api-client';

export const AUTHORIZATION_CONTRACT = 'ltcm.p021.authorization-ui.v1' as const;

export const ROLES = ['viewer', 'editor', 'approver', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  'data:read',
  'financial:read',
  'audit:read',
  'record:create',
  'record:edit_draft',
  'forecast:create',
  'forecast:edit_draft',
  'workflow:submit',
  'workflow:approve',
  'workflow:return_to_draft',
  'workflow:lock',
  'workflow:reopen',
  'workflow:archive',
  'soft_delete:execute',
  'soft_delete:restore',
  'catalog:manage',
  'users:manage',
  'roles:manage',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface AuthorizationProfile {
  readonly authenticated: true;
  readonly user: { readonly id: string; readonly displayName: string };
  readonly role: Role;
  readonly capabilities: readonly Capability[];
}

export type AuthorizationStatus =
  'loading' | 'ready' | 'unauthenticated' | 'denied' | 'authentication-required' | 'error';

export interface AuthorizationContextValue {
  readonly status: AuthorizationStatus;
  readonly profile: AuthorizationProfile | null;
  readonly can: (capability: Capability) => boolean;
  readonly refresh: () => void;
}

const defaultAuthorization: AuthorizationContextValue = Object.freeze({
  status: 'loading' as const,
  profile: null,
  can: () => false,
  refresh: () => undefined,
});

export const AuthorizationContext = createContext<AuthorizationContextValue>(defaultAuthorization);

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value);
}

function parseProfile(value: unknown): AuthorizationProfile {
  if (!value || typeof value !== 'object') throw new Error('P021_AUTHORIZATION_RESPONSE_INVALID');
  const response = value as Record<string, unknown>;
  const user = response['user'];
  const capabilities = response['capabilities'];
  if (
    response['authenticated'] !== true ||
    !isRole(response['role']) ||
    !user ||
    typeof user !== 'object' ||
    typeof (user as Record<string, unknown>)['id'] !== 'string' ||
    typeof (user as Record<string, unknown>)['displayName'] !== 'string' ||
    !Array.isArray(capabilities) ||
    !capabilities.every(isCapability)
  ) {
    throw new Error('P021_AUTHORIZATION_RESPONSE_INVALID');
  }
  const parsedUser = user as Record<string, unknown>;
  const role = response['role'] as Role;
  const parsedCapabilities = capabilities.filter(isCapability);
  return Object.freeze({
    authenticated: true,
    user: Object.freeze({
      id: parsedUser['id'] as string,
      displayName: parsedUser['displayName'] as string,
    }),
    role,
    capabilities: Object.freeze([...new Set(parsedCapabilities)]),
  });
}

export function AuthorizationProvider({ children }: { readonly children: ReactNode }) {
  const { getAccessTokenSilently, isAuthenticated, isLoading } = useAuth0();
  const [status, setStatus] = useState<AuthorizationStatus>('loading');
  const [profile, setProfile] = useState<AuthorizationProfile | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const auth0Audience = publicEnvironment.auth0?.audience;
  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  const apiClient = useMemo(() => {
    if (!auth0Audience) return null;
    return createAuthenticatedApiClient({
      baseUrl: publicEnvironment.apiBaseUrl,
      audience: auth0Audience,
      getAccessToken: () =>
        getAccessTokenSilently({ authorizationParams: { audience: auth0Audience } }),
    });
  }, [auth0Audience, getAccessTokenSilently]);

  useEffect(() => {
    let cancelled = false;
    if (isLoading) {
      return () => {
        cancelled = true;
      };
    }
    if (!isAuthenticated) {
      return () => {
        cancelled = true;
      };
    }
    if (!apiClient) {
      queueMicrotask(() => {
        if (!cancelled) {
          setStatus('error');
          setProfile(null);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    void apiClient
      .getJson<unknown>('/auth/me')
      .then((response) => {
        if (cancelled) return;
        setProfile(parseProfile(response));
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setProfile(null);
        if (error instanceof AuthenticationRequiredError) {
          setStatus('authentication-required');
        } else if (error instanceof AuthorizationDeniedError) {
          setStatus('denied');
        } else {
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, isAuthenticated, isLoading, refreshVersion]);

  const value = useMemo<AuthorizationContextValue>(
    () => ({
      status: isLoading ? 'loading' : !isAuthenticated ? 'unauthenticated' : status,
      profile: isAuthenticated ? profile : null,
      can: (capability) =>
        isAuthenticated ? (profile?.capabilities.includes(capability) ?? false) : false,
      refresh,
    }),
    [isAuthenticated, isLoading, profile, refresh, status],
  );

  return <AuthorizationContext.Provider value={value}>{children}</AuthorizationContext.Provider>;
}

export function useAuthorization(): AuthorizationContextValue {
  return useContext(AuthorizationContext);
}

export function PermissionGate({
  capability,
  children,
  fallback = null,
}: {
  readonly capability: Capability;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) {
  const { can } = useAuthorization();
  return can(capability) ? <>{children}</> : <>{fallback}</>;
}

export function AuthorizationRoute({ children }: { readonly children: ReactNode }) {
  const { loginWithRedirect } = useAuth0();
  const { profile, refresh, status } = useAuthorization();
  if (status === 'loading') return <p role="status">Carregando suas permissõesâ€¦</p>;
  if (status === 'unauthenticated' || status === 'authentication-required') {
    return (
      <section className="auth-page" aria-labelledby="authorization-login-title">
        <p className="eyebrow">Sessão necessária</p>
        <h1 id="authorization-login-title">Autentique-se novamente</h1>
        <p>Sua sessão não está disponível para consultar as permissões LTC-M.</p>
        <button
          className="primary-button"
          type="button"
          onClick={() =>
            void loginWithRedirect({ appState: { returnTo: window.location.pathname } })
          }
        >
          Entrar com Auth0
        </button>
      </section>
    );
  }
  if (status === 'denied') {
    return (
      <section className="auth-page" aria-labelledby="authorization-denied-title">
        <p className="eyebrow">Acesso negado</p>
        <h1 id="authorization-denied-title">Perfil LTC-M não autorizado</h1>
        <p>Seu usuário autenticado não possui um perfil LTC-M ativo.</p>
        <button type="button" onClick={refresh}>
          Tentar novamente
        </button>
      </section>
    );
  }
  if (status === 'error' || !profile) {
    return (
      <section className="auth-page" aria-labelledby="authorization-error-title">
        <p className="eyebrow">Permissões indisponíveis</p>
        <h1 id="authorization-error-title">Não foi possível carregar suas permissões</h1>
        <p>Tente novamente sem expor detalhes internos de autorização.</p>
        <button type="button" onClick={refresh}>
          Tentar novamente
        </button>
      </section>
    );
  }
  return <>{children}</>;
}
