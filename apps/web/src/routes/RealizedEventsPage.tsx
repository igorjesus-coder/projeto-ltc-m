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
import {
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
  formatRealizedMoney,
  parseRealizedEventsResponse,
  realizedEventActions,
  realizedStatusLabel,
  type RealizedEvent,
  type RealizedEventsResponse,
} from '../realized-events/realized-events';

interface EventForm {
  readonly projectItemId: string;
  readonly competenceDate: string;
  readonly sourceKey: string;
  readonly documentNumber: string;
  readonly installmentKey: string;
  readonly amount: string;
  readonly notes: string;
}

const EMPTY_FORM: EventForm = {
  projectItemId: '',
  competenceDate: new Date().toISOString().slice(0, 10),
  sourceKey: '',
  documentNumber: '',
  installmentKey: '',
  amount: '0.00',
  notes: '',
};

function formFromEvent(item: RealizedEvent): EventForm {
  return {
    projectItemId: item.projectItemId ?? '',
    competenceDate: item.competenceDate,
    sourceKey: item.sourceKey,
    documentNumber: item.documentNumber ?? '',
    installmentKey: item.installmentKey ?? '',
    amount: item.amount,
    notes: item.notes ?? '',
  };
}

function payload(form: EventForm, currencyCode: string) {
  return {
    projectItemId: form.projectItemId || null,
    competenceDate: form.competenceDate,
    sourceKey: form.sourceKey,
    documentNumber: form.documentNumber,
    installmentKey: form.installmentKey,
    amount: form.amount,
    currencyCode,
    notes: form.notes,
  };
}

function errorLabel(error: unknown): string {
  if (error instanceof AuthenticationRequiredError)
    return 'Sessão expirada. Autentique-se novamente.';
  if (error instanceof AuthorizationDeniedError) return 'Seu perfil não possui esta permissão.';
  if (error instanceof ApiRequestError) {
    if (error.status === 409)
      return 'O lançamento foi alterado ou está em um estado incompatível. Recarregue a lista.';
    if (error.status === 422) return 'Os dados referenciam um cadastro ou estado indisponível.';
  }
  return 'Não foi possível concluir a operação.';
}

function itemLabel(item: {
  readonly itemCode: string | null;
  readonly description: string | null;
}): string {
  return [item.itemCode, item.description].filter(Boolean).join(' — ') || 'Item sem identificação';
}

