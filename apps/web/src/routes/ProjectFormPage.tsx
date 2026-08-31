import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

import { publicEnvironment } from '../app/environment';
import {
  ApiRequestError,
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  createAuthenticatedApiClient,
} from '../auth/api-client';
import { getSafeReturnTo } from '../auth/navigation';
import { useAuthorization } from '../auth/authorization';
import {
  ActionLink,
  Breadcrumbs,
  Button,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../components/design-system';
import { formatDate, formatMoney, statusLabel } from '../projects/project-portfolio';
import {
  CLASSIFICATION_LABELS,
  parseProjectOptions,
  parseProjectWriteResponse,
  PROJECT_CLASSIFICATIONS,
  type ProjectClassification,
  type ProjectOptionsResponse,
  type ProjectWriteResponse,
} from '../projects/project-create-edit';

interface FormValues {
  projectCode: string;
  projectName: string;
  clientId: string;
  reportingGroup: string;
  classification: string;
  status: string;
  contractValue: string;
  openingBalance: string;
  budgetCost: string;
  startDate: string;
  endDate: string;
  dataReferenceDate: string;
  notes: string;
}

type FormErrors = { [K in keyof FormValues]?: string | undefined } & {
  form?: string | undefined;
};
type LoadState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly options: ProjectOptionsResponse;
      readonly project?: ProjectWriteResponse;
    }
  | { readonly kind: 'error'; readonly error: unknown };

const EMPTY_VALUES: FormValues = {
  projectCode: '',
  projectName: '',
  clientId: '',
  reportingGroup: '',
  classification: '',
  status: 'active',
  contractValue: '',
  openingBalance: '',
  budgetCost: '',
  startDate: '',
  endDate: '',
  dataReferenceDate: '',
  notes: '',
};

function returnPath(search: string): string {
  const value = new URLSearchParams(search).get('returnTo');
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  return getSafeReturnTo(value ?? '/projects', origin);
}

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function valuesFromProject(project: ProjectWriteResponse): FormValues {
  return {
    projectCode: project.projectCode,
    projectName: project.projectName,
    clientId: project.client.id,
    reportingGroup: project.reportingGroup ?? '',
    classification: project.classification,
    status: project.status,
    contractValue: project.contractValue,
    openingBalance: project.openingBalance ?? '',
    budgetCost: project.budgetCost ?? '',
    startDate: project.startDate ?? '',
    endDate: project.endDate ?? '',
    dataReferenceDate: project.dataReferenceDate ?? '',
    notes: project.notes ?? '',
  };
}

function nullable(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

function validateDecimal(value: string, required: boolean): string | undefined {
  const normalized = value.trim();
  if (!normalized) return required ? 'Informe um valor.' : undefined;
  const integerPart = normalized.split('.')[0] ?? '';
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/u.test(normalized) || integerPart.length > 18) {
    return 'Use um número não negativo com até duas casas decimais.';
  }
  return undefined;
}

function validateDate(value: string, required: boolean): string | undefined {
  const normalized = value.trim();
  if (!normalized) return required ? 'Informe uma data.' : undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return 'Use o formato AAAA-MM-DD.';
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== normalized) {
    return 'Informe uma data válida.';
  }
  return undefined;
}

function validate(values: FormValues, editor: boolean): FormErrors {
  const errors: FormErrors = {};
  if (!values.projectCode.trim()) errors.projectCode = 'Informe o código do projeto.';
  if (!values.projectName.trim()) errors.projectName = 'Informe o nome do projeto.';
  if (!values.clientId) errors.clientId = 'Selecione um cliente ativo.';
  if (!values.classification) errors.classification = 'Selecione uma classificação.';
  if (!PROJECT_CLASSIFICATIONS.includes(values.classification as ProjectClassification)) {
    errors.classification = 'Classificação inválida.';
  }
  if (editor && values.status !== 'active')
    errors.status = 'Editor só pode manter projetos ativos.';
  errors.contractValue = validateDecimal(values.contractValue, true);
  errors.openingBalance = validateDecimal(values.openingBalance, false);
  errors.budgetCost = validateDecimal(values.budgetCost, false);
  errors.startDate = validateDate(values.startDate, false);
  errors.endDate = validateDate(values.endDate, false);
  errors.dataReferenceDate = validateDate(values.dataReferenceDate, true);
  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    errors.endDate = 'A data final não pode anteceder a data inicial.';
  }
  for (const key of Object.keys(errors) as Array<keyof FormErrors>) {
    if (!errors[key]) delete errors[key];
  }
  return errors;
}

