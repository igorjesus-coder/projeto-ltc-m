import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

import { publicEnvironment } from '../app/environment';
import {
  ApiRequestError,
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  createAuthenticatedApiClient,
} from '../auth/api-client';
import { PermissionGate, useAuthorization } from '../auth/authorization';
import {
  ActionLink,
  Breadcrumbs,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
} from '../components/design-system';
import {
  DEFAULT_PORTFOLIO_QUERY,
  formatDate,
  formatMoney,
  isFiltered,
  parsePortfolioResponse,
  readPortfolioQuery,
  serializePortfolioQuery,
  statusLabel,
  type PortfolioQuery,
  type PortfolioStatus,
  type ProjectPortfolioItem,
  type ProjectSortField,
} from '../projects/project-portfolio';

type LoadState =
  | { readonly key: string; readonly kind: 'loading' }
  | {
      readonly key: string;
      readonly kind: 'success';
      readonly response: ReturnType<typeof parsePortfolioResponse>;
    }
  | { readonly key: string; readonly kind: 'error'; readonly error: unknown };

function updateQuery(query: PortfolioQuery, replace = false) {
  const suffix = serializePortfolioQuery(query);
  const url = `${window.location.pathname}${suffix ? `?${suffix}` : ''}`;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function sortLabel(field: ProjectSortField): string {
  return {
    code: 'código',
    client: 'cliente',
    status: 'status',
    contractValue: 'valor do contrato',
    unscheduledBalance: 'saldo sem programação',
    updatedAt: 'última atualização',
  }[field];
}

function balanceLabel(item: ProjectPortfolioItem): string {
  if (item.unscheduledBalanceStatus === 'available' && item.unscheduledBalance !== null) {
    return formatMoney(item.unscheduledBalance, item.currencyCode);
  }
  return 'Indisponível';
}

function ProjectTable({
  items,
  query,
}: {
  items: readonly ProjectPortfolioItem[];
  query: PortfolioQuery;
}) {
  const returnTo =
    typeof window === 'undefined'
      ? '/projects'
      : `${window.location.pathname}${window.location.search}`;

  function sortBy(field: ProjectSortField) {
    updateQuery({
      ...query,
      sort: field,
      order: query.sort === field && query.order === 'asc' ? 'desc' : 'asc',
      page: 1,
    });
  }

  function ariaSort(field: ProjectSortField): 'ascending' | 'descending' | 'none' {
    if (query.sort !== field) return 'none';
    return query.order === 'asc' ? 'ascending' : 'descending';
  }

  const headers: readonly { field: ProjectSortField; label: string }[] = [
    { field: 'code', label: 'Código' },
    { field: 'client', label: 'Cliente' },
    { field: 'status', label: 'Status' },
    { field: 'contractValue', label: 'Valor do contrato' },
    { field: 'unscheduledBalance', label: 'Saldo sem programação' },
    { field: 'updatedAt', label: 'Última atualização' },
  ];

  return (
    <div className="table-scroll" role="region" aria-label="Projetos encontrados" tabIndex={0}>
      <table className="project-table">
        <caption className="visually-hidden">Lista de projetos do portfólio</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header.field} scope="col" aria-sort={ariaSort(header.field)}>
                <button
                  className="table-sort-button"
                  type="button"
                  aria-label={`Ordenar por ${header.label}`}
                  onClick={() => sortBy(header.field)}
                >
                  {header.label}
                  <span aria-hidden="true">
                    {query.sort === header.field ? (query.order === 'asc' ? ' ↑' : ' ↓') : ''}
                  </span>
                </button>
              </th>
            ))}
            <th scope="col">Alertas</th>
            <th scope="col">Ação</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.projectId}>
              <th scope="row">
                <strong>{item.code}</strong>
              </th>
              <td>{item.clientName}</td>
              <td>
                <span className={`status-badge status-${item.status}`}>
                  {statusLabel(item.status)}
                </span>
              </td>
              <td>{formatMoney(item.contractValue, item.currencyCode)}</td>
              <td>
                <span
                  title={
                    item.unscheduledBalanceStatus === 'available'
                      ? undefined
                      : item.unscheduledBalanceStatus
                  }
                >
                  {balanceLabel(item)}
                </span>
              </td>
              <td>{formatDate(item.updatedAt)}</td>
              <td>
                {item.alertCount > 0 ? (
                  <span
                    className="alert-badge"
                    title={item.alertsSummary ?? 'Alertas de qualidade'}
                  >
                    {item.alertCount}
                  </span>
                ) : (
                  <span aria-label="Sem alertas">—</span>
                )}
              </td>
              <td>
                <ActionLink
                  href={`/projects/${encodeURIComponent(item.projectId)}?returnTo=${encodeURIComponent(returnTo)}`}
                >
                  Abrir
                </ActionLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({ query, totalPages }: { query: PortfolioQuery; totalPages: number }) {
  if (totalPages <= 1) return null;
  const previous = query.page > 1 ? { ...query, page: query.page - 1 } : null;
  const next = query.page < totalPages ? { ...query, page: query.page + 1 } : null;
  return (
    <nav className="pagination" aria-label="Paginação de projetos">
      <Button type="button" disabled={!previous} onClick={() => previous && updateQuery(previous)}>
        Anterior
      </Button>
      <span aria-live="polite">
        Página {query.page} de {totalPages}
      </span>
      <Button type="button" disabled={!next} onClick={() => next && updateQuery(next)}>
        Próxima
      </Button>
    </nav>
  );
}

