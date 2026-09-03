import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
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
  Textarea,
} from '../components/design-system';
import {
  decimalToCents,
  buildPlanningEntries,
  moneyLabel,
  parsePlanningEditorResponse,
  parsePlanningProjectsResponse,
  parsePlanningVersionsResponse,
  planningCellKey,
  type PlanningEditorResponse,
  type PlanningProjectOption,
  type PlanningVersionOption,
} from '../planning/planning';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'success'; readonly data: PlanningEditorResponse }
  | { readonly kind: 'error'; readonly error: unknown };

function errorLabel(error: unknown): string {
  if (error instanceof AuthenticationRequiredError)
    return 'Sessão expirada. Autentique-se novamente.';
  if (error instanceof AuthorizationDeniedError) return 'Seu perfil não possui esta permissão.';
  if (error instanceof ApiRequestError) {
    if (error.code === 'P029_VERSION_CONFLICT' || error.code === 'P029_BATCH_CONFLICT')
      return 'A versão foi alterada por outra pessoa. Recarregue o editor antes de salvar.';
    if (error.code === 'P029_VERSION_NOT_EDITABLE') return 'Esta versão não está editável.';
    if (error.code === 'P029_BASELINE_IMMUTABLE')
      return 'Este baseline importado é imutável e não pode ser editado neste fluxo.';
  }
  return 'Não foi possível carregar ou salvar o planejamento.';
}

function monthPart(value: string | null): string {
  return value ? value.slice(0, 7) : '';
}
function monthDate(value: string): string {
  return `${value}-01`;
}
function mapValues(data: PlanningEditorResponse): Record<string, string> {
  return Object.fromEntries(
    data.entries.map((entry) => [planningCellKey(entry.itemId, entry.competence), entry.amount]),
  );
}
function totalForCompetence(
  data: PlanningEditorResponse,
  values: Record<string, string>,
  competence: string,
): bigint {
  return data.items.reduce(
    (total, item) =>
      total + (decimalToCents(values[planningCellKey(item.itemId, competence)] ?? '') ?? 0n),
    0n,
  );
}
function differenceForCell(
  original: Record<string, string>,
  values: Record<string, string>,
  itemId: string,
  competence: string,
): bigint {
  return (
    (decimalToCents(values[planningCellKey(itemId, competence)] ?? '') ?? 0n) -
    (decimalToCents(original[planningCellKey(itemId, competence)] ?? '') ?? 0n)
  );
}

