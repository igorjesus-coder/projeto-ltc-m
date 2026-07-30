# Relatório pós-aplicação — P007 / 1.07

## Estado

**Parcialmente concluída — migrations aplicadas, validação pós-aplicação incompleta.**

As duas migrations P007 foram aplicadas uma única vez e o inventário confirmou que a mudança
ficou limitada a `ltc_m` e ao histórico de migrations. A suíte PostgreSQL transacional, porém,
interrompeu em `PW902`: uma transição direta de `plan_versions.status` foi aceita. Nenhuma
correção remota, repetição do push, `repair` ou rollback foi executado.

## Autorização formal D19

O responsável autorizou exclusivamente as duas migrations P007 no projeto `Funcionarios`, região
`us-east-1`, e no schema `ltc_m`, mesmo sem backup recuperável. A autorização exigiu novo
preflight, dry-run e um único `supabase db push --linked`, e não abrangeu objetos externos, seed,
roles, grants, policies, RLS, reset, pull, repair, SQL manual, alteração das migrations revisadas
ou execução do rollback.

## Preflight e dry-run

O preflight imediatamente anterior à escrita confirmou:

- projeto `Funcionarios`, região `us-east-1` e vínculo ativo;
- remoto terminado em `20260729163000` e `20260730103002`;
- somente `20260730144303` e `20260730144304` pendentes localmente;
- `BRL=1`, `US=1` e `US = Unidade e Serviço`;
- todas as tabelas operacionais e `audit_log` vazias;
- fingerprint externo
  `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`.

Todas as validações locais obrigatórias passaram. O dry-run, iniciado em
`2026-07-30T18:29:25.6348173Z` e concluído em `2026-07-30T18:29:36.2676124Z`, listou
exclusivamente, nesta ordem:

1. `20260730144303_add_ltcm_workflow_enum_values.sql`;
2. `20260730144304_add_ltcm_versioning_audit_workflow.sql`.

O plano não incluiu seed ou roles; os scanners confirmaram ausência de `GRANT`, policy, RLS e
referências externas.

## Aplicação

Comando único:

```text
supabase db push --linked
```

- início: `2026-07-30T18:30:04.2604277Z`;
- término: `2026-07-30T18:30:31.8203568Z`;
- resultado: código 0;
- migrations aplicadas, uma vez cada e na ordem esperada: `20260730144303` e `20260730144304`;
- seed e roles: nenhum.

A CLI informou apenas que não conseguiu manter o cache local do catálogo de migrations porque
Docker não estava disponível. Esse aviso não invalidou o push remoto nem alterou seu resultado.
Não houve retry.

## Histórico e objetos pós-aplicação

O `migration list --linked` posterior ficou alinhado:

| Local            | Remoto           |
| ---------------- | ---------------- |
| `20260729163000` | `20260729163000` |
| `20260730103002` | `20260730103002` |
| `20260730144303` | `20260730144303` |
| `20260730144304` | `20260730144304` |

O inventário
[`p007-inventory-post.json`](p007-inventory-post.json), coletado em
`2026-07-30T18:32:18.222Z`, registrou:

- metadados totais: 1.442;
- metadados `ltc_m`: 412;
- 91 objetos novos em `ltc_m`: 17 colunas, 15 constraints, 18 funções, 1 índice e 40 triggers;
- nenhuma remoção de objeto em `ltc_m`;
- alterações esperadas nos enums `plan_status` e `audit_operation` e na constraint de aprovação;
- zero policies e zero tabelas `ltc_m` com RLS;
- nenhum `GRANT` explícito nas migrations;
- 18 funções e 40 triggers habilitados, incluindo os objetos de timestamps, versionamento,
  auditoria, imutabilidade e workflow previstos.

Colunas P007 confirmadas:

- `row_version` em `app_users`, `clients`, `project_items`, `plan_versions`,
  `financial_plan_scopes`, `financial_plan_lines`, `financial_actual_events` e
  `import_batches`;
- `import_batches.updated_at`;
- `plan_versions.updated_by_user_id` e `source_plan_version_id`;
- `audit_log.actor_auth_subject`, `source`, `justification`, `previous_row_version`,
  `new_row_version` e `metadata`.

Funções confirmadas:

- contexto/metadata: `set_actor_context`, `current_actor_id`, `current_justification`,
  `maintain_row_metadata` e `workflow_guard_active`;
- auditoria/proteção: `sanitize_audit_payload`, `audit_row_change`,
  `enforce_admin_inactivation`, `prevent_physical_delete`, `prevent_audit_log_change`,
  `prevent_append_only_change`, `protect_plan_version` e `protect_plan_content`;
