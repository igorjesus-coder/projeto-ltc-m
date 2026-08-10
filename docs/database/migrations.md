# Migrations do LTC-M

## Baseline P004 / 1.04

A migration
[`20260729163000_create_ltcm_relational_core.sql`](../../supabase/migrations/20260729163000_create_ltcm_relational_core.sql)
transforma o desenho aprovado no núcleo relacional versionado do LTC-M.

Ela é exclusivamente aditiva e executa dentro de uma transação explícita. Todos os comandos
usados são transacionais no PostgreSQL; não existem `CREATE INDEX CONCURRENTLY`, extensões,
roles, grants, RLS, funções, triggers, views, seeds ou DML. Se qualquer statement falhar antes do
`commit`, o PostgreSQL deve reverter toda a baseline.

O schema é criado sem `if not exists`. Isso é intencional: se `ltc_m` aparecer antes da aplicação,
a migration deve falhar em vez de aceitar um estado remoto ambíguo.

## Matriz de objetos

| Categoria          | Objetos criados                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema             | `ltc_m`                                                                                                                                                                                             |
| Tipos              | `app_role`, `project_status`, `project_classification`, `plan_status`, `planning_level`, `planned_financial_metric`, `actual_financial_metric`, `actual_status`, `import_status`, `audit_operation` |
| Identidade         | `app_users`                                                                                                                                                                                         |
| Referências        | `currencies`, `units`                                                                                                                                                                               |
| Cadastros          | `clients`, `projects`, `project_items`                                                                                                                                                              |
| Planejamento       | `plan_versions`, `financial_plan_scopes`, `financial_plan_lines`                                                                                                                                    |
| Realizado          | `financial_actual_events`                                                                                                                                                                           |
| Importação         | `import_batches`, `import_row_errors`                                                                                                                                                               |
| Auditoria          | `audit_log`                                                                                                                                                                                         |
| Sequences identity | sequences automáticas de `import_row_errors.id` e `audit_log.id`, ambas em `ltc_m`                                                                                                                  |
| Índices explícitos | 16 índices sobre tabelas em `ltc_m`                                                                                                                                                                 |
| Constraints        | PKs, uniques, checks e FKs exclusivamente entre tabelas em `ltc_m`                                                                                                                                  |
| Comentários        | schema e 13 tabelas de `ltc_m`                                                                                                                                                                      |

Além desses objetos, a aplicação pela Supabase CLI registra a versão em
`supabase_migrations.schema_migrations`. Essa é a única alteração técnica esperada fora de
`ltc_m`.

## Regras preservadas

- Auth0 é representado apenas por `app_users.auth_subject`; não existe referência a Supabase Auth.
- `viewer`, `editor` e `admin` são os únicos papéis de domínio.
- contrato, saldo de abertura, custo orçado, itens, planejado e realizado são medidas distintas.
- `billing_planned`, `billing_actual`, `receipt_forecast` e `receipt_actual` não são misturados.
- um escopo fixa o planejamento no nível de projeto ou item.
- FKs compostas impedem associar item, moeda ou linha financeira ao projeto errado.
- valores monetários usam `numeric`.
- a competência planejada deve ser o primeiro dia do mês.
- códigos repetidos de item coexistem por `source_line_key`.
- projetos consolidados por cliente continuam registros separados.

## Scanner estático

Execute:

```bash
npm run migrations:check
```

O scanner analisa todos os arquivos SQL em `supabase/migrations`, valida nomes timestampados,
ordem e unicidade e rejeita migrations vazias, DML, comandos destrutivos, objetos não
qualificados, schemas externos, Supabase Auth, tipos monetários imprecisos, seeds, extensões,
roles, grants, triggers, funções e SQL dinâmico.

Os testes ficam em:

- `scripts/check-migrations.test.mjs`;
- `scripts/collect-db-inventory.test.mjs`.

## Inventário e fingerprint

A consulta read-only
[`remote-metadata-inventory.sql`](../../database/audit/remote-metadata-inventory.sql) coleta apenas
metadados técnicos. Definições de funções, views, constraints, índices, triggers e policies são
representadas por hash, sem retornar seus textos.

O coletor `scripts/collect-db-inventory.mjs` normaliza e ordena os registros. Ele mantém o
fingerprint SHA-256 externo compatível com a P004 e também calcula fingerprints separados para
`ltc_m` e para `supabase_migrations`. A consulta inclui o histórico sanitizado de versões de
migration, sem retornar SQL em texto aberto.

