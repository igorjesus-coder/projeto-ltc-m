# P019 — acesso server-side ao PostgreSQL e tipos de banco regeneráveis

Contrato: `ltcm.p019.server-postgres-access.v1`

## Arquitetura e ownership

P019 aplica o reenquadramento aprovado na D00: o React/Vite fala somente com a API própria; a API
NestJS/Express é a única fronteira da aplicação para PostgreSQL; Auth0 permanece responsável por
autenticação e sessão; o LTC-M autoriza; e o Supabase permanece somente como hospedagem do
PostgreSQL. Não existe cliente Supabase, Data API, Supabase Auth, service role ou conexão direta ao
banco no browser.

`apps/api` é um scaffold mínimo e real. Ele contém configuração server-only, módulo de banco,
lifecycle do pool, boundary transacional e integração com o contexto P008. Não contém CRUD,
endpoints de domínio, autenticação Auth0 implementada ou funcionalidade P020.

## Configuração fail-closed

O processo da API exige `NODE_ENV`, `PORT`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL` e
`DATABASE_SSL_MODE`. Os únicos modos TLS aceitos são `disable`, para desenvolvimento/testes
controlados, e `verify-full`; produção exige `verify-full`. Opções SSL na própria URL são rejeitadas
para impedir duas autoridades contraditórias.

Erros públicos usam códigos `P019_*` e nunca incluem valores. `DATABASE_URL` contém a credencial do
login futuro associado a `ltc_m_runtime`, é exclusivamente server-side e não pode ser versionada,
registrada ou prefixada com `VITE_`. O `.env.example` contém somente placeholder vazio.

## `pg`, pool e transação

Cada processo possui um pool limitado, não um pool por query. A inicialização configura timeout de
conexão, ociosidade e statement, `application_name` e parsing exato. O shutdown Nest encerra o pool;
erros assíncronos são reduzidos ao código sanitizado `P019_DATABASE_POOL_ERROR`.

`withTransaction` adquire uma conexão, executa `BEGIN`, mantém todas as operações na mesma conexão,
confirma com `COMMIT`, executa `ROLLBACK` em falha e sempre chama `release`. `withActorTransaction`
inicializa, nessa mesma transação, a função já normativa:

```sql
select ltc_m.set_actor_context($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::boolean)
```

A função usa configuração transaction-local. Após commit ou rollback, o contexto deixa de existir
antes de a conexão voltar ao pool. A API não recebe role do chamador: `authorization_context()`
revalida ID, `auth_subject`, estado ativo e role armazenada. RLS/FORCE RLS permanece defesa em
profundidade, sem superuser ou `BYPASSRLS` no runtime.

## Tipos P017 → P019

As migrations SQL continuam a única autoridade de schema. O fluxo é:

```text
migrations → PostgreSQL 17 from-zero → snapshot/fingerprint P017
           → gerador P019 → database.types.ts server-only
```

O output fica em `apps/api/src/database/generated/database.types.ts`, é versionado e não pode ser
editado manualmente. `numeric`/`decimal` e `bigint` são strings exatas; datas e timestamps também são
strings exatas por parsers locais do pool. `integer`/`smallint` usam `number`; UUID e texto usam
`string`; JSON é recursivo; nullability e enums vêm do modelo P017. Tipo desconhecido falha em vez de
receber semântica inventada.

```powershell
npm.cmd run db:types:generate
npm.cmd run db:types:check
npm.cmd run p019:check
npm.cmd run p019:acceptance
```

`db:types:check` regenera em memória e compara bytes. Alterar schema/fingerprint sem regenerar faz o
CI falhar. A suíte estática prova duas renderizações idênticas; o gate P017 continua comparando o
PostgreSQL 17 from-zero ao snapshot canônico.

## Testes e isolamento

Testes unitários cobrem configuração, TLS, sanitização, pool, shutdown, commit, rollback, release e
contexto parametrizado. O teste PostgreSQL cria somente em cluster efêmero um login sintético
`NOSUPERUSER`/`NOBYPASSRLS`, comprova ator válido, ausência e ator inválido, reutilização da conexão
sem leakage, RLS/FORCE RLS, sessões, locks e cleanup. O container é removido pelo runner.

O gate P019 impede no frontend imports de `pg`, `apps/api`, tipos gerados e `supabase-js`, além de
acessos `import.meta.env` a banco/service role. Depois do build, o bundle é examinado para garantir
ausência de `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e cliente Supabase.

## Limites

P019 não cria migration, não provisiona credencial real, não acessa Supabase remoto, Render ou
produção, não implementa Auth0, CRUD, DTOs de domínio, pacote compartilhado ou P020. Parâmetros
operacionais futuros de pooling podem ser adicionados somente quando houver workload medido; os
limites atuais são conservadores e explícitos.
