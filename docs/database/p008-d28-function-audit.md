# Auditoria do grafo de funcoes P008 / D28

Esta matriz registra a auditoria feita antes da migration `20260731120000`.
O criterio foi conceder `EXECUTE` direto somente quando uma conexao assumindo
`ltc_m_runtime` precisa iniciar aquele caminho; chamadas internas continuam
protegidas por `SECURITY DEFINER`, por trigger ou por privilegios do owner.

| Funcao (assinatura completa)                                | Classe                        | Caminho comprovado                                                  | ACL antes               | ACL D28                                     | Teste                                 |
| ----------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------- | ----------------------- | ------------------------------------------- | ------------------------------------- |
| `ltc_m.set_actor_context(uuid,text,text,text,text,boolean)` | runtime-executable            | contexto usado por todas as policies                                | runtime sim; PUBLIC nao | inalterada                                  | contexto valido/invalido              |
| `ltc_m.authorization_context()`                             | runtime-executable            | policies de `app_users` e tabelas operacionais                      | runtime sim; PUBLIC nao | inalterada                                  | Viewer, Editor, Admin                 |
| `ltc_m.current_actor_id(boolean)`                           | runtime-executable            | `maintain_row_metadata()` (P007, SECURITY INVOKER) em INSERT/UPDATE | runtime nao; PUBLIC nao | `GRANT EXECUTE` ao runtime; PUBLIC revogado | Editor INSERT/UPDATE e regressao P007 |
| `ltc_m.submit_plan_version(uuid)`                           | runtime-executable            | workflow oficial P007                                               | runtime sim; PUBLIC nao | inalterada                                  | workflow Editor                       |
| `ltc_m.return_plan_version_to_draft(uuid)`                  | runtime-executable            | workflow oficial P007                                               | runtime sim; PUBLIC nao | inalterada                                  | workflow Admin                        |
| `ltc_m.approve_plan_version(uuid)`                          | runtime-executable            | workflow oficial P007                                               | runtime sim; PUBLIC nao | inalterada                                  | workflow Admin                        |
| `ltc_m.lock_plan_version(uuid)`                             | runtime-executable            | workflow oficial P007                                               | runtime sim; PUBLIC nao | inalterada                                  | workflow Admin                        |
| `ltc_m.reopen_plan_version(uuid,text)`                      | runtime-executable            | workflow oficial P007                                               | runtime sim; PUBLIC nao | inalterada                                  | workflow Admin                        |
| `ltc_m.read_audit_log(...)`                                 | runtime-executable            | consulta D24 parametrizada                                          | runtime sim; PUBLIC nao | inalterada                                  | D24 Admin/Viewer/Editor               |
| `ltc_m.maintain_row_metadata()`                             | trigger-only, invoker         | trigger de metadados P007; chama `current_actor_id`                 | sem grant direto        | sem grant direto                            | DML Editor                            |
| `ltc_m.current_justification()`                             | internal-definer              | chamada por auditoria/workflow definer                              | sem grant direto        | sem grant direto                            | workflow/regressao P007               |
| `ltc_m.sanitize_audit_payload(jsonb)`                       | internal-definer              | chamada por auditoria definer                                       | sem grant direto        | sem grant direto                            | D24 sanitizacao                       |
| `ltc_m.workflow_guard_active()`                             | trigger-only                  | guarda fail-closed de transicoes diretas                            | sem grant direto        | sem grant direto                            | tentativa de transicao direta         |
| `ltc_m.audit_row_change()`                                  | trigger-only/internal-definer | trigger de auditoria                                                | sem grant direto        | sem grant direto                            | P007/D24                              |
| `ltc_m.protect_plan_version_*()` e `ltc_m.prevent_*()`      | trigger-only                  | imutabilidade, append-only e inativacao                             | sem grant direto        | sem grant direto                            | regressao P007/D21                    |

As 35 policies chamam apenas `authorization_context()` e helpers de contexto
transitivos; nenhuma policy introduz uma funcao adicional executavel pelo runtime.
As funcoes de workflow sao `SECURITY DEFINER` e permanecem na allowlist existente.
`current_actor_id(boolean)` e a unica dependencia nova: o erro `42501` ocorria
quando o trigger invoker tentava chama-la durante o DML do Editor.

Resultado ACL esperado depois da aplicacao:

- `PUBLIC EXECUTE = false` para todas as funcoes `ltc_m`;
- exatamente nove funcoes `ltc_m` com `EXECUTE` para `ltc_m_runtime`;
- nenhum grant em schema, tabela, sequencia, objeto externo, role ou membership;
- nenhum helper trigger-only ou migration/admin-only diretamente executavel.