function fieldValue(
  event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
) {
  return event.target.value;
}

function errorMessage(error: unknown): string {
  if (error instanceof AuthenticationRequiredError)
    return 'Sua sessão expirou. Autentique-se novamente.';
  if (error instanceof AuthorizationDeniedError)
    return 'Seu perfil não possui permissão para esta operação.';
  if (error instanceof ApiRequestError) {
    return (
      {
        P024_PROJECT_CODE_CONFLICT: 'Já existe um projeto ativo com este código.',
        P024_VERSION_CONFLICT:
          'O projeto foi alterado por outra pessoa. Recarregue e tente novamente.',
        P024_CLIENT_UNAVAILABLE: 'Selecione um cliente ativo.',
        P024_PROJECT_NOT_FOUND: 'Projeto não encontrado.',
        P024_IMMUTABLE_FIELD: 'O campo informado não pode ser alterado.',
      }[error.code ?? ''] ?? 'A API recusou a operação. Revise os campos e tente novamente.'
    );
  }
  return 'Não foi possível concluir a operação. Tente novamente sem expor detalhes internos.';
}

export function ProjectFormPage({
  mode,
  projectId,
  search,
}: {
  readonly mode: 'create' | 'edit';
  readonly projectId?: string;
  readonly search: string;
}) {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth0();
  const { profile, refresh } = useAuthorization();
  const editor = profile?.role === 'editor';
  const canWrite = Boolean(
    profile?.capabilities.includes(mode === 'create' ? 'record:create' : 'record:edit_draft'),
  );
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [initialValues, setInitialValues] = useState<FormValues>(EMPTY_VALUES);
  const [version, setVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);
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
      queueMicrotask(() => {
        if (!cancelled) setState({ kind: 'error', error: new Error('P024_API_NOT_CONFIGURED') });
      });
      return () => {
        cancelled = true;
      };
    }
    const request: Promise<{
      readonly options: ProjectOptionsResponse;
      readonly project?: ProjectWriteResponse;
    }> =
      mode === 'edit' && projectId
        ? Promise.all([
            apiClient.getJson<unknown>('/projects/options'),
            apiClient.getJson<unknown>(`/projects/${encodeURIComponent(projectId)}/edit`),
          ]).then(([optionResponse, projectResponse]) => ({
            options: parseProjectOptions(optionResponse),
            project: parseProjectWriteResponse(projectResponse),
          }))
        : apiClient.getJson<unknown>('/projects/options').then((optionResponse) => ({
            options: parseProjectOptions(optionResponse),
          }));
    void request
      .then(({ options, project }) => {
        if (cancelled) return;
        const nextValues = project
          ? valuesFromProject(project)
          : { ...EMPTY_VALUES, status: editor ? 'active' : 'draft' };
        setState({ kind: 'ready', options, ...(project ? { project } : {}) });
        setValues(nextValues);
        setInitialValues(nextValues);
        setVersion(project?.version ?? null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, editor, mode, projectId]);

  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  function update(field: keyof FormValues, next: string) {
    setValues((current) => ({ ...current, [field]: next }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(values, editor);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    if (!apiClient || !canWrite || (mode === 'edit' && version === null)) return;
    setPending(true);
    setErrors({});
    try {
      if (mode === 'create') {
        const response = await apiClient.sendJson<unknown>('/projects', 'POST', {
          projectCode: values.projectCode.trim(),
          projectName: values.projectName.trim(),
          clientId: values.clientId,
          reportingGroup: nullable(values.reportingGroup),
          classification: values.classification,
          status: editor ? 'active' : values.status,
          contractValue: values.contractValue.trim(),
          openingBalance: nullable(values.openingBalance),
          budgetCost: nullable(values.budgetCost),
          startDate: nullable(values.startDate),
          endDate: nullable(values.endDate),
          dataReferenceDate: values.dataReferenceDate.trim(),
          notes: nullable(values.notes),
        });
        const project = parseProjectWriteResponse(response);
        navigate(
          `/projects/${encodeURIComponent(project.projectId)}?returnTo=${encodeURIComponent(returnPath(search))}`,
        );
      } else {
        const patch: Record<string, unknown> = { expectedVersion: version };
        const fields: Array<keyof FormValues> = [
          'projectName',
          'clientId',
          'reportingGroup',
          'classification',
          'status',
          'contractValue',
          'openingBalance',
          'budgetCost',
          'startDate',
          'endDate',
          'dataReferenceDate',
          'notes',
        ];
        for (const field of fields) {
          if (values[field] === initialValues[field]) continue;
          patch[field] = [
            'reportingGroup',
            'openingBalance',
            'budgetCost',
            'startDate',
            'endDate',
            'notes',
          ].includes(field)
            ? nullable(values[field])
            : values[field].trim();
        }
        const response = await apiClient.sendJson<unknown>(
          `/projects/${encodeURIComponent(projectId ?? '')}`,
          'PATCH',
          patch,
        );
        const project = parseProjectWriteResponse(response);
        setValues(valuesFromProject(project));
        setInitialValues(valuesFromProject(project));
        setVersion(project.version);
        navigate(
          `/projects/${encodeURIComponent(project.projectId)}?returnTo=${encodeURIComponent(returnPath(search))}`,
        );
      }
    } catch (error: unknown) {
      setErrors({ form: errorMessage(error) });
      if (error instanceof AuthorizationDeniedError) refresh();
    } finally {
      setPending(false);
    }
  }

  const title = mode === 'create' ? 'Novo projeto' : 'Editar projeto';
  const currentProject = state.kind === 'ready' ? state.project : undefined;
  const currentClientUnavailable = Boolean(currentProject && !currentProject.client.available);
  return (
    <>
      <PageHeader
        eyebrow="Cadastro operacional"
        title={title}
        titleId="project-form-title"
        description="Campos financeiros são registrados com precisão decimal; dados calculados permanecem somente leitura."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Início', href: '/' },
              { label: 'Projetos', href: returnPath(search) },
              { label: title, current: true },
            ]}
          />
        }
      />
      {state.kind === 'loading' ? <p role="status">Carregando formulário…</p> : null}
      {state.kind === 'error' ? (
        <section className="error-panel" aria-labelledby="project-form-error-title">
          <h2 id="project-form-error-title">
            {state.error instanceof AuthenticationRequiredError
              ? 'Sessão expirada'
              : state.error instanceof AuthorizationDeniedError
                ? 'Acesso negado'
                : state.error instanceof ApiRequestError && state.error.status === 404
                  ? 'Projeto não encontrado'
                  : 'Não foi possível carregar o formulário'}
          </h2>
          <p>{errorMessage(state.error)}</p>
          {state.error instanceof AuthenticationRequiredError ? (
            <Button
              type="button"
              onClick={() =>
                void loginWithRedirect({
                  appState: { returnTo: window.location.pathname + window.location.search },
                })
              }
            >
              Autenticar novamente
            </Button>
          ) : state.error instanceof AuthorizationDeniedError ? (
            <Button type="button" onClick={refresh}>
              Tentar novamente
            </Button>
          ) : (
            <ActionLink href={returnPath(search)}>Voltar para projetos</ActionLink>
          )}
        </section>
      ) : null}
      {state.kind === 'ready' ? (
        <form
          className="project-form"
          onSubmit={submit}
          noValidate
          aria-labelledby="project-form-title"
        >
          {errors.form ? (
            <p className="form-error-summary" role="alert" tabIndex={-1}>
              {errors.form}
            </p>
          ) : null}
          {!canWrite ? (
            <p className="form-notice" role="status">
              Seu perfil pode consultar, mas não editar este cadastro.
            </p>
          ) : null}
          <div className="project-form-grid">
            <Field id="project-code" label="Código" required error={errors.projectCode}>
              <Input
                id="project-code"
                value={values.projectCode}
                readOnly={mode === 'edit'}
                onChange={(event) => update('projectCode', fieldValue(event))}
              />
            </Field>
            <Field id="project-name" label="Nome" required error={errors.projectName}>
              <Input
                id="project-name"
                value={values.projectName}
                onChange={(event) => update('projectName', fieldValue(event))}
              />
            </Field>
            <Field
              id="project-client"
              label="Cliente"
              required
              error={errors.clientId}
              help={
                currentClientUnavailable
                  ? 'O vínculo atual exige remediação administrativa; selecione outro cliente ativo para alterá-lo.'
                  : undefined
              }
            >
              {currentClientUnavailable ? (
                <p className="field-help">
                  Vínculo atual: {currentProject?.client.displayName} (indisponível)
                </p>
              ) : null}
              <Select
                id="project-client"
                value={currentClientUnavailable ? '' : values.clientId}
                onChange={(event) => update('clientId', fieldValue(event))}
              >
                <option value="">Selecione um cliente ativo</option>
                {state.options.clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="project-reporting-group" label="Grupo de reporte">
              <Input
                id="project-reporting-group"
                value={values.reportingGroup}
                onChange={(event) => update('reportingGroup', fieldValue(event))}
              />
            </Field>
            <Field
              id="project-classification"
              label="Classificação"
              required
              error={errors.classification}
            >
              <Select
                id="project-classification"
                value={values.classification}
                onChange={(event) => update('classification', fieldValue(event))}
              >
                <option value="">Selecione uma classificação</option>
                {PROJECT_CLASSIFICATIONS.map((classification) => (
                  <option key={classification} value={classification}>
                    {CLASSIFICATION_LABELS[classification]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="project-status" label="Status" required error={errors.status}>
              {editor ? (
                <Input id="project-status" value="Ativo" readOnly />
              ) : (
                <Select
                  id="project-status"
                  value={values.status}
                  onChange={(event) => update('status', fieldValue(event))}
                >
                  {(['draft', 'active', 'on_hold', 'completed', 'cancelled'] as const).map(
                    (status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ),
                  )}
                </Select>
              )}
            </Field>
            <Field
              id="project-currency"
              label="Moeda"
              help="Baseline P024: moeda única BRL, sem conversão cambial."
            >
              <Input id="project-currency" value="BRL" readOnly />
            </Field>
            <Field
              id="project-contract-value"
              label="Valor contratual"
              required
              error={errors.contractValue}
            >
              <Input
                id="project-contract-value"
                inputMode="decimal"
                value={values.contractValue}
                onChange={(event) => update('contractValue', fieldValue(event))}
              />
            </Field>
            <Field
              id="project-opening-balance"
              label="Saldo de abertura"
              error={errors.openingBalance}
            >
              <Input
                id="project-opening-balance"
                inputMode="decimal"
                value={values.openingBalance}
                onChange={(event) => update('openingBalance', fieldValue(event))}
              />
            </Field>
            <Field id="project-budget-cost" label="Custo orçado" error={errors.budgetCost}>
              <Input
                id="project-budget-cost"
                inputMode="decimal"
                value={values.budgetCost}
                onChange={(event) => update('budgetCost', fieldValue(event))}
              />
            </Field>
            <Field id="project-start-date" label="Data inicial" error={errors.startDate}>
              <Input
                id="project-start-date"
                type="date"
                value={values.startDate}
                onChange={(event) => update('startDate', fieldValue(event))}
              />
            </Field>
            <Field id="project-end-date" label="Data final" error={errors.endDate}>
              <Input
                id="project-end-date"
                type="date"
                value={values.endDate}
                onChange={(event) => update('endDate', fieldValue(event))}
              />
            </Field>
            <Field
              id="project-reference-date"
              label="Data de referência"
              required
              error={errors.dataReferenceDate}
            >
              <Input
                id="project-reference-date"
                type="date"
                value={values.dataReferenceDate}
                onChange={(event) => update('dataReferenceDate', fieldValue(event))}
              />
            </Field>
          </div>
          <Field id="project-notes" label="Observações">
            <Textarea
              id="project-notes"
              value={values.notes}
              onChange={(event) => update('notes', fieldValue(event))}
            />
          </Field>
          {currentProject ? (
            <section
              className="project-read-only-summary"
              aria-labelledby="project-read-only-title"
            >
              <h2 id="project-read-only-title">Informações factuais</h2>
              <p>
                Última atualização: {formatDate(currentProject.updatedAt)} · Versão{' '}
                {currentProject.version}
              </p>
              <p>
                Valor contratual:{' '}
                {formatMoney(currentProject.contractValue, currentProject.baseCurrency)}
              </p>
            </section>
          ) : null}
          {state.options.clients.length === 0 ? (
            <p className="form-notice">Nenhum cliente ativo disponível para vinculação.</p>
          ) : null}
          <div className="form-actions">
            <ActionLink href={returnPath(search)}>Cancelar</ActionLink>
            <Button
              type="submit"
              variant="primary"
              disabled={pending || !canWrite || state.options.clients.length === 0}
            >
              {pending ? 'Salvando…' : 'Salvar projeto'}
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}
