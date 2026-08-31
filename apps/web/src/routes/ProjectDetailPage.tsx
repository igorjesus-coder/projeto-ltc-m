import { useEffect, useMemo, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

import { publicEnvironment } from '../app/environment';
import {
  ApiRequestError,
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  createAuthenticatedApiClient,
} from '../auth/api-client';
import { PermissionGate, useAuthorization } from '../auth/authorization';
import { ActionLink, Breadcrumbs, Button, PageHeader } from '../components/design-system';
import {
  formatDate,
  formatMoney,
  parseProjectDetail,
  statusLabel,
  type ProjectDetail,
} from '../projects/project-portfolio';
import { getSafeReturnTo } from '../auth/navigation';

type DetailState =
  | { readonly key: string; readonly kind: 'loading' }
  | { readonly key: string; readonly kind: 'success'; readonly project: ProjectDetail }
  | { readonly key: string; readonly kind: 'error'; readonly error: unknown };

function returnPath(search: string): string {
  const returnTo = new URLSearchParams(search).get('returnTo');
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  return getSafeReturnTo(returnTo ?? '/projects', origin);
}

export function ProjectDetailPage({
  projectId,
  search,
}: {
  readonly projectId: string;
  readonly search: string;
}) {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth0();
  const { refresh } = useAuthorization();
  const [state, setState] = useState<DetailState>({ key: '', kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const requestKey = `${projectId}|${retry}`;
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

  useEffect(() => {
    let cancelled = false;
    if (!apiClient) {
      return () => {
        cancelled = true;
      };
    }
    void apiClient
      .getJson<unknown>(`/projects/${encodeURIComponent(projectId)}`)
      .then((response) => {
        if (!cancelled) {
          setState({ key: requestKey, kind: 'success', project: parseProjectDetail(response) });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ key: requestKey, kind: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, projectId, requestKey]);

  const visibleState: DetailState = !apiClient
    ? { key: requestKey, kind: 'error', error: new Error('P023_API_NOT_CONFIGURED') }
    : state.key === requestKey
      ? state
      : { key: requestKey, kind: 'loading' };

  return (
    <>
      <PageHeader
        eyebrow="Projeto — somente leitura"
        title={visibleState.kind === 'success' ? visibleState.project.code : 'Detalhe do projeto'}
        titleId="project-detail-title"
        description="Edição e cadastro pertencem ao fluxo subsequente; esta tela preserva o contexto da consulta."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Início', href: '/' },
              { label: 'Projetos', href: returnPath(search) },
              {
                label: visibleState.kind === 'success' ? visibleState.project.code : 'Detalhe',
                current: true,
              },
            ]}
          />
        }
      />
      {visibleState.kind === 'loading' ? <p role="status">Carregando projeto…</p> : null}
      {visibleState.kind === 'error' ? (
        <section className="error-panel" aria-labelledby="project-detail-error-title">
          <h2 id="project-detail-error-title">
            {visibleState.error instanceof AuthenticationRequiredError
              ? 'Sessão expirada'
              : visibleState.error instanceof AuthorizationDeniedError
                ? 'Acesso negado'
                : visibleState.error instanceof ApiRequestError && visibleState.error.status === 404
                  ? 'Projeto não encontrado'
                  : 'Não foi possível carregar o projeto'}
          </h2>
          <p>
            {visibleState.error instanceof AuthorizationDeniedError
              ? 'Seu perfil não possui acesso a este projeto.'
              : 'Tente novamente sem expor detalhes internos.'}
          </p>
          {visibleState.error instanceof AuthenticationRequiredError ? (
            <Button
              type="button"
              onClick={() =>
                void loginWithRedirect({
                  appState: { returnTo: `${window.location.pathname}${window.location.search}` },
                })
              }
            >
              Autenticar novamente
            </Button>
          ) : visibleState.error instanceof AuthorizationDeniedError ? (
            <Button type="button" onClick={refresh}>
              Tentar novamente
            </Button>
          ) : visibleState.error instanceof ApiRequestError && visibleState.error.status === 404 ? (
            <ActionLink href={returnPath(search)}>Voltar para projetos</ActionLink>
          ) : (
            <Button type="button" onClick={() => setRetry((value) => value + 1)}>
              Tentar novamente
            </Button>
          )}
        </section>
      ) : null}
      {visibleState.kind === 'success' ? (
        <section className="project-detail-panel" aria-labelledby="project-detail-summary-title">
          <h2 id="project-detail-summary-title">Resumo factual</h2>
          <dl className="project-detail-list">
            <div>
              <dt>Projeto</dt>
              <dd>{visibleState.project.name}</dd>
            </div>
            <div>
              <dt>Cliente</dt>
              <dd>{visibleState.project.clientName}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`status-badge status-${visibleState.project.status}`}>
                  {statusLabel(visibleState.project.status)}
                </span>
              </dd>
            </div>
            <div>
              <dt>Valor do contrato</dt>
              <dd>
                {formatMoney(visibleState.project.contractValue, visibleState.project.currencyCode)}
              </dd>
            </div>
            <div>
              <dt>Última atualização</dt>
              <dd>{formatDate(visibleState.project.updatedAt)}</dd>
            </div>
          </dl>
          <ActionLink href={returnPath(search)}>Voltar para projetos</ActionLink>
          <PermissionGate capability="record:edit_draft">
            <ActionLink
              href={`/projects/${encodeURIComponent(projectId)}/edit?returnTo=${encodeURIComponent(returnPath(search))}`}
            >
              Editar projeto
            </ActionLink>
          </PermissionGate>
        </section>
      ) : null}
    </>
  );
}
