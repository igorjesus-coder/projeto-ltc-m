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
npm run p008:check
npm run d28:check
npm run p009:check
npm run d40:check
npm run pw902:check
npm run d21:check
npm run test:p010
```

Execute tudo em sequência com:

```bash
npm run check
```

O gate D43 executa as migrations e as regressões P006–P009/D40/D41 em PostgreSQL 17 efêmero no
GitHub Actions. Ele não usa Supabase, secrets ou banco persistente. A arquitetura, os comandos e o
JSON sanitizado estão documentados em
[`docs/database/p011-d43-postgres-ci.md`](docs/database/p011-d43-postgres-ci.md).

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

As decisões D22–D28 de segurança PostgreSQL e aplicação controlada do P008 estão no
[`ADR-0003`](docs/adr/0003-seguranca-postgresql-e-aplicacao-p008.md). Elas estão decididas desde
31/07/2026; as migrations P008 e a correção ACL D28 estão aplicadas, e a revalidação D27 foi
concluída com sucesso. O desenho de role runtime, grants, RLS e policies está em
[`authorization-rls-p008.md`](docs/database/authorization-rls-p008.md); o login real do backend e
qualquer credencial permanecem fora das migrations e do repositório.

A P009 prepara o staging genérico de importação e o contrato JSON v1 sem ler o XLSX real. A D29
foi decidida em 31/07/2026 e a migration foi aplicada remotamente uma única vez. A validação
estrutural, P007/P008, cleanup e fingerprints passaram; a revalidação funcional P009 de 03/08/2026
ficou incompleta por erro do renderizador do harness. A D30, aprovada em 03/08/2026, autoriza
exatamente uma reexecução remota do harness corrigido, sem nova migration, `db push`, DDL ou
repetição automática. Essa execução ocorreu como `r20260803132652-ada2b257`: o alias corrigido
passou, mas a suíte P009 parou em uma fixture local com aridade de `VALUES` divergente. P007/P008,
cleanup e estado final passaram com `rollback_clean=true`; a fixture foi corrigida apenas
localmente, e outra execução remota exige nova decisão.

A D31, decidida e aprovada em 03/08/2026, condiciona uma única nova validação remota P009 a um
gate local integral do SQL renderizado. O gate usa dois run IDs, valida lexer, identificadores,
todos os INSERTs e fixtures `app_users`, e gera manifesto com hashes. A execução autorizada ocorre
em uma única invocação: Fase A transacional com `ROLLBACK`, seguida da Fase B somente se
`phase_a_passed=true`, sempre com limpeza D27 e das fixtures em `finally`.
A única invocação D31 `r20260803141344-e3356875` aprovou a Fase A, mas a Fase B parou na assertion
de request da auditoria antes da matriz RLS P009. P007/P008, cleanup e fingerprints passaram com
`rollback_clean=true`; D31 foi consumida e não autoriza repetição.
A D32, decidida e aprovada em 03/08/2026, corrige exclusivamente o harness: cada cenÃ¡rio P009
configura um request determinÃ­stico derivado do run ID, confirma o contexto antes e depois do DML
e exige o mesmo valor em `audit_log.request_id`. O trigger e o schema nÃ£o mudam. O gate D32
protege 13 contextos, as assertions pÃ³s-DML e a matriz configuradoâ†’auditado; somente uma
invocaÃ§Ã£o remota final do comando versionado estÃ¡ autorizada, sem repetiÃ§Ã£o automÃ¡tica.
A única invocação D32 `r20260803151221-2d4f91ba` aprovou Fase A, assertions SQL P009,
P007/P008, D23 e cleanup, mas o orquestrador não capturou um result set intermediário e terminou
com código 1. O estado remoto ficou limpo e sem delta (`rollback_clean=true`); D32 foi consumida e
não autoriza repetição.
A D33, decidida e aprovada em 03/08/2026, endureceu exclusivamente o launcher e o protocolo de
evidência. A única invocação `r20260803173036-ddabb07d` terminou com código 0 depois de `close` e
um único envelope `P009_RESULT_V1` íntegro. Fases A/B, P009, oito requests auditados, P007/P008,
D23/D24, cleanup, D26, contagens, locks e fingerprints passaram com `rollback_clean=true`. A D33
foi consumida e não autoriza repetição.
Consulte [`p009-staging-contract.md`](docs/database/p009-staging-contract.md) e o
[`relatório pós-aplicação`](docs/database/p009-post-application-report.md).

## Extração local do XLSX (P010)

O extrator P010 lê exclusivamente as três abas operacionais e produz arquivos locais aderentes ao
contrato JSON v1 do P009. Ele não se conecta ao Supabase, não importa dados e não normaliza
entidades de negócio.

```powershell
npm run ltcm:extract -- --input "C:\caminho\arquivo.xlsx" --output-dir ".artifacts\p010" --strict
```

Quando `npm.cmd` reescapar um caminho com espaços no Windows, use a forma equivalente:

```powershell
npm run ltcm:extract -- "--input=C:\caminho com espaço\arquivo.xlsx" "--output-dir=.artifacts\p010" --strict
```

O diretório de saída recebe manifesto, relatório de validação, lista de erros e um JSONL por aba.
Ele contém dados brutos potencialmente sensíveis, é ignorado pelo Git e só pode ser substituído
quando possui o marcador do próprio extrator. O modo `--strict` transforma desvios estruturais em
erro e código de saída 1, mas ainda grava as linhas extraíveis e os diagnósticos, conforme a
rejeição parcial definida no P009. O formato completo e os códigos de saída estão em
[`p010-local-extractor.md`](docs/import/p010-local-extractor.md).
A validação sanitizada do workbook de referência está em
[`p010-validation-report.md`](docs/import/p010-validation-report.md).

## Normalização local e dry-run (P011)

O P011 consome somente os artefatos P010, extrai candidatos de clientes/projetos e produz um plano
local determinístico. Ele não lê o XLSX, não acessa banco ou rede e não importa itens.

Os contratos v2 representam D40 com lote existente ou planejado, sem UUID ou data artificial. A
fronteira futura resolve lote → clientes → projetos em uma transação; nenhum adapter remoto está
implementado.

D41 impede que um lote já referenciado transite para `rejected`; a linhagem deve ser corrigida para
outro lote permitido por fluxo administrativo e auditado, nunca removida.

```powershell
npm run ltcm:normalize-projects -- `
  --input-dir ".artifacts\p010-real-run-a" `
  --output-dir ".artifacts\p011-dry-run" `
  --strict
```

Use `--existing-snapshot` apenas com snapshot JSON sintético/controlado e `--generated-at` para
fixar um instante ISO UTC nos artefatos. `--apply` sempre retorna
`REMOTE_APPLY_NOT_AUTHORIZED`. Contrato, regras, diagnósticos e riscos estão em
[`p011-normalizer.md`](docs/import/p011-normalizer.md); o dry-run real sanitizado está em
[`p011-validation-report.md`](docs/import/p011-validation-report.md).

## Estrutura

```text
.
|-- apps/
|   `-- web/              # aplicação CRUD React/TypeScript
|-- database/
|   `-- design/           # desenhos SQL não executáveis como migration
|-- docs/                 # arquitetura e convenções
|-- scripts/              # automações do projeto
|-- tools/
|   |-- ltcm-extractor/   # extrator XLSX local e determinístico P010
|   `-- ltcm-normalizer/  # normalização e dry-run local P011
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
