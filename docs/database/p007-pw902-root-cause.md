# Causa raiz e correção forward PW902 — P007 / 1.07

## Estado e decisão

A primeira execução PostgreSQL da P007 falhou em `PW902` porque uma atualização direta de
`plan_versions.status` aceitou `draft -> pending_approval`. As migrations
`20260730144303` e `20260730144304` já estavam aplicadas e permanecem imutáveis.

A autorização formal D20 permite uma única migration forward, exclusivamente em `ltc_m`, para
corrigir a guarda de workflow sem tabelas, colunas, enums, triggers, dados, grants, RLS ou
policies. A correção substitui somente quatro funções diretamente afetadas:

- `workflow_guard_active(text)`;
- `protect_plan_version()`;
- `audit_row_change()`;
- `approve_plan_version(uuid)`.

## Causa raiz confirmada

`current_setting('ltc_m.workflow_action', true)` retorna `NULL` quando a configuração ainda não
existe. A versão original de `workflow_guard_active()` comparava diretamente esse resultado:

```sql
current_setting('ltc_m.workflow_action', true) = p_action
```

Sem a configuração, a função retornava `NULL`. `protect_plan_version()` usava:

```sql
not ltc_m.workflow_guard_active(v_action)
```

O resultado continuava `NULL`; em PL/pgSQL, `IF NULL THEN` não entra no bloco. Assim, uma
transição reconhecida, mas executada fora da função oficial, ultrapassava a proteção. A
constraint de aprovação também aceitava `pending_approval`, portanto a atualização era concluída.

## Matriz completa de guardas e contexto

| Função/ponto                   | Condição anterior                                         | `NULL`/inválido                                                                 | Risco                                                         | Correção forward                                                         | Teste                                                              |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `workflow_guard_active`        | igualdade da GUC com a ação e confirmação do proprietário | GUC ausente podia retornar `NULL`; ação vazia ou desconhecida não era enumerada | origem do bypass PW902                                        | `COALESCE(..., false)` e whitelist `submit`, `return`, `approve`, `lock` | ausente/resetada, vazia, inválida, `false` e `true` textuais       |
| `protect_plan_version`         | `v_action is null or not workflow_guard_active(v_action)` | `NOT NULL` permanece `NULL`                                                     | transição direta aceita                                       | `workflow_guard_active(v_action) IS NOT TRUE`                            | quatro transições diretas rejeitadas                               |
| `audit_row_change`             | `... and workflow_guard_active(v_action)`                 | `NULL` seguia como falso no `IF`                                                | sem bypass, mas classificação dependia de semântica implícita | `workflow_guard_active(v_action) IS TRUE`                                | eventos `SUBMIT`, `RETURN`, `APPROVE`, `LOCK` das funções oficiais |
| `audit_row_change`             | `current_setting(...exceptional...)::boolean`             | ausência/vazio viravam falso pelo `COALESCE`; texto inválido gerava erro        | falha de disponibilidade/auditoria                            | igualdade textual canônica com `'true'` e `COALESCE(..., false)`         | autoaprovação excepcional auditada                                 |
| `approve_plan_version`         | mesmo cast booleano                                       | texto inválido gerava erro; não havia bypass                                    | fail-closed, porém parsing frágil                             | igualdade textual canônica com `'true'`                                  | casos com dois e um admin                                          |
| `submit_plan_version`          | salva GUC anterior, configura `submit`, restaura          | anterior ausente é restaurada como vazia                                        | seguro por `set_config(..., true)`                            | preservada                                                               | envio oficial e restauração                                        |
| `return_plan_version_to_draft` | idem, ação `return`                                       | idem                                                                            | seguro                                                        | preservada                                                               | retorno oficial com justificativa                                  |
| `approve_plan_version`         | idem, ação `approve`                                      | idem                                                                            | seguro após parsing corrigido                                 | corpo preservado salvo parsing                                           | aprovação e autoaprovação                                          |
| `lock_plan_version`            | idem, ação `lock`                                         | idem                                                                            | seguro                                                        | preservada                                                               | bloqueio oficial                                                   |

Outros usos de `current_setting(..., true)` foram auditados:

- `current_actor_id()` usa `NULLIF`, captura UUID inválido e falha fechado quando o ator é
  obrigatório;
- `current_justification()` transforma ausência/vazio em `NULL`;
- request ID, origem e identidade externa não são usados como autorização de workflow;
- todas as configurações internas usam `set_config(..., true)`, portanto são locais à transação;
- não existe dependência de Supabase Auth.

## Propriedades da correção

`workflow_guard_active()` agora sempre retorna booleano não nulo e só aceita as quatro ações
internas. `protect_plan_version()` rejeita qualquer resultado diferente de `TRUE`, mesmo que uma
regressão futura volte a tornar a função anulável.

O cliente comum não recebe parâmetro de guarda em `set_actor_context()`. A segunda condição da
guarda exige que `current_user` seja o proprietário de `ltc_m.plan_versions`, condição obtida
durante as funções `SECURITY DEFINER`, mas não pelo papel normal da aplicação. Grants e papéis de
menor privilégio continuam pertencendo à P008.

Nenhum trigger precisa ser recriado: `CREATE OR REPLACE FUNCTION` mantém OIDs, dependências,
proprietário e ACL existentes.

## Resultado da aplicação D20

A migration foi aplicada uma única vez e os testes confirmaram PW902 e as demais transições
diretas como rejeitadas. A suíte integral encontrou depois um defeito independente em
`enforce_admin_inactivation()`, ao acessar `OLD.deleted_at` no trigger de `app_users`. O resultado
e a limpeza estão em
[`p007-pw902-post-correction-report.md`](p007-pw902-post-correction-report.md).
