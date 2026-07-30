# Relatório pré-aplicação — P007 / 1.07

## Estado

Pré-aplicação técnica iniciada em 2026-07-30. A ausência de backup recuperável foi aceita
excepcionalmente para esta execução pela autorização formal D19, sem dispensar os demais gates.

## Autorização formal D19

O responsável autorizou explicitamente a aplicação remota das duas migrations P007 no projeto
`Funcionarios`, mesmo sem backup recuperável, assumindo o risco específico desta execução.

A exceção:

- limita-se às migrations `20260730144303` e `20260730144304`;
- limita-se ao schema `ltc_m` no projeto `Funcionarios`;
- exige novo preflight, dry-run e um único `supabase db push --linked`;
- não autoriza objetos externos, seed, roles, grants, policies ou RLS;
- não autoriza reset, pull, repair, migration down, SQL Editor ou DDL manual;
- não autoriza alteração das migrations revisadas nem execução do rollback;
- exige interrupção imediata diante de divergência do fingerprint externo.

## Alvo e histórico

- projeto confirmado pela CLI: `Funcionarios`;
- região: `us-east-1`;
- Supabase CLI: 2.110.0;
- migrations local/remota alinhadas:
  - `20260729163000`;
  - `20260730103002`;
- migrations P007 locais pendentes:
  - `20260730144303_add_ltcm_workflow_enum_values.sql`;
  - `20260730144304_add_ltcm_versioning_audit_workflow.sql`;
- nenhuma migration remota desconhecida foi encontrada.

Nenhum project ref, token, senha ou connection string foi registrado.

## Estado dos dados

Consulta read-only anterior à aplicação:

- `BRL`: uma linha e definição aprovada;
- `US`: uma linha e definição aprovada;
- outras 11 tabelas, incluindo `audit_log`: zero linhas;
- tabelas operacionais: vazias.

## Inventário

Artefato:
[`p007-inventory-pre.json`](p007-inventory-pre.json).

- metadados totais: 1.349;
- metadados `ltc_m`: 321;
- fingerprint externo:
  `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`;
- fingerprint `ltc_m`:
  `9874EDFF315C52848BA4AD24700FBF8663A8A5083B325D5CC29B7C354045F9E6`;
- fingerprint do histórico de migrations:
  `C8C2FBE7A1406CD9D928416CA354027D7527FE26737C436FF6E64492A83D0951`.

## Ferramentas e exceção de risco

Docker, Podman, `psql` e `pg_dump` não estão disponíveis nesta máquina. Não existe dump local,
ponto de restauração comprovado ou backup recuperável.

Consequência após D19:

- o push pode ocorrer somente se todos os outros gates forem aprovados;
- o risco de recuperação foi explicitamente aceito apenas para esta execução;
- nenhuma tentativa de `repair`, reset, pull ou SQL manual é permitida.

## Dry-run

`supabase db push --linked --dry-run` concluiu sem alterar o banco e listou exclusivamente:

```text
20260730144303_add_ltcm_workflow_enum_values.sql
20260730144304_add_ltcm_versioning_audit_workflow.sql
```

Seeds e roles: nenhum.

- início: `2026-07-30T18:29:25.6348173Z`;
- término: `2026-07-30T18:29:36.2676124Z`;
- hashes SHA-256 das migrations no momento do gate:
  - `20260730144303`: `6E8588D4538B1D32CAEBDC425C2CEC505011309C1B7D5AA0F46A4801FE021B7E`;
  - `20260730144304`: `7891D5FFBC35A9C8D55B0824E2C692F47C261ECFBC02BCF8BA6C58DAEE017361`.

## Validações locais

Concluíram com sucesso:

- `npm run format` e `format:check`;
- `npm run lint`;
- `npm run typecheck`;
- `npm test`;
- `npm run build`;
- `npm run env:check`;
- `npm run migrations:check` — quatro migrations válidas;
- `npm run seeds:check`;
- `npm run integrity:check` e `test:integrity`;
- `npm run p007:check` e `test:p007`;
- `git diff --check`.

O estado Git continha somente a implementação e documentação P007 já em preparação; não havia
alteração alheia à tarefa. `package-lock.json`, P004, P006 e `supabase/seed.sql` estavam
inalterados, e nenhuma dependência foi instalada.

Este relatório registra o gate anterior ao push. O resultado da aplicação e da validação
PostgreSQL está em
[`p007-post-application-report.md`](p007-post-application-report.md).

A autorização posterior D20 não altera este gate histórico nem as migrations aqui registradas.
Ela permite somente uma migration forward corretiva, documentada em
[`p007-pw902-pre-correction-report.md`](p007-pw902-pre-correction-report.md).
