import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

import { publicEnvironment } from '../app/environment';
import {
  ApiRequestError,
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  createAuthenticatedApiClient,
} from '../auth/api-client';
import { useAuthorization } from '../auth/authorization';
import { Breadcrumbs, Button, Field, Input, PageHeader, Select } from '../components/design-system';

interface ClientRecord {
  readonly id: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly taxId: string | null;
  readonly active: boolean;
  readonly rowVersion: number;
}
interface CurrencyRecord {
  readonly code: 'BRL' | 'USD';
  readonly name: string;
  readonly active: boolean;
  readonly rowVersion: number;
}
interface UnitRecord {
  readonly code: string;
  readonly name: string;
  readonly category: string | null;
  readonly active: boolean;
  readonly rowVersion: number;
}
interface ListResponse<T> {
  readonly items: readonly T[];
}
type AdminState = {
  clients: readonly ClientRecord[];
  currencies: readonly CurrencyRecord[];
  units: readonly UnitRecord[];
};

function errorMessage(error: unknown): string {
  if (error instanceof AuthenticationRequiredError) return 'Sua sessão expirou.';
  if (error instanceof AuthorizationDeniedError) return 'Seu perfil não possui catalog:manage.';
  if (error instanceof ApiRequestError && error.code?.includes('VERSION_CONFLICT')) {
    return 'O registro mudou. Recarregue a lista e tente novamente.';
  }
  return 'Não foi possível concluir a operação.';
}

