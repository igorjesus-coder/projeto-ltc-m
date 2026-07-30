# Versionamento, timestamps e auditoria — P007 / 1.07

## Estado

As duas migrations iniciais P007 e a migration forward D20 foram aplicadas uma única vez no
desenvolvimento remoto `Funcionarios`, sob exceções formais para a ausência de backup
recuperável. O fingerprint externo permaneceu idêntico e PW902 foi corrigido, mas a suíte
PostgreSQL encontrou depois `42703` em `enforce_admin_inactivation()` ao inativar um usuário sem
campo `deleted_at`.

A autorização D21 permitiu uma segunda e única migration forward. A correção foi aplicada uma vez,
o fingerprint externo permaneceu idêntico e a suíte integral retornou
`rollback_clean = true`. O estado é **Concluída**.

As migrations aplicadas não devem ser reescritas. RLS, policies, grants, roles e integração
NestJS permanecem fora da P007 e pertencem às tarefas posteriores.

Migrations:

- [`20260730144303_add_ltcm_workflow_enum_values.sql`](../../supabase/migrations/20260730144303_add_ltcm_workflow_enum_values.sql);
- [`20260730144304_add_ltcm_versioning_audit_workflow.sql`](../../supabase/migrations/20260730144304_add_ltcm_versioning_audit_workflow.sql);
- [`20260730155749_fix_ltcm_workflow_guard_fail_closed.sql`](../../supabase/migrations/20260730155749_fix_ltcm_workflow_guard_fail_closed.sql),
  migration forward corretiva D20.
- [`20260730163419_fix_ltcm_admin_inactivation_columns.sql`](../../supabase/migrations/20260730163419_fix_ltcm_admin_inactivation_columns.sql),
  migration forward corretiva D21 aplicada.

A separação é obrigatória porque PostgreSQL não permite usar um novo rótulo de enum antes do
commit da transação que o adicionou. Cada arquivo permanece transacional e o segundo só usa os
rótulos já confirmados.

## Matriz de permissões aprovada

| Ação                                                | Viewer | Editor | Admin                  |
| --------------------------------------------------- | ------ | ------ | ---------------------- |
| Ler dados oficiais/aprovados e exportar relatórios  | sim    | sim    | sim                    |
| Ler rascunhos                                       | não    | sim    | sim                    |
| Criar/editar clientes, projetos e itens ativos      | não    | sim    | sim                    |
| Criar e editar versão draft                         | não    | sim    | sim                    |
| Enviar draft para aprovação                         | não    | sim    | sim                    |
| Registrar realizados e executar importações         | não    | sim    | sim                    |
| Aprovar, bloquear, reabrir ou devolver para draft   | não    | não    | sim                    |
| Inativar/restaurar registros                        | não    | não    | sim, com justificativa |
| Consultar auditoria completa e administrar usuários | não    | não    | sim                    |
| Excluir fisicamente                                 | não    | não    | não                    |

As funções de workflow validam o perfil em `ltc_m.app_users`; elas não confiam em perfil recebido
por parâmetro. A P008 adicionará a defesa por grants e RLS.

## Matriz técnica

| Entidade                  | Timestamp                    | Versão otimista     | Auditoria                              | Imutabilidade                            | Funções/triggers e teste                                              |
| ------------------------- | ---------------------------- | ------------------- | -------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `app_users`               | `created_at` e `updated_at`  | `row_version`       | insert, update, perfil e inativação    | inativação exige admin/justificativa     | metadata, inativação, audit, no-delete; testes de ator/perfil         |
| `currencies`              | não possui e não recebeu     | não aplicável       | seed controlado fora da automação      | DELETE bloqueado                         | no-delete; validação BRL                                              |
| `units`                   | não possui e não recebeu     | não aplicável       | seed controlado fora da automação      | DELETE bloqueado                         | no-delete; validação US                                               |
| `clients`                 | automático                   | `row_version`       | insert, update, soft delete/restore    | ação lógica exige admin/justificativa    | metadata, inativação, audit, no-delete; testes de timestamp/auditoria |
| `projects`                | automático                   | `version` existente | insert, update, soft delete/restore    | ação lógica exige admin/justificativa    | metadata, inativação, audit, no-delete; teste de versão               |
| `project_items`           | automático                   | `row_version`       | insert, update, inativação/restore     | ação lógica exige admin/justificativa    | metadata, inativação, audit, no-delete                                |
| `plan_versions`           | automático                   | `row_version`       | insert e todos os eventos de workflow  | pendente, aprovada e bloqueada imutáveis | proteção, metadata, audit, no-delete e cinco funções                  |
| `financial_plan_scopes`   | automático                   | `row_version`       | insert/update                          | somente versão draft aceita conteúdo     | proteção, metadata, audit, no-delete                                  |
| `financial_plan_lines`    | automático                   | `row_version`       | insert/update                          | somente versão draft aceita conteúdo     | proteção, metadata, audit, no-delete                                  |
| `financial_actual_events` | automático                   | `row_version`       | insert, update/correção e cancelamento | DELETE bloqueado                         | metadata, audit, no-delete; teste de histórico                        |
| `import_batches`          | novo `updated_at` automático | `row_version`       | insert/update                          | DELETE bloqueado                         | metadata, audit, no-delete                                            |
| `import_row_errors`       | somente `created_at`         | append-only         | insert sanitizado                      | update não é fluxo; DELETE bloqueado     | audit e no-delete                                                     |
| `audit_log`               | somente `changed_at`         | append-only         | não audita a si própria                | UPDATE/DELETE bloqueados                 | trigger append-only                                                   |

