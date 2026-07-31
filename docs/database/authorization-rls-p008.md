# Autorização, RLS e menor privilégio — P008 / 1.08

## Estado e resultado

D22–D28 estão decididas no
[`ADR-0003`](../adr/0003-seguranca-postgresql-e-aplicacao-p008.md). O P007 e o P008-PRE estão em
`origin/main`; a baseline remota possuía seis migrations, 13 tabelas sem RLS, zero policies e
nenhum papel `ltc_m_runtime`. As duas migrations P008 foram aplicadas em 31/07/2026.

D26 aceita e preserva a associação automática concedida por `supabase_admin` a `postgres`, com
`ADMIN OPTION`, mas sem `INHERIT` e sem `SET`. D27 autoriza uma segunda associação temporária,
concedida por `postgres` com somente `SET`, para executar a suíte por perfil e removê-la
seletivamente em `finally`. O harness D27 foi executado novamente após D28: a ACL de
`current_actor_id(boolean)` foi corrigida, o Editor DML deixou de retornar `42501` e a matriz
integral passou. Consulte o [`relatório de runtime`](p008-runtime-validation-report.md).

## Matriz tabela × operação × perfil

| Tabela                    | SELECT viewer                 | SELECT editor             | SELECT admin | INSERT viewer/editor/admin | UPDATE viewer/editor/admin |
| ------------------------- | ----------------------------- | ------------------------- | ------------ | -------------------------- | -------------------------- |
| `app_users`               | próprio sanitizado            | próprio sanitizado        | sanitizado   | não/não/sim                | não/não/sim                |
| `currencies`, `units`     | ativos                        | ativos                    | todos        | não/não/sim                | não/não/sim                |
| `clients`                 | ativos e não excluídos        | ativos e não excluídos    | todos        | não/sim/sim                | não/ativos/todos           |
| `projects`                | ativos e cliente ativo        | ativos e cliente ativo    | todos        | não/ativos/sim             | não/ativos/todos           |
| `project_items`           | ativos em projeto visível     | ativos em projeto visível | todos        | não/ativos/sim             | não/ativos/todos           |
| `plan_versions`           | `approved`, `locked`          | todos                     | todos        | não/draft/draft            | não/draft/draft            |
| `financial_plan_scopes`   | versão `approved` ou `locked` | todos                     | todos        | não/em draft/em draft      | não/em draft/em draft      |
| `financial_plan_lines`    | versão `approved` ou `locked` | todos                     | todos        | não/em draft/em draft      | não/em draft/em draft      |
| `financial_actual_events` | todos                         | todos                     | todos        | não/sim/sim                | não/sim/sim                |
| `import_batches`          | nenhum                        | todos                     | todos        | não/sim/sim                | não/sim/sim                |
| `import_row_errors`       | nenhum                        | colunas sanitizadas       | sanitizado   | não/sim/sim                | não/não/não                |
| `audit_log`               | nenhum                        | nenhum                    | por função   | não/não/não                | não/não/não                |

Nenhum perfil recebe DELETE. A leitura direta de `app_users` exclui `auth_subject`; somente as
funções internas de contexto podem resolvê-lo. Triggers P007 continuam protegendo ciclo de vida, imutabilidade,
append-only e workflow. O grant de leitura de `import_row_errors` exclui `natural_key` e
`raw_payload`; a policy não é usada como mecanismo de mascaramento de coluna.

## Matriz de role e grants

| Objeto                                     | `ltc_m_runtime`                          | `PUBLIC` |
| ------------------------------------------ | ---------------------------------------- | -------- |
| schema `ltc_m`                             | `USAGE`                                  | nenhum   |
| 12 tabelas exceto `audit_log`              | SELECT e DML necessário, sem DELETE      | nenhum   |
| `audit_log`                                | nenhum acesso direto                     | nenhum   |
| `import_row_errors_id_seq`                 | `USAGE`                                  | nenhum   |
| `audit_log_id_seq`                         | nenhum; funções definer gravam auditoria | nenhum   |
| funções allowlist                          | `EXECUTE`                                | nenhum   |
| funções internas, helpers de trigger e DDL | nenhum                                   | nenhum   |
| objetos futuros                            | nenhum grant automático                  | nenhum   |

`ltc_m_runtime` é `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION` e
`NOBYPASSRLS`, sem ownership. A única associação permanente aceita é D26, administrativa e sem
`INHERIT`/`SET`; ela não é a credencial do backend. O login real do backend fica fora das
migrations e do repositório.