export function AdminMasterDataPage() {
  const { getAccessTokenSilently } = useAuth0();
  const { profile, refresh } = useAuthorization();
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [editingClient, setEditingClient] = useState<string | null>(null);
  const [editLegalName, setEditLegalName] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editTaxId, setEditTaxId] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [unitCategory, setUnitCategory] = useState('');
  const audience = publicEnvironment.auth0?.audience;
  const apiClient = useMemo(() => {
    if (!audience) return null;
    return createAuthenticatedApiClient({
      baseUrl: publicEnvironment.apiBaseUrl,
      audience,
      getAccessToken: () => getAccessTokenSilently({ authorizationParams: { audience } }),
    });
  }, [audience, getAccessTokenSilently]);

  const load = useCallback(async () => {
    if (!apiClient) return;
    setError(null);
    try {
      const [clients, currencies, units] = await Promise.all([
        apiClient.getJson<ListResponse<ClientRecord>>('/admin/clients?status=all'),
        apiClient.getJson<ListResponse<CurrencyRecord>>('/admin/currencies?status=all'),
        apiClient.getJson<ListResponse<UnitRecord>>('/admin/units?status=all'),
      ]);
      setState({ clients: clients.items, currencies: currencies.items, units: units.items });
    } catch (nextError) {
      setError(nextError);
      if (nextError instanceof AuthorizationDeniedError) refresh();
    }
  }, [apiClient, refresh]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function mutate(path: string, method: 'POST' | 'PATCH', body: unknown) {
    if (!apiClient) return;
    setPending(true);
    setError(null);
    try {
      await apiClient.sendJson(path, method, body);
      await load();
    } catch (nextError) {
      setError(nextError);
    } finally {
      setPending(false);
    }
  }

  const visibleClients = state?.clients.filter((client) => {
    const matchesStatus =
      clientFilter === 'all' || (clientFilter === 'active' ? client.active : !client.active);
    const query = clientSearch.trim().toLocaleLowerCase();
    return (
      matchesStatus &&
      (!query || `${client.displayName} ${client.legalName}`.toLocaleLowerCase().includes(query))
    );
  });

  function beginClientEdit(client: ClientRecord) {
    setEditingClient(client.id);
    setEditLegalName(client.legalName);
    setEditDisplayName(client.displayName);
    setEditTaxId(client.taxId ?? '');
  }

  function saveClientEdit(client: ClientRecord) {
    void mutate(`/admin/clients/${client.id}`, 'PATCH', {
      legalName: editLegalName,
      displayName: editDisplayName,
      taxId: editTaxId.trim() || null,
      expectedVersion: client.rowVersion,
    }).then(() => setEditingClient(null));
  }

  if (!profile?.capabilities.includes('catalog:manage')) {
    return <p role="alert">Acesso negado.</p>;
  }
  return (
    <>
      <PageHeader
        eyebrow="Administração"
        title="Cadastros mestres"
        titleId="admin-master-data-title"
        description="Somente administradores podem alterar clientes, moedas e unidades."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Início', href: '/' },
              { label: 'Cadastros mestres', current: true },
            ]}
          />
        }
      />
      {error ? (
        <p className="form-error-summary" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
      {!state && !error ? <p role="status">Carregando cadastros…</p> : null}
      <section aria-labelledby="admin-clients-title">
        <h2 id="admin-clients-title">Clientes</h2>
        <div className="project-form-grid">
          <Field id="client-search" label="Buscar clientes">
            <Input
              id="client-search"
              value={clientSearch}
              onChange={(event) => setClientSearch(event.target.value)}
            />
          </Field>
          <Field id="client-status-filter" label="Status">
            <Select
              id="client-status-filter"
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value as typeof clientFilter)}
            >
              <option value="all">Todos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </Select>
          </Field>
          <Field id="client-legal-name" label="Razão social" required>
            <Input
              id="client-legal-name"
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
            />
          </Field>
          <Field id="client-display-name" label="Nome de exibição" required>
            <Input
              id="client-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field id="client-tax-id" label="Identificador fiscal">
            <Input
              id="client-tax-id"
              value={taxId}
              onChange={(event) => setTaxId(event.target.value)}
            />
          </Field>
        </div>
        <Button
          disabled={pending || !legalName.trim() || !displayName.trim()}
          onClick={() => {
            void mutate('/admin/clients', 'POST', {
              legalName,
              displayName,
              taxId: taxId.trim() || null,
            }).then(() => {
              setLegalName('');
              setDisplayName('');
              setTaxId('');
            });
          }}
        >
          Cadastrar cliente
        </Button>
        <ul aria-label="Lista administrativa de clientes">
          {visibleClients?.map((client) => (
            <li key={client.id}>
              {editingClient === client.id ? (
                <span>
                  <Input
                    aria-label="Razão social em edição"
                    value={editLegalName}
                    onChange={(event) => setEditLegalName(event.target.value)}
                  />
                  <Input
                    aria-label="Nome de exibição em edição"
                    value={editDisplayName}
                    onChange={(event) => setEditDisplayName(event.target.value)}
                  />
                  <Input
                    aria-label="Identificador fiscal em edição"
                    value={editTaxId}
                    onChange={(event) => setEditTaxId(event.target.value)}
                  />
                  <Button
                    disabled={pending || !editLegalName.trim() || !editDisplayName.trim()}
                    onClick={() => saveClientEdit(client)}
                  >
                    Salvar edição
                  </Button>
                  <Button disabled={pending} onClick={() => setEditingClient(null)}>
                    Cancelar
                  </Button>
                </span>
              ) : null}
              {client.displayName} — {client.legalName} ({client.active ? 'ativo' : 'inativo'}){' '}
              {editingClient !== client.id ? (
                <Button disabled={pending} onClick={() => beginClientEdit(client)}>
                  Editar
                </Button>
              ) : null}
              <Button
                disabled={pending}
                onClick={() =>
                  void mutate(`/admin/clients/${client.id}/status`, 'PATCH', {
                    active: !client.active,
                    expectedVersion: client.rowVersion,
                    justification: client.active
                      ? 'Inativação administrativa P026'
                      : 'Ativação administrativa P026',
                  })
                }
              >
                {client.active ? 'Desativar' : 'Ativar'}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="admin-currencies-title">
        <h2 id="admin-currencies-title">Moedas controladas</h2>
        <p>Somente BRL e USD; não há criação de moedas nem conversão cambial.</p>
        <ul>
          {state?.currencies.map((currency) => (
            <li key={currency.code}>
              {currency.code} — {currency.name} ({currency.active ? 'ativa' : 'inativa'}){' '}
              <Button
                disabled={pending}
                onClick={() =>
                  void mutate(`/admin/currencies/${currency.code}/status`, 'PATCH', {
                    active: !currency.active,
                    expectedVersion: currency.rowVersion,
                    justification: 'Disponibilidade de moeda P026',
                  })
                }
              >
                {currency.active ? 'Desativar' : 'Ativar'}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="admin-units-title">
        <h2 id="admin-units-title">Unidades de referência/medida</h2>
        <div className="project-form-grid">
          <Field id="unit-code" label="Código" required>
            <Input
              id="unit-code"
              value={unitCode}
              onChange={(event) => setUnitCode(event.target.value)}
            />
          </Field>
          <Field id="unit-name" label="Nome" required>
            <Input
              id="unit-name"
              value={unitName}
              onChange={(event) => setUnitName(event.target.value)}
            />
          </Field>
          <Field id="unit-category" label="Categoria">
            <Input
              id="unit-category"
              value={unitCategory}
              onChange={(event) => setUnitCategory(event.target.value)}
            />
          </Field>
        </div>
        <Button
          disabled={pending || !unitCode.trim() || !unitName.trim()}
          onClick={() => {
            void mutate('/admin/units', 'POST', {
              code: unitCode,
              name: unitName,
              category: unitCategory.trim() || null,
            }).then(() => {
              setUnitCode('');
              setUnitName('');
              setUnitCategory('');
            });
          }}
        >
          Cadastrar unidade
        </Button>
        <ul>
          {state?.units.map((unit) => (
            <li key={unit.code}>
              {unit.code} — {unit.name} ({unit.active ? 'ativa' : 'inativa'}){' '}
              <Button
                disabled={pending}
                onClick={() =>
                  void mutate(`/admin/units/${encodeURIComponent(unit.code)}/status`, 'PATCH', {
                    active: !unit.active,
                    expectedVersion: unit.rowVersion,
                    justification: 'Disponibilidade de unidade P026',
                  })
                }
              >
                {unit.active ? 'Desativar' : 'Ativar'}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