`currencies`, `units`, `import_row_errors` e `audit_log` não recebem `updated_at` nem versão porque
são, respectivamente, valores controlados ou registros append-only. Alterações futuras nos
catálogos controlados exigem tarefa própria e não são autorizadas pela P007.

## Contexto transacional do ator

O backend deverá abrir uma transação, validar o JWT Auth0, resolver o usuário por
`app_users.auth_subject` e chamar:

```sql
select ltc_m.set_actor_context(
    p_app_user_id := $1,
    p_auth_subject := $2,
    p_request_id := $3,
    p_justification := $4,
    p_source := $5,
    p_exceptional_self_approval := $6
);
```

Depois executa todas as escritas e finaliza a mesma transação. A função usa
`set_config(..., true)`, portanto os valores são locais à transação e não vazam para outra
requisição do pool. O banco busca novamente o usuário interno ativo e rejeita divergência de
`auth_subject`; papel nunca é aceito do cliente. JWT, senha e credenciais não são parâmetros nem
colunas.

Operações de workflow e inativação rejeitam ausência de ator. Escritas auditáveis comuns sem
contexto são identificadas como `system:database`, com origem `system`; esse fallback serve a
processos técnicos controlados, não substitui autorização do backend.

Origens aceitas seguem o formato minúsculo `[a-z][a-z0-9_-]{0,49}`, por exemplo `api`, `import`
ou `system`. Request ID tem até 200 caracteres e justificativa, até 2.000.

## Timestamps e concorrência

O trigger `maintain_row_metadata`:

- redefine timestamps e versão na criação;
- preserva `created_at`;
- compara o conteúdo sem os próprios metadados;
- não avança `updated_at` nem a versão em no-op;
- usa `timestamptz` e `clock_timestamp()`;
- incrementa `row_version`, ou `projects.version`, exatamente uma vez;
- preenche autoria a partir do contexto quando a coluna existe.

O backend deve emitir updates condicionais:

```sql
update ltc_m.clients
set display_name = $1
where id = $2 and row_version = $3
returning row_version, updated_at;
```

Zero linhas significa registro ausente ou conflito. O banco incrementa a versão, mas não finge
ter validado a versão esperada quando o predicado não foi enviado.

## Auditoria

`audit_log` recebeu identidade externa sanitizada do ator, origem, justificativa, versões anterior
e posterior e metadata JSONB. A gravação ocorre na mesma transação da mudança; falha de auditoria
causa rollback.

Eventos:

- `INSERT`, `UPDATE`, `SOFT_DELETE`, `RESTORE` e `CANCEL`;
- `SUBMIT`, `RETURN`, `APPROVE`, `LOCK` e `REOPEN`;
- criação/correção de realizado;
- criação/mudança de lote e erro de importação;
- alteração de usuário, perfil e status.

Payloads removem e-mail, `auth_subject` do registro alterado, `tax_id`, documentos financeiros,
hash de arquivo, `raw_payload`, chave natural de erro e notas livres. A identidade do ator fica em
coluna própria. `audit_log` não possui trigger de `updated_at` e rejeita UPDATE/DELETE.

## Workflow e imutabilidade

Estados:

```text
draft -> pending_approval -> approved -> locked
              |
              +-> draft (devolução por admin com justificativa)

approved/locked -> nova versão draft (reabertura)
```

`pending_approval` foi adicionado porque o enum anterior não conseguia representar uma decisão
aprovada essencial. O desenho exige rejeitar mudança direta de status, mas o teste remoto
identificou que `workflow_guard_active()` pode retornar `NULL` na ausência do GUC
`ltc_m.workflow_action`; a condição de `protect_plan_version()` não converte esse resultado em
`false` e aceitou `draft -> pending_approval`. Scopes e lines foram criados para aceitar
INSERT/UPDATE somente quando a versão está em `draft`, mas a suíte não chegou aos respectivos
testes de imutabilidade.