Os valores controlados da P005, seu scanner e o procedimento de aplicação estão documentados em
[`seeds.md`](seeds.md).

## Rollback manual

O arquivo
[`rollback-ltc-m-baseline.sql`](../../database/rollback/rollback-ltc-m-baseline.sql) fica fora de
`supabase/migrations` e está marcado como **NÃO EXECUTAR AUTOMATICAMENTE**.

Ele remove somente `ltc_m`, mas apagará todos os dados futuros do LTC-M. Não altera
`supabase_migrations`. Se um rollback for autorizado:

1. manter o registro da baseline no histórico;
2. registrar a autorização e o incidente;
3. executar o rollback somente com backup e janela controlada;
4. reconstruir o schema por uma nova migration forward com novo timestamp;
5. não usar `migration repair` e não apagar registros do histórico manualmente.

O rollback não foi executado na P004.

## Complemento P006 / 1.06

A migration
[`20260730103002_add_ltcm_core_query_indexes.sql`](../../supabase/migrations/20260730103002_add_ltcm_core_query_indexes.sql)
adiciona quatro índices operacionais comprovadamente ausentes. Nenhuma constraint nova foi
necessária: PKs, FKs compostas, CHECKs de grão/competência e coerência monetária já estavam
presentes na P004.

A matriz completa, as redundâncias preservadas e as decisões não codificadas estão em
[`constraints-audit-p006.md`](constraints-audit-p006.md).

## P007 / 1.07 — versionamento, timestamps e auditoria

As migrations
[`20260730144303_add_ltcm_workflow_enum_values.sql`](../../supabase/migrations/20260730144303_add_ltcm_workflow_enum_values.sql)
e
[`20260730144304_add_ltcm_versioning_audit_workflow.sql`](../../supabase/migrations/20260730144304_add_ltcm_versioning_audit_workflow.sql)
adicionam, somente em `ltc_m`, metadata automática, versionamento otimista, auditoria append-only,
contexto transacional do ator e o workflow de versões. A separação mantém cada arquivo
transacional: valores novos de enum só podem ser usados depois do commit que os adiciona.

Ela adiciona o estado essencial `pending_approval`, os eventos `SUBMIT` e `RETURN`, colunas
`row_version` nas entidades mutáveis que ainda não possuíam versão, linhagem de reabertura e
metadata sanitizada em `audit_log`. `projects.version` é preservada como coluna de concorrência.

As funções de workflow são `SECURITY DEFINER` com `search_path` vazio por causa do guard de
imutabilidade; validam ator, perfil e estado internamente. A concessão de EXECUTE e a retirada de
DML direto pertencem à P008.

Detalhes, matriz, integração NestJS e catálogo de eventos:
[`versioning-audit-workflow-p007.md`](versioning-audit-workflow-p007.md).

Relatórios:

- [`p007-pre-application-report.md`](p007-pre-application-report.md);
- [`p007-post-application-report.md`](p007-post-application-report.md).

Rollback manual:
[`rollback-ltcm-p007-versioning-audit-workflow.sql`](../../database/rollback/rollback-ltcm-p007-versioning-audit-workflow.sql).

O rollback manual, não executado, está em
[`rollback-ltcm-p006-indexes.sql`](../../database/rollback/rollback-ltcm-p006-indexes.sql).

### Estado remoto da P007

Em 2026-07-30, a autorização D19 permitiu um único `supabase db push --linked` das duas migrations
P007 no projeto compartilhado `Funcionarios`, mesmo sem backup recuperável. O push concluiu, o
histórico local/remoto ficou alinhado e o fingerprint externo permaneceu idêntico.

A suíte PostgreSQL posterior falhou em `PW902`, pois uma transição direta
`draft -> pending_approval` foi aceita. A transação de teste foi revertida sem dados residuais,
mas `rollback_clean` não chegou a ser emitido e os cenários posteriores não foram executados. A
P007 está parcialmente concluída; as migrations aplicadas são imutáveis e uma eventual correção
deve usar nova migration forward em tarefa separada. Não houve `repair`, rollback manual,
alteração SQL avulsa ou repetição do push.

### Correção forward PW902