## Matriz de funções executáveis

| Função                                                | Runtime | Motivo                                               |
| ----------------------------------------------------- | ------- | ---------------------------------------------------- |
| `set_actor_context(uuid,text,text,text,text,boolean)` | sim     | inicializa contexto validado do backend              |
| `submit_plan_version(uuid)`                           | sim     | workflow editor/admin                                |
| `return_plan_version_to_draft(uuid)`                  | sim     | workflow admin                                       |
| `approve_plan_version(uuid)`                          | sim     | workflow admin                                       |
| `lock_plan_version(uuid)`                             | sim     | workflow admin                                       |
| `reopen_plan_version(uuid,text)`                      | sim     | workflow admin                                       |
| `authorization_context()`                             | sim     | avaliação fail-closed das policies                   |
| `read_audit_log(...)`                                 | sim     | consulta D24 com validação admin                     |
| `current_actor_id(boolean)`                           | sim     | dependência invoker de `maintain_row_metadata` (D28) |
| demais funções `ltc_m`                                | não     | triggers, auditoria e manutenção internas            |

## Inventário aplicado de policies

As policies são permissivas por padrão do PostgreSQL, mas há no máximo uma policy por
tabela e comando. A expressão única incorpora as alternativas de perfil, evitando sobreposição
entre policies permissivas. INSERT usa `WITH CHECK`; UPDATE usa `USING` e `WITH CHECK`; SELECT usa
`USING`. `audit_log` tem zero policies. Não há policy `FOR ALL` ou de DELETE.

## Recursão RLS em `app_users`

Consultar `app_users` diretamente dentro de uma policy da própria tabela provocaria recursão. O
helper `authorization_context()` será `SECURITY DEFINER`, `STABLE`, com `search_path` vazio, owner
fora do runtime, sem SQL dinâmico e sem parâmetro de role. Ele lê `app_user_id` e `auth_subject`
do contexto transacional, exige correspondência com uma linha ativa e devolve a role armazenada
na tabela. Contexto ausente, UUID inválido, subject divergente ou usuário inativo produz nenhuma
linha e, portanto, negação.

O runtime pode executar o helper porque as policies dependem dele; o resultado contém somente o
ID e a role do próprio ator validado. `PUBLIC` não pode executá-lo.

## Threat model resumido

| Ameaça                                     | Controle                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| role ou identidade forjada em GUC          | helper revalida ID, subject, ativo e role em `app_users`               |
| contexto ausente ou inválido               | policies fail-closed                                                   |
| recursão em `app_users`                    | helper definer mínimo e sem parâmetros de autorização                  |
| runtime como owner ou bypass               | atributos fixos, auditoria de catálogo e FORCE RLS                     |
| excesso de grants                          | allowlist, revogação de `PUBLIC`, sem DELETE/CREATE/TRIGGER/REFERENCES |
| acesso futuro acidental                    | default privileges sem EXECUTE público e sem grant futuro ao runtime   |
| duas despromoções concorrentes             | advisory lock transacional antes da contagem D23                       |
| leitura direta ou exfiltração da auditoria | zero grant em `audit_log`, função D24 parametrizada e sanitizada       |
| bypass do workflow                         | funções P007 allowlist e triggers de imutabilidade preservados         |
| impacto no banco compartilhado             | objetos qualificados, scanner, fingerprint e único push D28            |

### Resultado D27 e risco remanescente

O estado D26 foi restaurado exatamente após a execução, sem concessão `postgres` residual, dados
sintéticos ou alteração do fingerprint externo. A causa `42501` foi confirmada no grafo e
corrigida pela migration D28, que concede somente `current_actor_id(boolean)` ao runtime.
`current_justification` permanece interna: os caminhos que a usam são `SECURITY DEFINER`.

## Limites

RLS não interpreta JWT do Auth0 e não substitui validação no NestJS. O primeiro admin deverá ser
provisionado futuramente por processo operacional controlado, fora do runtime. Nenhuma credencial
é criada pelo P008.

O onboarding futuro deverá criar um login fora das migrations, conceder `ltc_m_runtime` sem
privilégios adicionais e validar que ele não recebe ownership, bypass ou acesso externo. D26 não
substitui esse onboarding. D27 existe exclusivamente para obter evidência dinâmica no ambiente
remoto e exige revogação seletiva do grant transitório e restauração exata de D26.
