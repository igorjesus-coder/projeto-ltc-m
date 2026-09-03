# P021 — autorização server-side e permissões de interface

Contrato: `ltcm.p021.authorization-ui.v1`

## Fontes de autoridade

Auth0 fornece somente identidade e autenticação. O claim `sub` é associado a
`ltc_m.app_users.auth_subject`, e o PostgreSQL LTC-M mantém o usuário ativo, o perfil e as
capabilities. O backend resolve essa associação e a interface consome somente o resultado de
`GET /auth/me`. O browser não acessa PostgreSQL/Supabase diretamente.

## Perfis e capabilities

Os perfis suportados são `viewer`, `editor`, `approver` e `admin`. O vocabulário é centralizado e
tipado:

`data:read`, `financial:read`, `audit:read`, `record:create`, `record:edit_draft`,
`forecast:create`, `forecast:edit_draft`, `forecast:override_balance`, `workflow:submit`, `workflow:approve`,
`workflow:return_to_draft`, `workflow:lock`, `workflow:reopen`, `soft_delete:execute`,
`soft_delete:restore`, `catalog:manage`, `users:manage` e `roles:manage`.

`physical_delete`, `archive` e `unlock_direct` não são capabilities concedidas.

| Perfil     | Capabilities principais                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `viewer`   | leitura de dados e financeiros publicados                                                           |
| `editor`   | leitura, criação/edição de draft e submissão                                                        |
| `approver` | leitura de revisão, aprovação e devolução para draft                                                |
| `admin`    | administração, override de saldo, workflow privilegiado, soft delete/restore e auditoria controlada |

## Contrato de sessão

`GET /auth/me` retorna:

```json
{
  "authenticated": true,
  "user": { "id": "...", "displayName": "..." },
  "role": "viewer|editor|approver|admin",
  "capabilities": ["data:read"]
}
```

Não retorna token, header Authorization, segredo, `auth_subject`, `DATABASE_URL` ou claims
arbitrários.

## Fail-closed e atualização

Usuário interno inexistente, inativo, sem perfil ou com role desconhecida recebe `403`. A API
resolve autorização em cada requisição e inicializa o contexto transacional P007/P008. A interface
mantém apenas um snapshot para UX; após `401` solicita nova autenticação e após `403` invalida ou
recarrega o estado de autorização.

Guards de backend são a fronteira de autorização. `AuthorizationProvider`, `useAuthorization`,
`PermissionGate` e guards de rota apenas ocultam/desabilitam ações e fornecem feedback acessível;
eles não são uma barreira de segurança. RLS/FORCE RLS, triggers de workflow, imutabilidade de
versões approved/locked e proibição de DELETE físico permanecem definitivos.

## Segregação

Editor não aprova; approver não edita; approver não bloqueia nem reabre. Admin não bypassa o
workflow e não edita conteúdo approved/locked. A exceção de autoaprovação do único Admin ativo
permanece limitada ao contexto explícito, justificativa e auditoria já existentes.
