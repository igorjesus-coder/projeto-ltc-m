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
import { Button, EmptyState, Field, Input, Select } from '../components/design-system';
import {
  formatProjectItemMoney,
  parseProjectItemsResponse,
  type ProjectItem,
  type ProjectItemCurrency,
  type ProjectItemCatalogOption,
  type ProjectItemsResponse,
} from '../projects/project-items';

interface ItemForm {
  readonly itemCode: string;
  readonly description: string;
  readonly quantity: string;
  readonly unitCode: string;
  readonly unitPrice: string;
}

const EMPTY_FORM: ItemForm = {
  itemCode: '',
  description: '',
  quantity: '1',
  unitCode: '',
  unitPrice: '0',
};

function formFromItem(item: ProjectItem): ItemForm {
  return {
    itemCode: item.itemCode ?? '',
    description: item.description ?? '',
    quantity: item.quantity,
    unitCode: item.unitCode,
    unitPrice: item.unitPrice,
  };
}

function errorLabel(error: unknown): string {
  if (error instanceof AuthenticationRequiredError)
    return 'Sessão expirada. Autentique-se novamente.';
  if (error instanceof AuthorizationDeniedError) return 'Seu perfil não possui esta permissão.';
  if (error instanceof ApiRequestError) {
    if (error.status === 409) return 'O item foi alterado por outra pessoa. Recarregue a grade.';
    if (error.status === 422) return 'Os dados referenciam um cadastro ou estado indisponível.';
  }
  return 'Não foi possível concluir a operação.';
}

function mutationPayload(form: ItemForm, currencyCode: ProjectItemCurrency) {
  return {
    itemCode: form.itemCode,
    description: form.description,
    quantity: form.quantity,
    unitCode: form.unitCode,
    currencyCode,
    unitPrice: form.unitPrice,
  };
}

function UnitOptions({
  units,
  includeCurrent,
}: {
  readonly units: readonly ProjectItemCatalogOption[];
  readonly includeCurrent?: string;
}) {
  return (
    <>
      <option value="">Selecione</option>
      {units
        .filter((unit) => unit.active || unit.code === includeCurrent)
        .map((unit) => (
          <option key={unit.code} value={unit.code}>
            {unit.code} — {unit.name}
            {!unit.active ? ' (inativa)' : ''}
          </option>
        ))}
    </>
  );
}

