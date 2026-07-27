# LTC-M

Base técnica do sistema de gestão do portfólio LTC-M: aplicação CRUD, banco
Supabase/PostgreSQL e camada analítica para Tableau.

Este repositório contém a fundação da tarefa 1.01 e a decisão arquitetural da tarefa 0.07. O
modelo de dados, as regras transacionais, a importação da planilha e as views analíticas serão
entregues em tarefas próprias, depois da validação das regras de negócio pendentes.

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

O primeiro `db:start` baixa as imagens Docker usadas pelo Supabase. Copie para o `.env` a URL e a
chave publicável exibidas pelo CLI; use a chave `anon` somente quando a stack local não oferecer
uma chave publicável. Nunca inclua `secret` ou `service_role` em uma variável `VITE_`.

### Trabalho temporário sem Docker

Enquanto Docker ou um runtime compatível não estiver disponível, use somente um projeto Supabase
gerenciado e exclusivo para desenvolvimento, com dados sintéticos. Não reutilize homologação ou
produção e não coloque credenciais no repositório.

Configure `.env.local` com a URL e a chave publicável desse projeto. Mudanças de banco continuam
obrigatoriamente registradas em migrations, mesmo quando forem experimentadas no projeto remoto.
Esse fluxo não substitui a futura validação local com `db reset` e testes de RLS.

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

A decisão, alternativas e condições de revisão da plataforma estão no
[`ADR-0001`](docs/adr/0001-arquitetura-base-da-plataforma-ltc-m.md).

Deploy e ambientes remotos ainda não estão configurados. A arquitetura recomenda projetos
Supabase separados, Vercel para o frontend e GitHub Actions para CI/CD, condicionados às
aprovações organizacionais registradas no ADR.
