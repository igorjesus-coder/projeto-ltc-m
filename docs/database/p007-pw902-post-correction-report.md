# Relatório pós-correção PW902 — P007 / 1.07

## Estado

**Parcialmente concluída — correção aplicada, suíte P007 ainda falhou.**

A migration forward D20 foi aplicada uma única vez e corrigiu PW902. A suíte integral avançou
pelas guardas, todas as transições diretas, workflow oficial e reabertura, mas interrompeu ao
inativar o segundo admin: `enforce_admin_inactivation()` tentou acessar `OLD.deleted_at` no
trigger de `app_users`, que não possui essa coluna, e o PostgreSQL retornou `42703`.

Nenhuma nova correção, segundo push, `repair` ou rollback manual foi executado.

## Autorização formal D20

O responsável autorizou exclusivamente uma migration forward corretiva do PW902 no projeto
`Funcionarios`, região `us-east-1`, schema `ltc_m`, mesmo sem backup recuperável. A autorização
não permitiu editar migrations aplicadas, alterar objetos externos, executar SQL manual, iniciar
P008 ou fazer mais de um `db push`.

## Preflight e dry-run

Antes da escrita:

- as quatro migrations anteriores estavam alinhadas e intactas;
- havia exatamente uma migration local pendente;
- `BRL=1`, `US=1`, tabelas operacionais vazias e `audit_log=0`;
- fingerprint externo:
  `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`;
- todas as validações locais e 46 testes Node/web passaram;
- o dry-run listou somente
  `20260730155749_fix_ltcm_workflow_guard_fail_closed.sql`, sem seed ou roles.

Evidências:

- [`p007-pw902-pre-correction-report.md`](p007-pw902-pre-correction-report.md);
- [`p007-pw902-inventory-pre.json`](p007-pw902-inventory-pre.json);
- [`p007-pw902-root-cause.md`](p007-pw902-root-cause.md).

## Aplicação

Comando único:

```text
supabase db push --linked
```

- início: `2026-07-30T19:12:11.0313872Z`;
- término: `2026-07-30T19:12:24.5361252Z`;
- código: 0;
- migration aplicada:
  `20260730155749_fix_ltcm_workflow_guard_fail_closed.sql`;
- seed e roles: nenhum.

A CLI repetiu o aviso não fatal de que não podia atualizar o cache local do catálogo sem Docker.
Não houve retry.

## Histórico e inventário pós-correção

O histórico local/remoto ficou alinhado nas cinco versões:

1. `20260729163000`;
2. `20260730103002`;
3. `20260730144303`;
4. `20260730144304`;
5. `20260730155749`.

O inventário
[`p007-pw902-inventory-post.json`](p007-pw902-inventory-post.json), coletado em
`2026-07-30T19:13:08.118Z`, confirmou:

- 1.443 metadados totais;
- 412 objetos `ltc_m`, sem criação ou remoção estrutural;
- uma nova entrada em `supabase_migrations`;
- alteração somente nas definições de `workflow_guard_active`, `protect_plan_version`,
  `audit_row_change` e `approve_plan_version` dentro de `ltc_m`;
- zero policies e zero tabelas `ltc_m` com RLS;
- nenhum `GRANT` explícito;
- migrations anteriores intactas.

Fingerprints:

| Escopo     | Pré                                                                | Pós                                                                | Resultado                   |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------- |
| Externo    | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | idêntico                    |
| `ltc_m`    | `8AD65407513D674FCC28290B3FC204BEFD1E2EFDFECA960C6C073A4C37533D05` | `9F3C882FDB8B94BAB69A7B6D98BB18481E3474BEAB863E2FB8C590117A6C2BF7` | quatro funções substituídas |
| migrations | `939D8E343999E715FEFBF6B79CD920D5479A80E2300C5306D410B99E047242C4` | `8A3A7929231B391D4F216321C2B93D881A295171B2AA545F33D664B6F70704A1` | uma versão adicionada       |

Nenhuma alteração externa foi detectada.

## Suíte PostgreSQL integral

Execução única após a correção:

```text
supabase db query --linked --file database/audit/ltcm-p007-tests.sql --output-format json
```

- início: `2026-07-30T19:13:44.4794903Z`;
- término: `2026-07-30T19:13:53.8427038Z`;
- código: 1;
- erro:

```text
42703: record "old" has no field "deleted_at"
PL/pgSQL function ltc_m.enforce_admin_inactivation() line 38 at IF
```

Até esse ponto, a suíte havia comprovado sem erro:

- timestamps, no-op e versionamento otimista;
- auditoria, sanitização e append-only;
- guarda ausente/resetada, vazia, inválida, `false` e `true` textual tratadas como `false`;
- viewer rejeitado;
- PW902 rejeitado;
- transições diretas `pending_approval -> approved`, `pending_approval -> draft` e
  `approved -> locked` rejeitadas;
- funções oficiais de envio, devolução, reenvio, aprovação e bloqueio;
- editor impedido de aprovar;
- versão aprovada, scope e line imutáveis;
- reabertura por clonagem, novos IDs, cópia de scopes/lines, linhagem, origem imutável,
  realizados não copiados e auditoria;
- autoaprovação com dois admins rejeitada.

A falha ocorreu ao executar `UPDATE ltc_m.app_users SET active = false` para preparar os cenários
com um único admin. Por isso:

- autoaprovação com um admin sem justificativa não foi executada;
- autoaprovação excepcional com justificativa não foi executada;
- correção financeira e DELETE físico posteriores não foram executados;
- o `SELECT rollback_clean` final não foi alcançado.

## Nova causa encontrada

`enforce_admin_inactivation()` verifica dinamicamente, por JSONB, se a linha possui `deleted_at`
ou `active`, mas depois referencia diretamente `old.deleted_at` e `new.deleted_at`. Em
`app_users`, o record do trigger não contém `deleted_at`; a referência direta gera `42703` mesmo
quando a intenção da condição era operar somente em tabelas que possuem a coluna.

Esse defeito já estava na migration P007 aplicada e não integra a única correção PW902 autorizada
pela D20. Corrigi-lo exige nova autorização e outra migration forward; as migrations aplicadas
não devem ser editadas.

## Rollback efetivo e dados finais

O erro abortou a transação. A checagem read-only posterior confirmou:

- `BRL=1` e definição aprovada;
- `US=1`, nome `Unidade e Serviço` e definição aprovada;
- `currencies=1`, `units=1`;
- todas as tabelas operacionais e `audit_log`: zero linhas;
- nenhum dado sintético residual.

O requisito literal `rollback_clean = true` continua não atendido porque a suíte não alcançou o
`SELECT` final, embora a ausência de resíduos tenha sido confirmada separadamente.

## Restrições observadas e riscos

- o rollback manual não foi executado;
- não houve `repair`, reset, pull, migration down, SQL Editor, DDL manual ou segundo push;
- nenhuma dependência foi adicionada e `package-lock.json` permaneceu intacto;
- nenhum commit, merge ou push Git foi feito;
- P008 não foi iniciada;
- o workflow permanece sem promoção enquanto a suíte integral não chegar a
  `rollback_clean = true`;
- a execução ocorreu sem backup recuperável sob a exceção D20.

Após concluir a documentação, `npm run format`, `format:check`, lint, typecheck, build, todos os
scanners e os 46 testes Node/web passaram novamente; `git diff --check` também passou.