export function ProjectItemsGrid({ projectId }: { readonly projectId: string }) {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth0();
  const { refresh } = useAuthorization();
  const [state, setState] = useState<
    | { readonly kind: 'loading' }
    | { readonly kind: 'success'; readonly response: ProjectItemsResponse }
    | { readonly kind: 'error'; readonly error: unknown }
  >({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<ItemForm>(EMPTY_FORM);
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
      .getJson<unknown>(`/projects/${encodeURIComponent(projectId)}/items`)
      .then((value) => {
        if (!cancelled) setState({ kind: 'success', response: parseProjectItemsResponse(value) });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, projectId, retry]);

  const response = state.kind === 'success' ? state.response : null;
  const updateForm = (key: keyof ItemForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const updateEditingForm = (key: keyof ItemForm, value: string) =>
    setEditingForm((current) => ({ ...current, [key]: value }));

  async function reloadAfter(action: () => Promise<unknown>, success: string) {
    setPending(true);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      setEditingId(null);
      setRetry((value) => value + 1);
    } catch (error: unknown) {
      setNotice(errorLabel(error));
    } finally {
      setPending(false);
    }
  }

  if (state.kind === 'loading') return <p role="status">Carregando itens do projeto…</p>;
  if (state.kind === 'error') {
    return (
      <section
        className="error-panel project-items-panel"
        aria-labelledby="project-items-error-title"
      >
        <h2 id="project-items-error-title">
          {state.error instanceof AuthorizationDeniedError
            ? 'Acesso negado'
            : 'Itens indisponíveis'}
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

  const submitCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!apiClient || !response.projectCurrencyAvailable || !form.unitCode) return;
    void reloadAfter(
      () =>
        apiClient.sendJson(
          `/projects/${encodeURIComponent(projectId)}/items`,
          'POST',
          mutationPayload(form, response.projectCurrency),
        ),
      'Item criado.',
    ).then(() =>
      setForm({ ...EMPTY_FORM, unitCode: response.units.find((unit) => unit.active)?.code ?? '' }),
    );
  };

  const startEdit = (item: ProjectItem) => {
    setEditingId(item.id);
    setEditingForm(formFromItem(item));
    setNotice(null);
  };

  const submitEdit = (event: React.FormEvent<HTMLFormElement>, item: ProjectItem) => {
    event.preventDefault();
    if (!apiClient) return;
    void reloadAfter(
      () =>
        apiClient.sendJson(
          `/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(item.id)}`,
          'PATCH',
          {
            ...mutationPayload(editingForm, response.projectCurrency),
            expectedVersion: item.rowVersion,
          },
        ),
      'Item atualizado.',
    );
  };

  return (
    <section className="project-items-panel" aria-labelledby="project-items-title">
      <div className="project-items-heading">
        <div>
          <p className="eyebrow">P027 · grade transacional</p>
          <h2 id="project-items-title">Itens do projeto</h2>
          <p className="field-help">
            Valores em {response.projectCurrency}. O total é calculado pelo PostgreSQL.
          </p>
        </div>
        {notice ? (
          <p className="project-items-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <PermissionGate capability="record:create">
        <form className="project-items-create-form" onSubmit={submitCreate}>
          <h3>Novo item</h3>
          <div className="project-items-form-grid">
            <Field id="new-item-code" label="Código">
              <Input
                value={form.itemCode}
                onChange={(event) => updateForm('itemCode', event.target.value)}
              />
            </Field>
            <Field id="new-item-description" label="Descrição">
              <Input
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
              />
            </Field>
            <Field id="new-item-quantity" label="Quantidade" required>
              <Input
                required
                inputMode="decimal"
                value={form.quantity}
                onChange={(event) => updateForm('quantity', event.target.value)}
              />
            </Field>
            <Field id="new-item-unit" label="Unidade" required>
              <Select
                required
                value={form.unitCode}
                onChange={(event) => updateForm('unitCode', event.target.value)}
              >
                <UnitOptions units={response.units} />
              </Select>
            </Field>
            <Field id="new-item-currency" label="Moeda">
              <Select value={response.projectCurrency} disabled aria-label="Moeda do projeto">
                <option value={response.projectCurrency}>{response.projectCurrency}</option>
              </Select>
            </Field>
            <Field id="new-item-unit-price" label="Preço unitário" required>
              <Input
                required
                inputMode="decimal"
                value={form.unitPrice}
                onChange={(event) => updateForm('unitPrice', event.target.value)}
              />
            </Field>
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || !response.projectCurrencyAvailable}
          >
            Adicionar item
          </Button>
        </form>
      </PermissionGate>

      {response.items.length === 0 ? (
        <EmptyState
          title="Nenhum item cadastrado"
          description="Adicione o primeiro item do projeto quando houver dados de planejamento."
        />
      ) : (
        <div className="project-items-table-wrap">
          <table className="project-items-table">
            <caption>Itens ativos e inativos do projeto</caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Descrição</th>
                <th scope="col">Quantidade</th>
                <th scope="col">Unidade</th>
                <th scope="col">Moeda</th>
                <th scope="col">Preço unitário</th>
                <th scope="col">Total</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {response.items.map((item) =>
                editingId === item.id ? (
                  <tr key={item.id} className={item.active ? undefined : 'project-item-inactive'}>
                    <td colSpan={8}>
                      <form
                        className="project-items-edit-form"
                        onSubmit={(event) => submitEdit(event, item)}
                      >
                        <div className="project-items-form-grid">
                          <Field id={`edit-${item.id}-code`} label="Código">
                            <Input
                              value={editingForm.itemCode}
                              onChange={(event) =>
                                updateEditingForm('itemCode', event.target.value)
                              }
                            />
                          </Field>
                          <Field id={`edit-${item.id}-description`} label="Descrição">
                            <Input
                              value={editingForm.description}
                              onChange={(event) =>
                                updateEditingForm('description', event.target.value)
                              }
                            />
                          </Field>
                          <Field id={`edit-${item.id}-quantity`} label="Quantidade" required>
                            <Input
                              required
                              inputMode="decimal"
                              value={editingForm.quantity}
                              onChange={(event) =>
                                updateEditingForm('quantity', event.target.value)
                              }
                            />
                          </Field>
                          <Field id={`edit-${item.id}-unit`} label="Unidade" required>
                            <Select
                              required
                              value={editingForm.unitCode}
                              onChange={(event) =>
                                updateEditingForm('unitCode', event.target.value)
                              }
                            >
                              <UnitOptions units={response.units} includeCurrent={item.unitCode} />
                            </Select>
                          </Field>
                          <Field id={`edit-${item.id}-price`} label="Preço unitário" required>
                            <Input
                              required
                              inputMode="decimal"
                              value={editingForm.unitPrice}
                              onChange={(event) =>
                                updateEditingForm('unitPrice', event.target.value)
                              }
                            />
                          </Field>
                        </div>
                        <Button type="submit" variant="primary" disabled={pending}>
                          Salvar
                        </Button>
                        <Button type="button" onClick={() => setEditingId(null)}>
                          Cancelar
                        </Button>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={item.id} className={item.active ? undefined : 'project-item-inactive'}>
                    <td>{item.itemCode ?? '—'}</td>
                    <td>{item.description ?? '—'}</td>
                    <td>{item.quantity}</td>
                    <td>
                      {item.unitCode} · {item.unitName}
                    </td>
                    <td>{item.currencyCode}</td>
                    <td>{formatProjectItemMoney(item.unitPrice, item.currencyCode)}</td>
                    <td>{formatProjectItemMoney(item.totalAmount, item.currencyCode)}</td>
                    <td>
                      <div className="project-items-actions">
                        {item.active ? (
                          <PermissionGate capability="record:edit_draft">
                            <Button type="button" onClick={() => startEdit(item)}>
                              Editar
                            </Button>
                          </PermissionGate>
                        ) : (
                          <>
                            <span>Inativo</span>
                            <PermissionGate capability="soft_delete:restore">
                              <Button
                                type="button"
                                disabled={pending}
                                onClick={() => {
                                  if (!apiClient) return;
                                  void reloadAfter(
                                    () =>
                                      apiClient.sendJson(
                                        `/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(item.id)}/reactivate`,
                                        'POST',
                                        {
                                          expectedVersion: item.rowVersion,
                                          justification: 'Reativação solicitada na grade P028.',
                                        },
                                      ),
                                    'Item reativado.',
                                  );
                                }}
                              >
                                Reativar
                              </Button>
                            </PermissionGate>
                          </>
                        )}
                        {item.active ? (
                          <PermissionGate capability="record:create">
                            <Button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                if (!apiClient) return;
                                void reloadAfter(
                                  () =>
                                    apiClient.sendJson(
                                      `/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(item.id)}/duplicate`,
                                      'POST',
                                      { expectedVersion: item.rowVersion },
                                    ),
                                  'Item duplicado.',
                                );
                              }}
                            >
                              Duplicar
                            </Button>
                          </PermissionGate>
                        ) : null}
                        {item.active ? (
                          <PermissionGate capability="soft_delete:execute">
                            <Button
                              type="button"
                              variant="danger"
                              disabled={pending}
                              onClick={() => {
                                if (!apiClient) return;
                                void reloadAfter(
                                  () =>
                                    apiClient.sendJson(
                                      `/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(item.id)}/inactivate`,
                                      'POST',
                                      {
                                        expectedVersion: item.rowVersion,
                                        justification: 'Inativação solicitada na grade P027.',
                                      },
                                    ),
                                  'Item inativado.',
                                );
                              }}
                            >
                              Inativar
                            </Button>
                          </PermissionGate>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