export function ProjectsPage({ search }: { readonly search: string }) {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth0();
  const { refresh } = useAuthorization();
  const query = useMemo(() => readPortfolioQuery(search), [search]);
  const queryKey = serializePortfolioQuery(query);
  const [retry, setRetry] = useState(0);
  const requestKey = `${queryKey}|${retry}`;
  const [searchInputState, setSearchInputState] = useState({
    key: queryKey,
    value: query.search ?? '',
  });
  const [state, setState] = useState<LoadState>({ key: '', kind: 'loading' });
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

  const searchInput =
    searchInputState.key === queryKey ? searchInputState.value : (query.search ?? '');

  useEffect(() => {
    let cancelled = false;
    if (!apiClient) {
      return () => {
        cancelled = true;
      };
    }
    const params = serializePortfolioQuery(query);
    void apiClient
      .getJson<unknown>(`/projects${params ? `?${params}` : ''}`)
      .then((response) => {
        if (!cancelled) {
          setState({
            key: requestKey,
            kind: 'success',
            response: parsePortfolioResponse(response),
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ key: requestKey, kind: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, query, requestKey]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: PortfolioQuery = { ...query, page: 1 };
    if (searchInput.trim()) {
      updateQuery({ ...next, search: searchInput.trim() });
    } else {
      delete (next as { search?: string }).search;
      updateQuery(next);
    }
  }

  function changeStatus(value: string) {
    const next: PortfolioQuery = {
      ...query,
      ...(value ? { status: value as PortfolioStatus } : {}),
      page: 1,
    };
    if (!value) delete (next as { status?: PortfolioQuery['status'] }).status;
    updateQuery(next);
  }

  const visibleState: LoadState = !apiClient
    ? { key: requestKey, kind: 'error', error: new Error('P023_API_NOT_CONFIGURED') }
    : state.key === requestKey
      ? state
      : { key: requestKey, kind: 'loading' };
  const pageTitle = 'Projetos';
  return (
    <>
      <PageHeader
        eyebrow="Portfólio operacional"
        title={pageTitle}
        titleId="projects-title"
        description="Consulte projetos autorizados, pesquise por código ou cliente e abra o contexto somente para leitura."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Início', href: '/' },
              { label: pageTitle, current: true },
            ]}
          />
        }
        actions={
          <PermissionGate capability="record:create">
            <ActionLink
              href={`/projects/new?returnTo=${encodeURIComponent(typeof window === 'undefined' ? '/projects' : `${window.location.pathname}${window.location.search}`)}`}
              variant="primary"
            >
              Novo projeto
            </ActionLink>
          </PermissionGate>
        }
      />

      <form className="portfolio-filters" onSubmit={submitSearch} aria-label="Filtros de projetos">
        <Field id="project-search" label="Buscar" help="Código do projeto ou nome do cliente.">
          <Input
            value={searchInput}
            onChange={(event) => setSearchInputState({ key: queryKey, value: event.target.value })}
            placeholder="Código ou cliente"
          />
        </Field>
        <Field id="project-status" label="Status">
          <Select value={query.status ?? ''} onChange={(event) => changeStatus(event.target.value)}>
            <option value="">Todos os status</option>
            {(['draft', 'active', 'on_hold', 'completed', 'cancelled'] as const).map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary">
          Buscar
        </Button>
      </form>

      {visibleState.kind === 'loading' ? (
        <p role="status" className="loading-state">
          Carregando projetos…
        </p>
      ) : null}
      {visibleState.kind === 'error' ? (
        <section className="error-panel" aria-labelledby="projects-error-title">
          <h2 id="projects-error-title">
            {visibleState.error instanceof AuthenticationRequiredError
              ? 'Sessão expirada'
              : visibleState.error instanceof AuthorizationDeniedError
                ? 'Acesso negado'
                : 'Não foi possível carregar os projetos'}
          </h2>
          <p>
            {visibleState.error instanceof AuthorizationDeniedError
              ? 'Seu perfil não possui acesso a esta lista.'
              : visibleState.error instanceof ApiRequestError
                ? 'A API recusou a consulta. Tente novamente.'
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
          ) : (
            <Button type="button" onClick={() => setRetry((value) => value + 1)}>
              Tentar novamente
            </Button>
          )}
        </section>
      ) : null}
      {visibleState.kind === 'success' && visibleState.response.totalItems === 0 ? (
        isFiltered(query) ? (
          <EmptyState
            title="Nenhum projeto encontrado"
            description="Ajuste a busca ou remova o filtro de status."
          />
        ) : (
          <EmptyState
            title="Nenhum projeto"
            description="Ainda não há projetos autorizados para exibir."
          />
        )
      ) : null}
      {visibleState.kind === 'success' && visibleState.response.totalItems > 0 ? (
        <>
          <p className="result-summary" role="status">
            {visibleState.response.totalItems} projeto
            {visibleState.response.totalItems === 1 ? '' : 's'} encontrado
            {visibleState.response.totalItems === 1 ? '' : 's'}.
            {query.sort !== DEFAULT_PORTFOLIO_QUERY.sort ||
            query.order !== DEFAULT_PORTFOLIO_QUERY.order
              ? ` Ordenado por ${sortLabel(query.sort)}.`
              : ''}
          </p>
          <ProjectTable items={visibleState.response.items} query={query} />
          <Pagination query={query} totalPages={visibleState.response.totalPages} />
        </>
      ) : null}
    </>
  );
}
