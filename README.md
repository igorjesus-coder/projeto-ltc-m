# LTC-M

Base técnica do sistema de gestão do portfólio LTC-M: frontend React/TypeScript/Vite, backend
Node.js LTS/TypeScript/NestJS com Express, banco PostgreSQL hospedado no Supabase e camada
analítica para Tableau.

O Auth0 é o mecanismo oficial de autenticação. O frontend será um serviço separado do backend
NestJS, que será implantado futuramente como Render Web Service; o Supabase será usado somente
como banco. O modelo físico, as regras transacionais, a importação da planilha, a implementação da
autenticação/backend e as views analíticas serão entregues em tarefas próprias.

## Pré-requisitos

- Node.js 24 LTS;
- npm 11 ou superior;
- Git;
- Docker Desktop, apenas para executar o Supabase local.

No Windows, use `npm.cmd` se a política do PowerShell bloquear `npm.ps1`.

## Instalação

```bash
git clone <url-do-repositorio>
cd projeto-ltc-m
npm ci
```

O app inicial ainda não integra Auth0, backend ou banco e não exige credenciais remotas. O
`.env.example` documenta as variáveis públicas previstas e as variáveis exclusivamente
server-side; não preencha segredos no repositório. Quando as integrações existirem, use arquivos
locais separados por serviço, como `apps/web/.env.development.local` e
`apps/api/.env.development.local`.

Para trabalhar futuramente com PostgreSQL local:

```bash
npm run db:start
npm run db:status
```

O primeiro `db:start` baixa as imagens Docker usadas pelo Supabase local. O frontend não usa URL,
chave publicável ou chave `anon` do Supabase: ele se comunicará somente com o backend próprio.
`DATABASE_URL` e credenciais PostgreSQL são exclusivamente server-side.

### Trabalho temporário sem Docker

Enquanto Docker ou um runtime compatível não estiver disponível, o projeto Supabase
`Funcionarios`, em `us-east-1`, está aprovado como desenvolvimento remoto temporário. Ele é
compartilhado com outro sistema: todo objeto futuro do LTC-M deverá ficar no schema `ltc_m`, nunca
em `public`, e somente por migration versionada após backup. Não o use como homologação ou
produção e não coloque credenciais no repositório.

Configure a conexão somente no backend futuro, nunca no frontend. Mudanças de banco continuam
obrigatoriamente registradas em migrations, mesmo quando forem experimentadas no projeto remoto.
Esse fluxo não substitui a futura validação local com `db reset` e testes de constraints, grants e
eventual RLS.

O procedimento de criação, vínculo, alternância e promoção entre desenvolvimento e homologação
está em [`docs/environments.md`](docs/environments.md). Project refs, tokens, senhas e connection
strings permanecem fora do Git. Homologação está formalmente adiada até que a conta permita um
projeto separado; nenhum schema ou branch no projeto compartilhado a substitui.

## Desenvolvimento

```bash
npm run dev
```

A aplicação fica disponível em `http://localhost:5173`.

## Verificações

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run env:check
npm run migrations:check
npm run seeds:check
npm run integrity:check
npm run p007:check
npm run pw902:check
npm run d21:check
```

Execute tudo em sequência com:

```bash
npm run check
```

## Banco local

```bash
npm run db:start
npm run db:status
npm run db:stop
```

`npm run db:reset` é destrutivo para o banco local e deve ser usado conscientemente. Nenhum
comando deste repositório aponta para produção por padrão.

Novas migrations ficam em `supabase/migrations` e testes SQL em `supabase/tests`. O arquivo
`supabase/seed.sql` contém somente valores controlados aprovados, determinísticos e não
sensíveis. A estratégia de idempotência, aplicação e divergências está em
[`docs/database/seeds.md`](docs/database/seeds.md).

Valide toda migration antes de qualquer dry-run ou aplicação:

```bash
npm run migrations:check
npm run seeds:check
```

Desenhos de banco ainda não promovidos a migration ficam em `database/design`. O
[`schema revisado do P003`](database/design/schema-ltc-m-reviewed.sql) é somente uma proposta
técnica e não deve ser aplicado diretamente. Os achados, decisões e pendências estão no
[`relatório de revisão`](database/design/schema-review.md).

A baseline versionada e aplicada no desenvolvimento compartilhado, o inventário de metadados, a
matriz de objetos e o rollback manual da P004 estão documentados em
[`docs/database/migrations.md`](docs/database/migrations.md). O rollback fica fora de
`supabase/migrations` e nunca é automático.

A auditoria P006 de constraints e índices, incluindo matriz de lacunas, testes transacionais e
`EXPLAIN`, está em
[`docs/database/constraints-audit-p006.md`](docs/database/constraints-audit-p006.md).

O desenho P007 de timestamps, versionamento otimista, contexto do ator, auditoria e workflow está
em
[`docs/database/versioning-audit-workflow-p007.md`](docs/database/versioning-audit-workflow-p007.md).

## Estrutura

```text
.
|-- apps/
|   `-- web/              # aplicação CRUD React/TypeScript
|-- database/
|   `-- design/           # desenhos SQL não executáveis como migration
|-- docs/                 # arquitetura e convenções
|-- scripts/              # automações do projeto
|-- supabase/
|   |-- migrations/       # alterações incrementais do banco
|   |-- tests/            # testes SQL
|   `-- seed.sql          # valores controlados aprovados
|-- tests/                # testes transversais
|-- AGENTS.md
`-- package.json
```

Quando o backend for implementado, o npm workspace evoluirá conceitualmente para:

```text
apps/
|-- web/                  # frontend React/Vite
`-- api/                  # backend NestJS/Express
```

`apps/api` ainda não existe. Tipos ou schemas compartilhados só serão extraídos para pacote
dedicado quando houver necessidade concreta.

## Fluxo de contribuição

Branches, commits, revisão e critérios de pronto estão documentados em
[`docs/conventions.md`](docs/conventions.md). A arquitetura e os limites atuais estão em
[`docs/architecture.md`](docs/architecture.md). O levantamento funcional, o modelo proposto e
as decisões de negócio em aberto estão preservados em
[`docs/project-specification.md`](docs/project-specification.md).

Os ambientes Supabase, o fluxo seguro da CLI e a promoção de migrations estão documentados em
[`docs/environments.md`](docs/environments.md).

A decisão vigente, alternativas e condições de revisão estão no
[`ADR-0002`](docs/adr/0002-arquitetura-render-supabase-database-auth0.md). O
[`ADR-0001`](docs/adr/0001-arquitetura-base-da-plataforma-ltc-m.md) está preservado como histórico
e marcado como substituído.

Deploy ainda não está configurado. O desenvolvimento remoto está vinculado provisoriamente a
`Funcionarios`; homologação e produção permanecem indisponíveis. A tarefa 0.07 concluiu a seleção
de React, TypeScript, Vite, Node.js LTS, NestJS, Express, Auth0, PostgreSQL/Supabase somente como
banco em `us-east-1`, Render, GitHub Actions, Tableau Extract e backup mensal. A biblioteca de
acesso ao PostgreSQL e outras decisões operacionais permanecem pendentes.
