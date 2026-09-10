import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

import { publicEnvironment } from '../app/environment';
import {
  ApiRequestError,
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  createAuthenticatedApiClient,
} from '../auth/api-client';
import { useAuthorization } from '../auth/authorization';
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
  formatQualityValue,
  parseQualityResponse,
  QUALITY_ORIGINS,
  QUALITY_RULES,
  qualitySeverityLabel,
  QUALITY_SEVERITIES,
  readQualityQuery,
  resolveQualityNavigation,
  serializeQualityQuery,
  type QualityFinding,
  type QualityQuery,
  type QualityRuleCode,
} from '../quality/quality';

type LoadState =
  | { readonly key: string; readonly kind: 'loading' }
  | {
      readonly key: string;
      readonly kind: 'success';
      readonly response: ReturnType<typeof parseQualityResponse>;
    }
  | { readonly key: string; readonly kind: 'error'; readonly error: unknown };

function updateQuery(query: QualityQuery) {
  const suffix = serializeQualityQuery(query);
  window.history.pushState({}, '', `${window.location.pathname}${suffix ? `?${suffix}` : ''}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function ruleLabel(rule: QualityRuleCode): string {
  return {
    PROJECT_VALUE_MISMATCH: 'Contrato x item',
    UNPLANNED_BALANCE: 'Saldo não programado',
    MISSING_REQUIRED_FIELD: 'Item incompleto',
    PROJECT_DATA_STALE: 'Projeto desatualizado',
    DUPLICATE_PROJECT_SOURCE_IDENTITY: 'Duplicidade de projeto',
    DUPLICATE_ITEM_SOURCE_IDENTITY: 'Duplicidade de item',
    GRAIN_MISMATCH: 'Moeda/unidade',
  }[rule];
}

function errorTitle(error: unknown): string {
  if (error instanceof AuthenticationRequiredError) return 'Sessão expirada';
  if (error instanceof AuthorizationDeniedError) return 'Acesso negado';
  return 'Não foi possível carregar a central de qualidade';
}

function FindingRow({ finding }: { readonly finding: QualityFinding }) {
  const returnTo =
    typeof window === 'undefined'
      ? '/quality'
      : `${window.location.pathname}${window.location.search}`;
  const href = resolveQualityNavigation(finding.navigationAction, returnTo);
  return (
    <tr>
      <th scope="row">
        <strong>{finding.project.code ?? finding.project.id}</strong>
        <span className="quality-project-name">{finding.project.name}</span>
      </th>
      <td>
        <span className={`quality-severity quality-severity-${finding.severity.toLowerCase()}`}>
          {qualitySeverityLabel(finding.severity)}
        </span>
      </td>
      <td>
        <strong>{finding.rule.label}</strong>
        <span className="quality-rule-code">{finding.rule.code}</span>
      </td>
      <td>{formatQualityValue(finding.expectedValue, finding.currencyCode)}</td>
      <td>{formatQualityValue(finding.observedValue, finding.currencyCode)}</td>
      <td>{formatQualityValue(finding.delta, finding.currencyCode)}</td>
      <td>
        <span>{finding.origin.entity}</span>
        {finding.origin.findingOrigin ? (
          <span className="quality-rule-code">{finding.origin.findingOrigin}</span>
        ) : null}
      </td>
      <td>{href ? <ActionLink href={href}>Abrir</ActionLink> : <span>Ação indisponível</span>}</td>
    </tr>
  );
}

function Pagination({
  query,
  totalPages,
}: {
  readonly query: QualityQuery;
  readonly totalPages: number;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Paginação de inconsistências">
      <Button
        disabled={query.page <= 1}
        onClick={() => updateQuery({ ...query, page: query.page - 1 })}
      >
        Anterior
      </Button>
      <span aria-live="polite">
        Página {query.page} de {totalPages}
      </span>
      <Button
        disabled={query.page >= totalPages}
        onClick={() => updateQuery({ ...query, page: query.page + 1 })}
      >
        Próxima
      </Button>
    </nav>
  );
}

export function QualityPage({ search }: { readonly search: string }) {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth0();
  const { refresh } = useAuthorization();
  const query = useMemo(() => readQualityQuery(search), [search]);
  const queryKey = serializeQualityQuery(query);
  const [input, setInput] = useState(query.search ?? '');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<LoadState>({ key: '', kind: 'loading' });
  const audience = publicEnvironment.auth0?.audience;
  const client = useMemo(
    () =>
      audience
        ? createAuthenticatedApiClient({
            baseUrl: publicEnvironment.apiBaseUrl,
            audience,
            getAccessToken: () => getAccessTokenSilently({ authorizationParams: { audience } }),
          })
        : null,
    [audience, getAccessTokenSilently],
  );
  const requestKey = `${queryKey}|${retry}`;
  useEffect(() => {
    let cancelled = false;
    if (!client)
      return () => {
        cancelled = true;
      };
    void client
      .getJson<unknown>(`/quality/findings${queryKey ? `?${queryKey}` : ''}`)
      .then((value) => {
        if (!cancelled)
          setState({ key: requestKey, kind: 'success', response: parseQualityResponse(value) });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ key: requestKey, kind: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [client, queryKey, requestKey]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = { ...query, page: 1 } as QualityQuery & { search?: string };
    if (input.trim()) next.search = input.trim();
    else delete next.search;
    updateQuery(next);
  }
  function select(field: 'rule' | 'severity' | 'origin', value: string) {
    const next = { ...query, page: 1 } as Record<string, unknown>;
    if (value) next[field] = value;
    else delete next[field];
    updateQuery(next as unknown as QualityQuery);
  }
  const visible: LoadState = !client
    ? { key: requestKey, kind: 'error', error: new Error('P034_API_NOT_CONFIGURED') }
    : state.key === requestKey
      ? state
      : { key: requestKey, kind: 'loading' };
  return (
    <>
      <PageHeader
        eyebrow="Observabilidade operacional"
        title="Qualidade de dados"
        titleId="quality-title"
        description="Inconsistências derivadas das fontes autorizadas, sem ações de correção nesta central."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Início', href: '/' },
              { label: 'Qualidade de dados', current: true },
            ]}
          />
        }
      />
      <form className="portfolio-filters" onSubmit={submit} aria-label="Filtros de qualidade">
        <Field id="quality-search" label="Buscar">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Projeto, regra ou origem"
          />
        </Field>
        <Field id="quality-rule" label="Regra">
          <Select value={query.rule ?? ''} onChange={(event) => select('rule', event.target.value)}>
            <option value="">Todas</option>
            {QUALITY_RULES.map((rule) => (
              <option key={rule} value={rule}>
                {ruleLabel(rule)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="quality-severity" label="Severidade">
          <Select
            value={query.severity ?? ''}
            onChange={(event) => select('severity', event.target.value)}
          >
            <option value="">Todas</option>
            {QUALITY_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {qualitySeverityLabel(severity)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="quality-origin" label="Origem">
          <Select
            value={query.origin ?? ''}
            onChange={(event) => select('origin', event.target.value)}
          >
            <option value="">Todas</option>
            {QUALITY_ORIGINS.map((origin) => (
              <option key={origin} value={origin}>
                {origin}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary">
          Buscar
        </Button>
      </form>
      {visible.kind === 'loading' ? (
        <p role="status" className="loading-state">
          Carregando inconsistências…
        </p>
      ) : null}
      {visible.kind === 'error' ? (
        <section className="error-panel" aria-labelledby="quality-error-title">
          <h2 id="quality-error-title">{errorTitle(visible.error)}</h2>
          <p>
            {visible.error instanceof AuthorizationDeniedError
              ? 'Seu perfil não possui acesso a esta consulta.'
              : visible.error instanceof ApiRequestError
                ? 'A API recusou a consulta. Tente novamente.'
                : 'Tente novamente sem expor detalhes internos.'}
          </p>
          {visible.error instanceof AuthenticationRequiredError ? (
            <Button
              onClick={() =>
                void loginWithRedirect({
                  appState: { returnTo: `${window.location.pathname}${window.location.search}` },
                })
              }
            >
              Autenticar novamente
            </Button>
          ) : visible.error instanceof AuthorizationDeniedError ? (
            <Button onClick={refresh}>Tentar novamente</Button>
          ) : (
            <Button onClick={() => setRetry((value) => value + 1)}>Tentar novamente</Button>
          )}
        </section>
      ) : null}
      {visible.kind === 'success' && visible.response.totalItems === 0 ? (
        <EmptyState
          title="Nenhuma inconsistência encontrada"
          description="As fontes autorizadas não apresentam findings para os filtros informados."
        />
      ) : null}
      {visible.kind === 'success' && visible.response.totalItems > 0 ? (
        <>
          <p className="result-summary" role="status">
            {visible.response.totalItems} finding{visible.response.totalItems === 1 ? '' : 's'}{' '}
            encontrado{visible.response.totalItems === 1 ? '' : 's'}.
          </p>
          <div
            className="table-scroll"
            role="region"
            aria-label="Findings de qualidade"
            tabIndex={0}
          >
            <table className="project-table quality-table">
              <caption className="visually-hidden">Findings de qualidade de dados</caption>
              <thead>
                <tr>
                  <th scope="col">Projeto</th>
                  <th scope="col">Severidade</th>
                  <th scope="col">Regra</th>
                  <th scope="col">Esperado</th>
                  <th scope="col">Observado</th>
                  <th scope="col">Delta</th>
                  <th scope="col">Origem</th>
                  <th scope="col">Ação</th>
                </tr>
              </thead>
              <tbody>
                {visible.response.items.map((finding) => (
                  <FindingRow key={finding.id} finding={finding} />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination query={query} totalPages={visible.response.totalPages} />
        </>
      ) : null}
    </>
  );
}