export function MonthlyPlanningPage() {
  const { getAccessTokenSilently } = useAuth0();
  const { can } = useAuthorization();
  const [projects, setProjects] = useState<readonly PlanningProjectOption[]>([]);
  const [versions, setVersions] = useState<readonly PlanningVersionOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [appliedRange, setAppliedRange] = useState({ from: '', to: '' });
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [view, setView] = useState<'item' | 'project'>('item');
  const [justification, setJustification] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const auth0Audience = publicEnvironment.auth0?.audience;
  const apiClient = useMemo(
    () =>
      auth0Audience
        ? createAuthenticatedApiClient({
            baseUrl: publicEnvironment.apiBaseUrl,
            audience: auth0Audience,
            getAccessToken: () =>
              getAccessTokenSilently({ authorizationParams: { audience: auth0Audience } }),
          })
        : null,
    [auth0Audience, getAccessTokenSilently],
  );

  useEffect(() => {
    if (!apiClient) return undefined;
    let cancelled = false;
    void apiClient
      .getJson<unknown>('/planning/projects')
      .then((response) => {
        if (cancelled) return;
        const parsed = parsePlanningProjectsResponse(response);
        setProjects(parsed.projects);
        setProjectId(parsed.projects[0]?.projectId ?? '');
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  useEffect(() => {
    if (!apiClient || !projectId) return undefined;
    let cancelled = false;
    void apiClient
      .getJson<unknown>(`/planning/projects/${encodeURIComponent(projectId)}/versions`)
      .then((response) => {
        if (cancelled) return;
        const parsed = parsePlanningVersionsResponse(response);
        setVersions(parsed.versions);
        setVersionId(parsed.versions[0]?.versionId ?? '');
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, projectId]);

  useEffect(() => {
    if (!apiClient || !projectId || !versionId) return undefined;
    let cancelled = false;
    const params = new URLSearchParams();
    if (appliedRange.from) params.set('from', monthDate(appliedRange.from));
    if (appliedRange.to) params.set('to', monthDate(appliedRange.to));
    const suffix = params.size ? `&${params.toString()}` : '';
    void apiClient
      .getJson<unknown>(
        `/planning/projects/${encodeURIComponent(projectId)}/editor?versionId=${encodeURIComponent(versionId)}${suffix}`,
      )
      .then((response) => {
        if (cancelled) return;
        const parsed = parsePlanningEditorResponse(response);
        const nextValues = mapValues(parsed);
        setState({ kind: 'success', data: parsed });
        setValues(nextValues);
        setOriginal(nextValues);
        setRange({ from: monthPart(parsed.range.from), to: monthPart(parsed.range.to) });
        setNotice(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, projectId, versionId, appliedRange]);

  const data = state.kind === 'success' ? state.data : null;
  const dirty = Boolean(
    data &&
    data.items.some((item) =>
      data.competences.some(
        (competence) =>
          (values[planningCellKey(item.itemId, competence.value)] ?? '') !==
          (original[planningCellKey(item.itemId, competence.value)] ?? ''),
      ),
    ),
  );
  const selectedVersion = versions.find((item) => item.versionId === versionId);
  const editable = Boolean(data?.version.editable && can('forecast:edit_draft'));
  function confirmDiscard(): boolean {
    return !dirty || window.confirm('Há alterações não salvas. Deseja descartá-las?');
  }
  function changeProject(event: ChangeEvent<HTMLSelectElement>) {
    if (!confirmDiscard()) return;
    setProjectId(event.target.value);
    setValues({});
    setOriginal({});
  }
  function changeVersion(event: ChangeEvent<HTMLSelectElement>) {
    if (!confirmDiscard()) return;
    setVersionId(event.target.value);
    setValues({});
    setOriginal({});
  }
  function applyRange() {
    if (!range.from || !range.to || range.from > range.to) {
      setNotice('Informe um intervalo mensal válido.');
      return;
    }
    if (!confirmDiscard()) return;
    setNotice(null);
    setAppliedRange(range);
  }
  async function save() {
    if (!apiClient || !data || !editable) return;
    if (!justification.trim()) {
      setNotice('Informe uma justificativa para salvar as alterações.');
      return;
    }
    const entries = buildPlanningEntries(data, values, original);
    if (entries.some((entry) => !entry.amount)) {
      setNotice('Células alteradas devem conter um valor decimal; use 0.00 para zerar.');
      return;
    }
    if (entries.length === 0) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await apiClient.sendJson<unknown>(
        `/planning/projects/${encodeURIComponent(data.project.projectId)}/versions/${encodeURIComponent(data.version.versionId)}/months`,
        'PUT',
        {
          expectedVersion: data.version.contentRevision,
          justification: justification.trim(),
          entries,
        },
      );
      const parsed = parsePlanningEditorResponse(response);
      const nextValues = mapValues(parsed);
      setState({ kind: 'success', data: parsed });
      setValues(nextValues);
      setOriginal(nextValues);
      setJustification('');
      setNotice('Planejamento mensal salvo.');
    } catch (error) {
      setNotice(errorLabel(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Previsão mensal"
        title="Editor de programação mensal"
        titleId="monthly-planning-title"
        description="Edite várias competências de uma versão draft em uma única operação atômica."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Início', href: '/' },
              { label: 'Planejamento mensal', current: true },
            ]}
          />
        }
      />
      <section className="planning-controls" aria-label="Seleção do planejamento">
        <Field id="planning-project" label="Projeto" required>
          <Select value={projectId} onChange={changeProject} disabled={pending}>
            <option value="">Selecione</option>
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.code} — {project.name} ({project.currencyCode})
              </option>
            ))}
          </Select>
        </Field>
        <Field id="planning-version" label="Versão" required>
          <Select
            value={versionId}
            onChange={changeVersion}
            disabled={pending || versions.length === 0}
          >
            <option value="">Selecione</option>
            {versions.map((version) => (
              <option key={version.versionId} value={version.versionId}>
                {version.name} — {version.status}
                {version.editable ? '' : ' (somente leitura)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="planning-from"
          label="De (mês)"
          help="Use quando a versão ainda não possuir competências"
        >
          <Input
            type="month"
            value={range.from}
            onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))}
          />
        </Field>
        <Field id="planning-to" label="Até (mês)">
          <Input
            type="month"
            value={range.to}
            onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
          />
        </Field>
        <Button type="button" onClick={applyRange} disabled={!projectId || !versionId || pending}>
          Aplicar período
        </Button>
      </section>
      {state.kind === 'loading' ? (
        <p role="status" className="loading-state">
          Carregando planejamento…
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <section className="error-panel" aria-labelledby="planning-error-title">
          <h2 id="planning-error-title">Não foi possível carregar o planejamento</h2>
          <p>{errorLabel(state.error)}</p>
          <Button type="button" onClick={() => setAppliedRange((value) => ({ ...value }))}>
            Tentar novamente
          </Button>
        </section>
      ) : null}
      {notice ? (
        <p className="planning-notice" role="status">
          {notice}
        </p>
      ) : null}
      {data && data.competences.length === 0 ? (
        <EmptyState
          title="Nenhuma competência disponível"
          description="Informe um período mensal ou carregue uma versão com competências existentes."
        />
      ) : null}
      {data && data.competences.length > 0 ? (
        <section className="monthly-planning-panel" aria-labelledby="planning-grid-title">
          <div className="planning-summary">
            <div>
              <strong>{data.project.code}</strong>
              <span>
                {data.project.name} · {data.project.currencyCode}
              </span>
            </div>
            <div>
              <strong>{data.version.name}</strong>
              <span>
                {data.version.status}
                {editable ? ' · editável' : ' · somente leitura'}
              </span>
            </div>
          </div>
          <div className="planning-view-switch" role="group" aria-label="Visão da grade">
            <Button
              type="button"
              variant={view === 'item' ? 'primary' : 'secondary'}
              aria-pressed={view === 'item'}
              onClick={() => setView('item')}
            >
              Itens
            </Button>
            <Button
              type="button"
              variant={view === 'project' ? 'primary' : 'secondary'}
              aria-pressed={view === 'project'}
              onClick={() => setView('project')}
            >
              Projeto
            </Button>
          </div>
          <h2 id="planning-grid-title" className="visually-hidden">
            Grade de planejamento mensal
          </h2>
          <div className="planning-table-wrap">
            <table className="planning-table">
              <caption>
                {view === 'item'
                  ? 'Planejamento mensal por item'
                  : 'Planejamento mensal agregado do projeto'}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{view === 'item' ? 'Item' : 'Projeto'}</th>
                  {data.competences.map((competence) => (
                    <th scope="col" key={competence.value}>
                      {competence.label}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                  <th scope="col">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {view === 'item' ? (
                  data.items.map((item) => {
                    const total = data.competences.reduce(
                      (sum, competence) =>
                        sum +
                        (decimalToCents(
                          values[planningCellKey(item.itemId, competence.value)] ?? '',
                        ) ?? 0n),
                      0n,
                    );
                    const difference = data.competences.reduce(
                      (sum, competence) =>
                        sum + differenceForCell(original, values, item.itemId, competence.value),
                      0n,
                    );
                    return (
                      <tr
                        key={item.itemId}
                        className={item.active ? undefined : 'planning-item-inactive'}
                      >
                        <th scope="row">
                          {item.itemCode || `Linha ${item.lineNumber}`}
                          <small>
                            {item.description || item.sourceLineKey}
                            {!item.active ? ' · inativo' : ''}
                          </small>
                        </th>
                        {data.competences.map((competence) => {
                          const key = planningCellKey(item.itemId, competence.value);
                          return (
                            <td key={key}>
                              <Input
                                aria-label={`${item.itemCode || `linha ${item.lineNumber}`} ${competence.label}`}
                                value={values[key] ?? ''}
                                disabled={!editable || !item.active || pending}
                                inputMode="decimal"
                                onChange={(event) =>
                                  setValues((current) => ({
                                    ...current,
                                    [key]: event.target.value,
                                  }))
                                }
                              />
                            </td>
                          );
                        })}
                        <td>{moneyLabel(total, data.project.currencyCode)}</td>
                        <td className={difference === 0n ? undefined : 'planning-difference'}>
                          {moneyLabel(difference, data.project.currencyCode)}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <th scope="row">Total do projeto</th>
                    {data.competences.map((competence) => (
                      <td key={competence.value}>
                        {moneyLabel(
                          totalForCompetence(data, values, competence.value),
                          data.project.currencyCode,
                        )}
                      </td>
                    ))}
                    <td>
                      {moneyLabel(
                        data.competences.reduce(
                          (sum, competence) =>
                            sum + totalForCompetence(data, values, competence.value),
                          0n,
                        ),
                        data.project.currencyCode,
                      )}
                    </td>
                    <td className="planning-difference">
                      {moneyLabel(
                        data.competences.reduce(
                          (sum, competence) =>
                            sum +
                            data.items.reduce(
                              (total, item) =>
                                total +
                                differenceForCell(original, values, item.itemId, competence.value),
                              0n,
                            ),
                          0n,
                        ),
                        data.project.currencyCode,
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="planning-save-area">
            <Field
              id="planning-justification"
              label="Justificativa"
              help="Obrigatória; será anexada à auditoria das alterações"
              required
            >
              <Textarea
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                maxLength={2000}
                disabled={!editable || pending}
              />
            </Field>
            <Button
              type="button"
              variant="primary"
              onClick={() => void save()}
              disabled={!editable || !dirty || !justification.trim() || pending}
            >
              Salvar alterações
            </Button>
            {!editable ? (
              <p className="field-help">A versão ou sua permissão não permite edição.</p>
            ) : null}
          </div>
        </section>
      ) : null}
      {state.kind === 'success' && data && data.items.length === 0 ? (
        <EmptyState
          title="Nenhum item elegível"
          description="O projeto não possui itens para exibir neste planejamento."
          action={<ActionLink href="/projects">Voltar para projetos</ActionLink>}
        />
      ) : null}
      {selectedVersion && !selectedVersion.editable ? (
        <p className="field-help">
          Versões aprovadas, bloqueadas e arquivadas permanecem disponíveis para consulta.
        </p>
      ) : null}
    </>
  );
}