A autorização D20 aplicou uma única vez a migration
[`20260730155749_fix_ltcm_workflow_guard_fail_closed.sql`](../../supabase/migrations/20260730155749_fix_ltcm_workflow_guard_fail_closed.sql).
Ela usa `CREATE OR REPLACE FUNCTION` somente em `workflow_guard_active`,
`protect_plan_version`, `audit_row_change` e `approve_plan_version`, sem recriar triggers ou
alterar tabelas, dados e privilégios.

A guarda passa a retornar `false` para ausência, vazio, valor inválido e `NULL`; a proteção exige
resultado explicitamente verdadeiro. A causa, os demais usos auditados e o plano de teste estão
em [`p007-pw902-root-cause.md`](p007-pw902-root-cause.md).

O histórico ficou alinhado nas cinco migrations e o fingerprint externo permaneceu idêntico.
PW902 e as demais transições diretas passaram, mas a suíte encontrou depois `42703` em
`enforce_admin_inactivation()` ao acessar `OLD.deleted_at` no trigger de `app_users`. Não houve
segunda migration nem segundo push. O relatório está em
[`p007-pw902-post-correction-report.md`](p007-pw902-post-correction-report.md).

### Correção forward D21 para o erro 42703

A autorização D21 permitiu exatamente uma segunda migration forward:
[`20260730163419_fix_ltcm_admin_inactivation_columns.sql`](../../supabase/migrations/20260730163419_fix_ltcm_admin_inactivation_columns.sql).
Ela foi aplicada uma única vez e substituiu somente `ltc_m.enforce_admin_inactivation()`.

A função continua genérica, mas passa a consultar e alterar campos opcionais somente por JSONB.
Os quatro triggers existentes não são recriados. Em `app_users`, a coluna real de ciclo de vida é
`active`; mudanças de `role` também passam a exigir admin ativo, enquanto justificativa permanece
obrigatória para inativação/restauração.

Causa, matriz e auditoria de funções genéricas:
[`p007-d21-root-cause.md`](p007-d21-root-cause.md).

Preflight:
[`p007-d21-pre-correction-report.md`](p007-d21-pre-correction-report.md).

O histórico terminou alinhado nas seis migrations. A suíte P007 integral passou com
`rollback_clean = true`, BRL/US permaneceram íntegros, não houve dados residuais e o fingerprint
externo permaneceu
`7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`.

Resultado:
[`p007-d21-post-correction-report.md`](p007-d21-post-correction-report.md).

## P008 / 1.08 — runtime, menor privilégio e RLS

As migrations
[`20260731103000_add_ltcm_audit_read_event.sql`](../../supabase/migrations/20260731103000_add_ltcm_audit_read_event.sql)
e
[`20260731103001_add_ltcm_runtime_rls_security.sql`](../../supabase/migrations/20260731103001_add_ltcm_runtime_rls_security.sql)
separam o novo valor `AUDIT_READ` de seu uso e implementam D22–D25. A segunda migration cria
somente a role global `ltc_m_runtime`; todos os demais objetos e ACLs são restritos a `ltc_m`.

As 13 tabelas recebem RLS e FORCE RLS, sem policy `FOR ALL` ou DELETE. Há uma policy por tabela e
comando, totalizando 35. A autorização revalida `app_user_id`, `auth_subject`, estado ativo e role
armazenada em `app_users`; não interpreta JWT nem usa Supabase Auth. O runtime não recebe acesso
direto a `audit_log` e consulta a trilha somente por `read_audit_log(...)`, quando o contexto é de
admin ativo.

Desenho, matrizes e threat model:
[`authorization-rls-p008.md`](authorization-rls-p008.md). Preflight:
[`p008-pre-application-report.md`](p008-pre-application-report.md). Rollback manual, não executado:
[`rollback-ltcm-p008-rls-security.sql`](../../database/rollback/rollback-ltcm-p008-rls-security.sql).

O push P008 concluiu e o fingerprint externo permaneceu idêntico. D26 aceitou a associação
administrativa automática e D27 autorizou somente o harness temporário. A prova e a limpeza
passaram; a validação funcional foi concluída após D28, conforme o
[`p008-runtime-validation-report.md`](p008-runtime-validation-report.md).