export function RealizedEventsPage({ projectId }: { readonly projectId: string }) {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth0();
  const { refresh } = useAuthorization();
  const [state, setState] = useState<
    | { readonly kind: 'loading' }
    | { readonly kind: 'success'; readonly response: RealizedEventsResponse }
    | { readonly kind: 'error'; readonly error: unknown }
  >({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const [form, setForm] = useState<EventForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<EventForm>(EMPTY_FORM);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [justification, setJustification] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
        if (!cancelled) setState({ kind: 'error', error: new Error('P023_API_NOT_CONFIGURED') });
      });
      return () => {
        cancelled = true;
      };
    }
    queueMicrotask(() => {
      if (!cancelled) setState({ kind: 'loading' });
    });
    void apiClient
      .getJson<unknown>(`/projects/${encodeURIComponent(projectId)}/realized-events`)
      .then((value) => {
        if (!cancelled) setState({ kind: 'success', response: parseRealizedEventsResponse(value) });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, projectId, retry]);

  const response = state.kind === 'success' ? state.response : null;
  const updateForm = (key: keyof EventForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const updateEditingForm = (key: keyof EventForm, value: string) =>
    setEditingForm((current) => ({ ...current, [key]: value }));

  async function reloadAfter(action: () => Promise<unknown>, success: string) {
    setPending(true);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      setEditingId(null);
      setCancelingId(null);
      setJustification('');
      setRetry((value) => value + 1);
    } catch (error: unknown) {
      setNotice(errorLabel(error));
    } finally {
      setPending(false);
    }
  }

  if (state.kind === 'loading') return <p role="status">Carregando lançamentos realizados…</p>;
  if (state.kind === 'error') {
    return (
      <section
        className="error-panel realized-events-panel"
        aria-labelledby="realized-events-error-title"
      >
        <h2 id="realized-events-error-title">
          {state.error instanceof AuthorizationDeniedError
            ? 'Acesso negado'
            : 'Lançamentos indisponíveis'}
        </h2>
        <p>{errorLabel(state.error)}</p>
        {state.error instanceof AuthenticationRequiredError ? (
          <Button type="button" onClick={() => void loginWithRedirect()}>
            Autenticar novamente
          </Button>
        ) : state.error instanceof AuthorizationDeniedError ? (
          <Button type="button" onClick={refresh}>
            Tentar novamente
          </Button>
        ) : (
          <Button type="button" onClick={() => setRetry((value) => value + 1)}>
            Tentar novamente
          </Button>
        )}
      </section>
    );
  }
  if (!response) return null;

  const renderForm = (
    values: EventForm,
    update: (key: keyof EventForm, value: string) => void,
    prefix: string,
    eventId?: string,
  ) => (
    <div className="realized-events-form-grid">
      <Field id={`${prefix}-date`} label="Competência" required>
        <Input
          required
          type="date"
          value={values.competenceDate}
          onChange={(event) => update('competenceDate', event.target.value)}
        />
      </Field>
      <Field id={`${prefix}-source`} label="Chave de origem" required>
        <Input
          required
          value={values.sourceKey}
          onChange={(event) => update('sourceKey', event.target.value)}
        />
      </Field>
      <Field id={`${prefix}-amount`} label={`Valor (${response.project.currencyCode})`} required>
        <Input
          required
          inputMode="decimal"
          value={values.amount}
          onChange={(event) => update('amount', event.target.value)}
        />
      </Field>
      <Field id={`${prefix}-item`} label="Item do projeto">
        <Select
          value={values.projectItemId}
          onChange={(event) => update('projectItemId', event.target.value)}
        >
          <option value="">Sem item vinculado</option>
          {response.projectItems.map((item) => (
            <option key={item.id} value={item.id}>
              {itemLabel(item)}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${prefix}-document`} label="Documento">
        <Input
          value={values.documentNumber}
          onChange={(event) => update('documentNumber', event.target.value)}
        />
      </Field>
      <Field id={`${prefix}-installment`} label="Parcela">
        <Input
          value={values.installmentKey}
          onChange={(event) => update('installmentKey', event.target.value)}
        />
      </Field>
      <Field id={`${prefix}-notes`} label="Observações" className="realized-events-notes">
        <Textarea value={values.notes} onChange={(event) => update('notes', event.target.value)} />
      </Field>
      {eventId ? <input type="hidden" value={eventId} readOnly /> : null}
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow="P032 · lançamentos realizados"
        title={response.project.code}
        titleId="realized-events-title"
        description="Registre somente billing_actual. Rascunhos não afetam os acumulados; apenas lançamentos publicados são efetivos."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Início', href: '/' },
              { label: 'Projetos', href: '/projects' },
              { label: response.project.code, href: `/projects/${encodeURIComponent(projectId)}` },
              { label: 'Lançamentos realizados', current: true },
            ]}
          />
        }
      />
      <section className="realized-events-panel" aria-labelledby="realized-events-list-title">
        <div className="realized-events-heading">
          <div>
            <h2 id="realized-events-list-title">Histórico de lançamentos</h2>
            <p className="field-help">
              Moeda do projeto: {response.project.currencyCode}. Cancelamentos permanecem visíveis e
              não são apagados.
            </p>
          </div>
          {notice ? (
            <p className="realized-events-notice" role="status">
              {notice}
            </p>
          ) : null}
        </div>
        <PermissionGate capability="record:create">
          <form
            className="realized-events-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!apiClient) return;
              void reloadAfter(
                () =>
                  apiClient.sendJson(
                    `/projects/${encodeURIComponent(projectId)}/realized-events`,
                    'POST',
                    payload(form, response.project.currencyCode),
                  ),
                'Lançamento criado como rascunho.',
              );
            }}
          >
            <h3>Novo lançamento</h3>
            {renderForm(form, updateForm, 'new-realized-event')}
            <Button type="submit" variant="primary" disabled={pending}>
              Criar rascunho
            </Button>
          </form>
        </PermissionGate>
        {response.events.length === 0 ? (
          <EmptyState
            title="Nenhum lançamento realizado"
            description="Crie um rascunho quando houver um valor realizado a registrar."
          />
        ) : (
          <div className="realized-events-table-wrap">
            <table className="realized-events-table">
              <caption>Histórico de lançamentos realizados</caption>
              <thead>
                <tr>
                  <th>Competência</th>
                  <th>Origem</th>
                  <th>Item</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {response.events.map((item) =>
                  editingId === item.id ? (
                    <tr key={item.id}>
                      <td colSpan={6}>
                        <form
                          className="realized-events-edit-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!apiClient) return;
                            void reloadAfter(
                              () =>
                                apiClient.sendJson(
                                  `/projects/${encodeURIComponent(projectId)}/realized-events/${encodeURIComponent(item.id)}`,
                                  'PATCH',
                                  {
                                    ...payload(editingForm, response.project.currencyCode),
                                    expectedVersion: item.rowVersion,
                                  },
                                ),
                              'Lançamento atualizado.',
                            );
                          }}
                        >
                          {renderForm(editingForm, updateEditingForm, `edit-${item.id}`, item.id)}
                          <Button type="submit" variant="primary" disabled={pending}>
                            Salvar
                          </Button>
                          <Button type="button" onClick={() => setEditingId(null)}>
                            Fechar edição
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={item.id}
                      className={
                        item.status === 'cancelled' ? 'realized-event-cancelled' : undefined
                      }
                    >
                      <td>{item.competenceDate}</td>
                      <td>
                        <strong>{item.sourceKey}</strong>
                        {item.documentNumber ? <small>{item.documentNumber}</small> : null}
                      </td>
                      <td>
                        {item.itemCode || item.itemDescription
                          ? itemLabel({
                              itemCode: item.itemCode,
                              description: item.itemDescription,
                            })
                          : 'Sem item vinculado'}
                      </td>
                      <td>{formatRealizedMoney(item.amount, item.currencyCode)}</td>
                      <td>
                        <span className={`status-badge status-${item.status}`}>
                          {realizedStatusLabel(item.status)}
                        </span>
                      </td>
                      <td>
                        <div className="realized-events-actions">
                          {realizedEventActions(item.status).length > 0 ? (
                            <PermissionGate capability="record:edit_draft">
                              <>
                                {realizedEventActions(item.status).includes('edit') ? (
                                  <Button
                                    type="button"
                                    onClick={() => {
                                      setEditingId(item.id);
                                      setEditingForm(formFromEvent(item));
                                      setCancelingId(null);
                                    }}
                                  >
                                    Editar
                                  </Button>
                                ) : null}
                                {realizedEventActions(item.status).includes('publish') ? (
                                  <Button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => {
                                      if (!apiClient) return;
                                      void reloadAfter(
                                        () =>
                                          apiClient.sendJson(
                                            `/projects/${encodeURIComponent(projectId)}/realized-events/${encodeURIComponent(item.id)}/publish`,
                                            'POST',
                                            { expectedVersion: item.rowVersion },
                                          ),
                                        'Lançamento publicado.',
                                      );
                                    }}
                                  >
                                    Publicar
                                  </Button>
                                ) : null}
                                {realizedEventActions(item.status).includes('cancel') ? (
                                  <Button
                                    type="button"
                                    variant="danger"
                                    disabled={pending}
                                    onClick={() => {
                                      setCancelingId(cancelingId === item.id ? null : item.id);
                                      setJustification('');
                                      setEditingId(null);
                                    }}
                                  >
                                    Cancelar
                                  </Button>
                                ) : null}
                              </>
                            </PermissionGate>
                          ) : null}
                        </div>
                        {cancelingId === item.id ? (
                          <div className="realized-events-cancel-form">
                            <Textarea
                              aria-label={`Justificativa do cancelamento de ${item.sourceKey}`}
                              placeholder="Justificativa obrigatória"
                              value={justification}
                              onChange={(event) => setJustification(event.target.value)}
                            />
                            <Button
                              type="button"
                              variant="danger"
                              disabled={pending || !justification.trim()}
                              onClick={() => {
                                if (!apiClient) return;
                                void reloadAfter(
                                  () =>
                                    apiClient.sendJson(
                                      `/projects/${encodeURIComponent(projectId)}/realized-events/${encodeURIComponent(item.id)}/cancel`,
                                      'POST',
                                      { expectedVersion: item.rowVersion, justification },
                                    ),
                                  'Lançamento cancelado.',
                                );
                              }}
                            >
                              Confirmar cancelamento
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
