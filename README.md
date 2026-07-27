# LTC-M

Base técnica do sistema de gestão do portfólio LTC-M: aplicação CRUD, banco
Supabase/PostgreSQL e camada analítica para Tableau.

Este repositório contém somente a fundação da tarefa 1.01. O modelo de dados, as regras
transacionais, a importação da planilha e as views analíticas serão entregues em tarefas
próprias, depois da validação das dependências 0.07 e 0.08.

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

O app inicial não exige credenciais remotas. Para trabalhar com banco local:

```bash
npm run db:start
npm run db:status
```

O primeiro `db:start` baixa as imagens Docker usadas pelo Supabase. Copie a URL e a chave
anônima exibidas pelo CLI para o `.env`. Nunca inclua a `service_role` em uma variável `VITE_`.

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

## Fluxo de contribuição

Branches, commits, revisão e critérios de pronto estão documentados em
[`docs/conventions.md`](docs/conventions.md). A arquitetura e os limites atuais estão em
[`docs/architecture.md`](docs/architecture.md). O levantamento funcional, o modelo proposto e
as decisões de negócio em aberto estão preservados em
[`docs/project-specification.md`](docs/project-specification.md).

Não há configuração de deploy ou ambiente remoto nesta fundação. Conexões com Supabase
hospedado e Tableau devem ser adicionadas por ambiente, com segredos fora do Git.