A migration forward D28
[`20260731120000_fix_ltcm_runtime_function_acl.sql`](../../supabase/migrations/20260731120000_fix_ltcm_runtime_function_acl.sql)
concede somente `EXECUTE` em `ltc_m.current_actor_id(boolean)` ao runtime, mantendo `PUBLIC`
revogado e sem alterar corpos, policies, tabelas, roles ou memberships. O dry-run e o push D28
foram executados uma única vez após preflight; o hash é
`E2CF2E94DCC14713840472684D90369E76A889E30E0C45198B533D8A92F729A8`.

## P009 / 1.09 — staging genérico de importação

A migration
D32 foi decidida e aprovada pelo responsável do projeto em 03/08/2026. O harness deve exigir
igualdade exata entre `audit_log.request_id` e o request do contexto transacional ativo. A
correção limita-se a harness, renderer, fixtures sintéticas, scanners, testes e documentação; a
migration P009 e os objetos do banco permanecem inalterados. D32 autoriza uma única invocação
remota final após gate local integral.

A invocação D32 `r20260803151221-2d4f91ba` foi consumida sem migration ou `db push`. O SQL P009
concluiu suas assertions e ROLLBACK, mas o orquestrador não capturou um result set intermediário e
retornou código 1. O cleanup e os fingerprints passaram; D32 não autoriza repetição.

D33 foi decidida e aprovada pelo responsável do projeto em 03/08/2026 para corrigir somente
captura, transporte e integridade da evidência. A única invocação
`r20260803173036-ddabb07d` terminou com código 0 e envelope `P009_RESULT_V1` íntegro após `close`.
Todas as fases/regressões e o cleanup passaram, dez migrations permaneceram alinhadas e os
fingerprints pré/pós foram idênticos. Não houve migration, `db push` ou DDL; D33 não autoriza
repetição.

[`20260731130000_add_ltcm_import_staging.sql`](../../supabase/migrations/20260731130000_add_ltcm_import_staging.sql)
prepara `import_batch_sheets` e `import_staging_rows`, estende somente os metadados necessários de
`import_batches`/`import_row_errors`, aplica constraints, índices, triggers, RLS, policies e grants
qualificados em `ltc_m`. O hash de arquivo deixa de ser globalmente único para permitir novas
tentativas; `idempotency_key` permanece única quando informada.

P009 não lê XLSX, não insere dados e não importa dados reais. O contrato JSON v1 será produzido
pelo P010; o rollback manual está em
[`rollback-ltcm-p009-staging.sql`](../../database/rollback/rollback-ltcm-p009-staging.sql) e não
foi executado. A D29 foi decidida em 31/07/2026, e o preflight/dry-run precederam um único push
remoto bem-sucedido. A revalidação de 03/08/2026 terminou parcialmente concluída: P007/P008,
cleanup, D26 e fingerprints passaram, mas a etapa P009 abortou antes dos cenários por erro do
renderizador local. A D30 autorizou e consumiu uma única reexecução
`r20260803132652-ada2b257`; o alias corrigido passou, porém outro SQLSTATE `42601` revelou aridade
divergente no INSERT de usuários sintéticos. P007/P008 e cleanup passaram novamente, sem delta.
A fixture foi corrigida somente localmente. Não houve segundo push; nova execução remota da suíte
depende de outra decisão explícita.

## P011 / D40 — exceção legada auditável de data de referência

A migration forward local
[`20260804120000_add_legacy_project_reference_date_exception.sql`](../../supabase/migrations/20260804120000_add_legacy_project_reference_date_exception.sql)
adiciona somente `projects.legacy_import_batch_id`, FK `NO ACTION`, CHECK validado, índice parcial
e `trg_07_projects_legacy_reference_guard`. O `NOT NULL` físico é removido por último e o CHECK
mantém o domínio fail-closed. A guarda reutiliza o contexto P007/P008. `received`, `validating` e
`loaded` permitem vínculo; `rejected` não. Nenhuma policy, grant, enum ou migration aplicada foi
alterada. A migration permanece local e não há autorização para `db push`.

D41 foi incorporada atomicamente à mesma migration D40 ainda não aplicada. A função
`enforce_import_batch_rejection_guard()` e `trg_07_import_batches_rejection_guard` bloqueiam
`NEW.status = 'rejected'` quando existe qualquer projeto referenciando o lote. A guarda não altera
projetos, não ignora soft delete, executa antes de metadata/auditoria e não adiciona policy/grant.
O hash D40 anterior foi invalidado pela correção e deve ser substituído pelo hash final D40/D41.