A correção D20 torna a guarda fail-closed em duas camadas: `workflow_guard_active()` normaliza
ausência, vazio, ação inválida e `NULL` para `false`; `protect_plan_version()` exige
explicitamente `IS TRUE`. `audit_row_change()` também só classifica evento de workflow quando a
guarda é `TRUE`, e os booleanos de autoaprovação deixam de usar cast direto de configuração
textual. A auditoria completa está em
[`p007-pw902-root-cause.md`](p007-pw902-root-cause.md).

As cinco funções de workflow usam `SECURITY DEFINER` com `search_path` vazio. A exceção é
necessária para que o guard interno seja reconhecido apenas durante a função controlada; cada
função ainda valida ator ativo, perfil, estado e justificativa. O proprietário da tabela continua
sendo uma identidade privilegiada fora da fronteira normal da aplicação. A P008 deverá restringir
EXECUTE e impedir DML direto para o papel do backend.

## Autoaprovação

Na aprovação, criador e último editor são comparados ao admin atual. As linhas dos admins ativos
são bloqueadas para evitar decisão baseada em contagem concorrente.

- com outro admin ativo, autoaprovação falha;
- com um único admin ativo, exige justificativa e indicador excepcional no contexto;
- a auditoria registra indicador, justificativa, contagem de admins, ator, versão e request ID.

Na execução D20, a rejeição com dois admins passou. Os cenários com um admin não foram alcançados
porque a inativação do segundo admin falhou em `enforce_admin_inactivation()`.

## Reabertura

`reopen_plan_version(source_id, new_name)` bloqueia a origem aprovada/bloqueada, exige admin e
justificativa, cria uma nova versão `draft` com `source_plan_version_id`, novos IDs e novos
timestamps, e copia scopes e lines na mesma transação.

Não são copiados aprovação, bloqueio, baseline nem eventos realizados. A origem permanece
inalterada. Dois eventos `REOPEN` ligam origem e nova versão.

Todos esses cenários passaram na execução D20 antes da falha posterior de inativação.

## Exclusão e pendências

DELETE físico é bloqueado nas 12 tabelas operacionais/de referência, e `audit_log` possui proteção
append-only própria. Clientes, projetos e itens usam a estratégia lógica já existente; mudança de
`deleted_at`/`active` exige admin e justificativa.

O modelo ainda não possui estratégia lógica aprovada para remover scopes/lines ou erros de
importação. Eles não podem ser apagados fisicamente; a decisão de modelagem permanece futura.
Reversão/estorno financeiro definitivo também permanece pendente: a P007 apenas preserva e audita
correções enquanto permitidas, sem inventar política de valores negativos ou estorno.

## Testes

[`ltcm-p007-tests.sql`](../../database/audit/ltcm-p007-tests.sql) usa somente dados sintéticos,
uma transação e rollback. Cobre timestamps, no-op, versão esperada/obsoleta, sanitização,
append-only, soft delete, perfis, workflow, imutabilidade, clonagem, autoaprovação, correção
financeira, valores controlados e `rollback_clean`.

Na primeira execução remota, o lote abortou em `PW902`. Após a migration D20, PW902, as demais
transições diretas, o workflow oficial, imutabilidade e reabertura passaram. A segunda execução
abortou em `42703` ao inativar o segundo admin e não alcançou `rollback_clean`; a checagem
read-only confirmou novamente ausência de resíduos. Evidências:

- [`p007-post-application-report.md`](p007-post-application-report.md);
- [`p007-pw902-post-correction-report.md`](p007-pw902-post-correction-report.md).

O validador estático é executado com:

```bash
npm run p007:check
npm run test:p007
npm run pw902:check
npm run test:pw902
npm run d21:check
npm run test:d21
```

## Continuação D21 — erro 42703

A função genérica de inativação tratava a presença de `active` e `deleted_at` por JSONB, mas
normalizava depois `deleted_at` por referências diretas a `OLD` e `NEW`. `app_users` possui
`active` e não possui `deleted_at`, origem do `42703`.

A D21 substitui somente `enforce_admin_inactivation()` e preserva os quatro triggers. Comparações
e normalização passam a usar somente JSONB, respeitando as colunas reais de `app_users`,
`clients`, `projects` e `project_items`. Mudança de `role` em `app_users` passa a exigir admin
ativo; mudança de ciclo de vida continua exigindo também justificativa.

A matriz completa, a auditoria das demais funções genéricas e os riscos estão em
[`p007-d21-root-cause.md`](p007-d21-root-cause.md). O preflight está em
[`p007-d21-pre-correction-report.md`](p007-d21-pre-correction-report.md).

A migration foi aplicada em um único push. A suíte cobriu os quatro triggers, administração de
papel, inativação/reativação, PW902, workflow, autoaprovação, reabertura, auditoria,
imutabilidade e limpeza. O resultado `rollback_clean = true`, os fingerprints e as contagens
finais estão em
[`p007-d21-post-correction-report.md`](p007-d21-post-correction-report.md).
