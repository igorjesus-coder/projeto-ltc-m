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
  addDistributionToValues,
  buildPlanningEntries,
  distributeBalance,
  moneyLabel,
  parsePercentage,
  P030_PERCENT_SCALE,
  parsePlanningEditorResponse,
  parsePlanningProjectsResponse,
  parsePlanningVersionsResponse,
  planningCellKey,
  signedDecimalToCents,
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
    if (error.code === 'P030_BALANCE_OVERRIDE_REQUIRED')
      return 'O excesso ultrapassa o valor contratual e exige a permissÃ£o de override de saldo.';
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
  const [selectedCells, setSelectedCells] = useState<ReadonlySet<string>>(new Set());
  const [weights, setWeights] = useState<Record<string, string>>({});
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
        setSelectedCells(new Set());
        setWeights({});
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
  const localFinancial = useMemo(() => {
    if (!data) return null;
    const contractValue = signedDecimalToCents(data.financial.contractValue) ?? 0n;
    const actualPosted = signedDecimalToCents(data.financial.actualPosted) ?? 0n;
    const plannedDraft = data.items.reduce(
      (total, item) =>
        total +
        data.competences.reduce(
          (itemTotal, competence) =>
            itemTotal +
            (decimalToCents(values[planningCellKey(item.itemId, competence.value)] ?? '') ?? 0n),
          0n,
        ),
      0n,
    );
    const rawBalance = contractValue - actualPosted - plannedDraft;
    return {
      contractValue,
      actualPosted,
      plannedDraft,
      rawBalance,
      distributableBalance: rawBalance > 0n ? rawBalance : 0n,
    };
  }, [data, values]);
  const distributionDestinations = useMemo(() => {
    if (!data) return [];
    return data.items.flatMap((item) =>
      data.competences.flatMap((competence) => {
        const key = planningCellKey(item.itemId, competence.value);
        return selectedCells.has(key)
          ? [{ itemId: item.itemId, competence: competence.value, key }]
          : [];
      }),
    );
  }, [data, selectedCells]);
  const distributionWeightTotal = useMemo(
    () =>
      distributionDestinations.reduce(
        (total, destination) => total + (parsePercentage(weights[destination.key] ?? '') ?? 0n),
        0n,
      ),
    [distributionDestinations, weights],
  );
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
  function toggleDistributionCell(key: string) {
    setSelectedCells((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function distribute() {
    if (!data || !localFinancial || !editable) return;
    if (localFinancial.rawBalance < 0n) {
      setNotice('Corrija o excesso antes de distribuir saldo.');
      return;
    }
    if (localFinancial.distributableBalance === 0n) {
      setNotice('Saldo totalmente programado.');
      return;
    }
    try {
      const allocations = distributeBalance(
        localFinancial.distributableBalance,
        distributionDestinations.map(({ itemId, competence, key }) => ({
          itemId,
          competence,
          weight: weights[key] ?? '',
        })),
      );
      setValues((current) => addDistributionToValues(current, allocations));
      setNotice(
        `Prévia criada: ${moneyLabel(localFinancial.distributableBalance, data.project.currencyCode)} distribuídos com residual reconciliado.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error && error.message === 'P030_PERCENT_TOTAL_INVALID'
          ? 'Os pesos devem totalizar exatamente 100,00%.'
          : 'Informe pesos percentuais válidos para as células selecionadas.',
      );
    }
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
      setSelectedCells(new Set());
      setWeights({});
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
          {localFinancial ? (
            <section className="planning-financial-summary" aria-label="Resumo financeiro">
              <h2>Resumo financeiro</h2>
              <dl>
                <div>
                  <dt>Valor contratual</dt>
                  <dd>{moneyLabel(localFinancial.contractValue, data.project.currencyCode)}</dd>
                </div>
                <div>
                  <dt>Faturado realizado</dt>
                  <dd>{moneyLabel(localFinancial.actualPosted, data.project.currencyCode)}</dd>
                </div>
                <div>
                  <dt>Programado no draft</dt>
                  <dd>{moneyLabel(localFinancial.plannedDraft, data.project.currencyCode)}</dd>
                </div>
                <div>
                  <dt>Saldo</dt>
                  <dd>{moneyLabel(localFinancial.rawBalance, data.project.currencyCode)}</dd>
                </div>
              </dl>
              {localFinancial.rawBalance > 0n ? (
                <p className="planning-warning" role="status">
                  Saldo não programado:{' '}
                  {moneyLabel(localFinancial.rawBalance, data.project.currencyCode)}. O salvamento
                  continua permitido.
                </p>
              ) : null}
              {localFinancial.rawBalance < 0n ? (
                <p className="planning-error" role="alert">
                  Excesso: {moneyLabel(-localFinancial.rawBalance, data.project.currencyCode)} acima
                  do contrato.
                  {!data.financial.canOverrideBalance
                    ? ' Permissão de override necessária para salvar.'
                    : ' Override disponível para este perfil.'}
                </p>
              ) : null}
              {localFinancial.rawBalance === 0n ? (
                <p role="status">Saldo totalmente programado.</p>
              ) : null}
            </section>
          ) : null}
          {editable ? (
            <section className="planning-distribution-panel" aria-labelledby="distribution-title">
              <h2 id="distribution-title">Distribuir saldo</h2>
              <p>
                Selecione as células, informe pesos que totalizem 100,00% e revise a prévia antes de
                salvar.
              </p>
              {localFinancial ? (
                <dl className="planning-distribution-summary">
                  <div>
                    <dt>Saldo alvo</dt>
                    <dd>
                      {moneyLabel(localFinancial.distributableBalance, data.project.currencyCode)}
                    </dd>
                  </div>
                  <div>
                    <dt>Soma dos pesos</dt>
                    <dd>
                      {(distributionWeightTotal / P030_PERCENT_SCALE).toString()}.
                      {(distributionWeightTotal % P030_PERCENT_SCALE).toString().padStart(4, '0')}%
                    </dd>
                  </div>
                </dl>
              ) : null}
              {distributionDestinations.length > 0 ? (
                <div className="planning-distribution-targets">
                  {distributionDestinations.map(({ itemId, competence, key }) => {
                    const item = data.items.find((candidate) => candidate.itemId === itemId);
                    return (
                      <Field
                        key={key}
                        id={`weight-${itemId}-${competence}`}
                        label={`${item?.itemCode ?? item?.lineNumber ?? itemId} ${competence}`}
                      >
                        <Input
                          value={weights[key] ?? ''}
                          inputMode="decimal"
                          placeholder="Peso %"
                          onChange={(event) =>
                            setWeights((current) => ({ ...current, [key]: event.target.value }))
                          }
                          disabled={pending}
                        />
                      </Field>
                    );
                  })}
                </div>
              ) : (
                <p className="field-help">Nenhuma célula selecionada.</p>
              )}
              <Button
                type="button"
                onClick={distribute}
                disabled={pending || distributionDestinations.length === 0}
              >
                Distribuir saldo
              </Button>
            </section>
          ) : null}
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
                              <label className="planning-cell-selection">
                                <input
                                  type="checkbox"
                                  aria-label={`Selecionar ${item.itemCode || `linha ${item.lineNumber}`} ${competence.label}`}
                                  checked={selectedCells.has(key)}
                                  onChange={() => toggleDistributionCell(key)}
                                  disabled={!editable || !item.active || pending}
                                />
                                <span className="visually-hidden">
                                  Selecionar para distribuição
                                </span>
                              </label>
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