- workflow: `submit_plan_version`, `return_plan_version_to_draft`, `approve_plan_version`,
  `lock_plan_version` e `reopen_plan_version`.

## Fingerprints

| Escopo               | Pré                                                                | Pós                                                                | Resultado                |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------ |
| Externo a `ltc_m`    | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | idêntico                 |
| `ltc_m`              | `9874EDFF315C52848BA4AD24700FBF8663A8A5083B325D5CC29B7C354045F9E6` | `8AD65407513D674FCC28290B3FC204BEFD1E2EFDFECA960C6C073A4C37533D05` | mudou como esperado      |
| histórico migrations | `C8C2FBE7A1406CD9D928416CA354027D7527FE26737C436FF6E64492A83D0951` | `939D8E343999E715FEFBF6B79CD920D5479A80E2300C5306D410B99E047242C4` | duas versões adicionadas |

Nenhum objeto externo mudou.

## Testes PostgreSQL

Foi executado uma única vez:

```text
supabase db query --linked --file database/audit/ltcm-p007-tests.sql --output-format json
```

O comando retornou código 1 e:

```text
PW902: P007 falhou: alteração direta de status foi aceita.
```

A falha ocorreu no primeiro teste de transição direta, antes dos cenários de workflow,
autoaprovação e reabertura. Portanto:

- timestamps, versionamento e auditoria executados antes desse ponto não produziram uma
  conclusão formal da suíte, pois o lote abortou;
- as violações posteriores, autoaprovação e reabertura não foram avaliadas;
- a consulta final `rollback_clean` não foi alcançada e não retornou valor;
- o erro abortou a transação; uma consulta read-only posterior comprovou ausência total dos dados
  sintéticos e `audit_log=0`.

Diagnóstico estático: `workflow_guard_active()` pode devolver `NULL` quando
`ltc_m.workflow_action` ainda não existe. Em `protect_plan_version()`, a expressão
`v_action is null or not workflow_guard_active(v_action)` também resulta em `NULL`, e um `IF`
PL/pgSQL não trata `NULL` como verdadeiro. Isso permite a transição direta
`draft -> pending_approval`. Como a migration já foi aplicada e a solicitação proíbe alterá-la ou
executar SQL corretivo, a correção exige uma nova tarefa e uma migration forward.

## Limpeza e dados finais

A checagem read-only posterior ao erro confirmou:

- `BRL=1` e definição aprovada;
- `US=1`, definição aprovada e nome `Unidade e Serviço`;
- `currencies=1` e `units=1`;
- `app_users`, `clients`, `projects`, `project_items`, `plan_versions`,
  `financial_plan_scopes`, `financial_plan_lines`, `financial_actual_events`,
  `import_batches`, `import_row_errors` e `audit_log`: zero linhas;
- nenhum dado sintético residual.

Embora essas contagens comprovem o rollback efetivo da transação abortada, o requisito literal
`rollback_clean = true` permanece não atendido porque a própria suíte não chegou ao `SELECT`
final.

## Integridade do repositório e restrições

- migrations P004 e P006 e `supabase/seed.sql` permaneceram inalterados;
- nenhuma dependência foi instalada e `package-lock.json` permaneceu intacto;
- nenhum segredo foi versionado;
- o rollback manual permanece não executado;
- nenhum `repair`, reset, pull, migration down, SQL Editor, DDL manual ou segundo push ocorreu;
- nenhum commit, merge ou push Git foi feito;
- a P008 não foi iniciada.

## Riscos remanescentes e bloqueio

- a transição direta `draft -> pending_approval` não está protegida como especificado;
- os demais cenários PostgreSQL não têm validação dinâmica concluída;
- as migrations estão registradas no remoto e não podem ser reescritas; a correção deverá ser
  incremental;
- a execução ocorreu sem backup recuperável sob a exceção D19;
- Docker/Podman continuam indisponíveis para validação PostgreSQL descartável;
- promoção e uso funcional do workflow ficam bloqueados até uma migration corretiva separada
  passar pela suíte integral.

## Continuação D20

O responsável autorizou formalmente uma única migration forward para corrigir PW902 no mesmo
projeto e schema, novamente assumindo a ausência de backup recuperável. As migrations deste
relatório permanecem imutáveis. O preflight e a causa raiz da continuação são registrados em:

- [`p007-pw902-pre-correction-report.md`](p007-pw902-pre-correction-report.md);
- [`p007-pw902-root-cause.md`](p007-pw902-root-cause.md);
- [`p007-pw902-post-correction-report.md`](p007-pw902-post-correction-report.md).
