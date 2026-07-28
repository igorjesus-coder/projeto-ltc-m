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
cp .env.example .env
```

No PowerShell, substitua o último comando por:

```powershell
Copy-Item .env.example .env
```

O app inicial ainda não integra Auth0, backend ou banco e não exige credenciais remotas. O
`.env.example` documenta as variáveis públicas previstas e as variáveis exclusivamente
server-side; não preencha segredos no repositório.

Para trabalhar futuramente com PostgreSQL local:

```bash
npm run db:start
npm run db:status
```

O primeiro `db:start` baixa as imagens Docker usadas pelo Supabase local. O frontend não usa URL,
chave publicável ou chave `anon` do Supabase: ele se comunicará somente com o backend próprio.
`DATABASE_URL` e credenciais PostgreSQL são exclusivamente server-side.

### Trabalho temporário sem Docker

Enquanto Docker ou um runtime compatível não estiver disponível, use somente um projeto Supabase
gerenciado, na região `us-east-1`, exclusivo para desenvolvimento e com dados sintéticos. Não
reutilize homologação ou produção e não coloque credenciais no repositório.

Configure a conexão somente no backend futuro, nunca no frontend. Mudanças de banco continuam
obrigatoriamente registradas em migrations, mesmo quando forem experimentadas no projeto remoto.
Esse fluxo não substitui a futura validação local com `db reset` e testes de constraints, grants e
eventual RLS.

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
`supabase/seed.sql` deve conter apenas dados sintéticos e não sensíveis.

## Estrutura

```text
.
|-- apps/
|   `-- web/              # aplicação CRUD React/TypeScript
|-- docs/                 # arquitetura e convenções
|-- scripts/              # automações do projeto
|-- supabase/
|   |-- migrations/       # alterações incrementais do banco
|   |-- tests/            # testes SQL
|   `-- seed.sql          # dados locais sintéticos
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

A decisão vigente, alternativas e condições de revisão estão no
[`ADR-0002`](docs/adr/0002-arquitetura-render-supabase-database-auth0.md). O
[`ADR-0001`](docs/adr/0001-arquitetura-base-da-plataforma-ltc-m.md) está preservado como histórico
e marcado como substituído.

Deploy e ambientes remotos ainda não estão configurados. A tarefa 0.07 concluiu a seleção de
React, TypeScript, Vite, Node.js LTS, NestJS, Express, Auth0, PostgreSQL/Supabase somente como
banco em `us-east-1`, Render, GitHub Actions, Tableau Extract e backup mensal. A biblioteca de
acesso ao PostgreSQL e outras decisões operacionais permanecem pendentes.
