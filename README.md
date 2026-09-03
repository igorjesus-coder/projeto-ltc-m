# LTC-M

Base técnica do sistema de gestão do portfólio LTC-M: frontend React/TypeScript/Vite, fundação do
backend Node.js LTS/TypeScript/NestJS com Express, banco PostgreSQL hospedado no Supabase e camada
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

O frontend integra o fluxo Auth0 da P020 e consome somente a API própria; o scaffold backend P019
e a autenticação usam configurações locais sem credenciais remotas. O
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

O editor de programação mensal P029 está disponível em `/planning`. Ele carrega versões de
planejamento por item, permite editar várias competências e salva o lote atomicamente pela API;
consulte o [contrato P029](docs/planning/p029-monthly-planning-editor.md).

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

Os contratos v2 representam D40 com lote existente ou planejado, sem UUID ou data artificial. O
snapshot local v3 pode carregar a projeção sintética `id`/`idempotency_key`/`source_hash` dos
lotes para provar, de forma fail-closed, que uma referência `planned` corresponde ao UUID já
persistido. A fronteira futura resolve lote → clientes → projetos em uma transação; nenhum
adapter remoto está implementado.

D41 impede que um lote já referenciado transite para `rejected`; a linhagem deve ser corrigida para
outro lote permitido por fluxo administrativo e auditado, nunca removida.

```powershell
npm run ltcm:normalize-projects -- `
  --input-dir ".artifacts\p010-real-run-a" `
  --output-dir ".artifacts\p011-dry-run" `
  --strict
```

Use `--existing-snapshot` apenas com snapshot JSON sintético/controlado e `--generated-at` para
fixar um instante ISO UTC nos artefatos. `--reviewed-resolutions` aceita opcionalmente um documento
local `ltcm.p011.reviewed-resolutions.v1`, vinculado ao manifesto, input e hashes dos candidatos,
snapshot canônico, para resolver somente identidade de cliente e nome/status pendentes de projeto.
`use_existing` exige evidência compatível no snapshot local vinculado. Arquivos com
decisões reais podem conter dados empresariais e devem permanecer fora do Git.
States/actions e a ausência de diagnostics recebidos também são não confiáveis. O normalizador
deriva ambiguidade, blockers D02–D06, associação, provenance e ação esperada do candidate set,
evidências e snapshot disponíveis antes do hash. `client/insert` é reconciliado para `no_op` diante
de um único match ativo compatível; matches múltiplos, indisponíveis ou `create_new` contradito pelo
snapshot falham antes do binding/summary. A derivação global é repetida após qualquer resolução.
`loadP010Source` registra, sob a identidade runtime retornada, uma única materialização canônica
privada dos fatos validados. `normalizeP011` deriva fingerprint e candidates exclusivamente dessa
autoridade privada; `rows`, `get`, `entries`, manifesto e hashes expostos no `LoadedSource` público
permanecem compatíveis para inspeção, mas sua mutação posterior não altera os fatos certificados.
Candidates comuns, cópias, casts, JSON e hashes recalculados podem passar por validação estrutural,
mas não provam provenance P010 nem atravessam
`createReviewBinding`/`applyReviewedResolutions`. Hash de candidate continua provando integridade do
objeto correspondente, não autoridade factual. Moeda não unívoca usa o único código factual
`PROJECT_CURRENCY_UNRESOLVED`; o caller não escolhe entre missing e ambiguous.

Use `--reviewed-resolutions` somente em filesystem local, dentro de diretório privado e controlado
pelo operador, sem ancestral gravável por outro usuário não confiável. UNC/SMB, mapped drive,
network filesystem, cloud-sync e diretórios compartilhados não são suportados para essa entrada;
não execute o normalizador elevado/como administrador nem altere o documento durante a execução.
Paths explicitamente remotos e links presentes no momento da validação são rejeitados, mas o
loader não garante resistência à substituição concorrente do arquivo ou de ancestrais por outro
processo local com permissão de escrita. Esse risco TOCTOU foi identificado, classificado e aceito
para o estágio atual sob essas condições operacionais.

`--apply` sempre retorna `REMOTE_APPLY_NOT_AUTHORIZED`. Contrato, regras, diagnósticos, threat
model e riscos estão em
[`p011-normalizer.md`](docs/import/p011-normalizer.md); o dry-run real sanitizado está em
[`p011-validation-report.md`](docs/import/p011-validation-report.md).

## Fundação do baseline mensal (P013 D02)

O P013 D02 acrescenta somente schema, proveniência, identidade semântica, idempotência e o gate da
fonte mensal. O gate troca a contagem incidental de fórmulas OOXML por um fingerprint semântico
fail-closed, preserva `blank` distinto de zero explícito e congela o arredondamento decimal por
célula. Não há importer/applier mensal nem acesso remoto. Contrato, tabelas e testes estão em
[`p013-monthly-baseline-foundation.md`](docs/import/p013-monthly-baseline-foundation.md).

```powershell
npm run p013:check
npm run test:p013:static
$env:LTCM_P013_INTEGRATION = '1'
npm run test:p013:postgres
```

## Plano canônico e dry-run mensal (P013 D03)

A D03 consome o XLSX somente por uma fonte runtime certificada pelo gate D02, resolve as
identidades P012 contra um snapshot PostgreSQL imutável e produz o plano mensal e seu recibo apenas
em memória. O adapter executa uma transação `REPEATABLE READ READ ONLY`, um único `SELECT` e
`ROLLBACK`; não existe comando de apply ou writer mensal. Contrato, estados, threat model e
validação estão em
[`p013-monthly-baseline-plan-dry-run.md`](docs/import/p013-monthly-baseline-plan-dry-run.md).

```powershell
npm run test:p013:d03
$env:LTCM_P013_D03_INTEGRATION = '1'
npm run test:p013:d03:postgres
```

## Persistência/apply mensal local (P013 D05)

A D05 acrescenta uma capability de apply somente à suíte local de testes. Os hardenings D06A/D06C
mantêm o emissor em escopo léxico dessa suíte e separam import de execução: package imports,
entrypoints `.test` e imports diretos do support compilado são inertes, com namespace vazio e sem
factory, harness, writer, capability mint ou registro em `node:test`. Somente os scripts D05
executam explicitamente o próprio support como entrypoint de um worker real do `node --test`; a
flag de integração apenas seleciona o caso PostgreSQL depois dessa fronteira e não concede
authority a um import. O resultado original do dry-run é ligado por identidade process-local ao
source, adapter, snapshot, plano e harness; o writer não integra `src`, scripts, apps ou frontend e
não aceita pool, client ou SQL do caller. Configuração e ator caller-authored são copiados e
sanitizados antes do fluxo interno. O fluxo usa PostgreSQL 17 `ltcm_test`, `SERIALIZABLE`, locks
advisory em ordem canônica,
`ltc_m_runtime`, RLS/FORCE RLS, releitura de freshness e persistência atômica/idempotente das 432
células e 102 linhas materiais. Generic CLI/remote/production apply permanece proibido. Detalhes e
limites estão em
[`p013-monthly-baseline-local-apply.md`](docs/import/p013-monthly-baseline-local-apply.md).

```powershell
npm run test:p013:d05
$env:LTCM_P013_D05_INTEGRATION = '1'
npm run test:p013:d05:postgres
```

## Descoberta de realizados e impossibilidade controlada (P014 D01)

O P014 D01 aplica a definição aprovada de Realizado à fonte real. A planilha prova valores
`billing_actual` em dois grãos incompletos para `financial_actual_events`: agregado por projeto sem
competência e agregado mensal de portfólio sem projeto. O gate e o dry-run produzem um relatório
determinístico com proveniência e zero writes; nenhuma alocação por previsto foi introduzida.

```powershell
npm run ltcm:analyze-realized -- `
  "--input=.local-source\Previsão_de_Receita_-_LTC-M_com_Curva_S_atualizada.xlsx"
npm run test:p014
```

Contrato, evidências e dados necessários para desbloquear uma importação segura estão em
[`docs/import/p014-realized-import-foundation.md`](docs/import/p014-realized-import-foundation.md).

## Reconciliação e relatório de inconsistências (P015 D01)

O P015 compara snapshots explícitos de projetos, itens, baseline mensal, banco e evidência de
realizado sem criar autoridade de escrita. O relatório é determinístico, preserva proveniência,
expõe decisões pendentes e mantém os dez fatos P014 como evidência de grão insuficiente — nunca como
eventos fabricados.

```powershell
npm run p015:check
npm run test:p015
```

O contrato, os 17 códigos de finding, a ordem canônica e as regras de compatibilidade de grão estão
em [`docs/reconciliation/p015-reconciliation.md`](docs/reconciliation/p015-reconciliation.md).

## Views analíticas para Tableau (P016 D01)

O P016 fornece nove views `ltc_m.v_tableau_*` com contrato `ltcm.p016.analytics.v1`. A camada é
somente leitura, usa `security_invoker`, mantém versão/status/moeda explícitos e pré-agrega ramos
independentes para impedir dupla contagem. A evidência P014 de grão incompleto não é alocada nem
transformada em eventos.

```powershell
npm run p016:check
npm run test:p016:static
```

Grãos, chaves, aditividade, relacionamentos Tableau, segurança e limitações estão em
[`docs/analytics/p016-tableau-views.md`](docs/analytics/p016-tableau-views.md).

## Integridade global, ERD e dicionário de dados (P017 D01)

O P017 congela o contrato `ltcm.p017.schema-integrity.v1` e um fingerprint SHA-256 canônico do
schema `ltc_m`. O acceptance usa PostgreSQL 17 isolado em loopback, aplica as 13 migrations do
zero em dois passes, repete seed e fixture sintética e falha para drift, duplicidade lógica,
perda de RLS/FORCE RLS, chaves ou propriedades das nove views P016.

```powershell
npm run p017:check
npm run test:p017:static
npm run docs:schema:check
```

O [ERD](docs/database/erd.md), o [dicionário de dados](docs/database/data-dictionary.md) e o
[contrato de validação](docs/database/p017-integrity-validation.md) são gerados do mesmo snapshot
canônico versionado. Use `npm run docs:schema:generate` somente para regenerar os Markdown a partir
do snapshot; a captura nominal exige o harness local isolado.

## Scaffold da aplicação CRUD (P018 D01)

O frontend preserva React, Vite e TypeScript e organiza a fundação em composição da aplicação,
layouts, rotas e estilos. O shell possui rota raiz, fallback 404, error boundary, contrato público
de ambiente e baseline semântica de acessibilidade. Ele não implementa CRUD, Auth0, Supabase ou
acesso à API.

```powershell
Copy-Item .env.example apps/web/.env.development.local
npm run dev
npm run p018:check
npm run p018:acceptance
```

O build também funciona sem arquivo `.env` por meio de defaults locais seguros. Estrutura,
variáveis, testes, comandos e limites P018 estão documentados em
[`docs/frontend/p018-crud-scaffold.md`](docs/frontend/p018-crud-scaffold.md).

## Fundação PostgreSQL server-side (P019 D01)

P019 cria o scaffold mínimo `apps/api` em NestJS/Express, usando `pg` exclusivamente no servidor.
A camada oferece configuração fail-closed, pool encerrável, transações com commit/rollback/release
e inicialização parametrizada do contexto P008/RLS na mesma conexão. Não existe cliente Supabase no
browser, Auth0 implementado, CRUD de domínio ou migration nova.

Os tipos de banco em `apps/api/src/database/generated/database.types.ts` são derivados do snapshot
e fingerprint P017. `numeric` e `bigint` permanecem strings exatas. Regeneração, drift, isolamento do
bundle e o contrato completo estão em
[`docs/backend/p019-server-postgres-access.md`](docs/backend/p019-server-postgres-access.md).

```powershell
npm.cmd run db:types:check
npm.cmd run p019:check
npm.cmd run p019:acceptance
```

## Autenticação e sessão Auth0 (P020 D01)

P020 integra o SDK oficial `@auth0/auth0-react` com Authorization Code + PKCE, cache em memória,
rotas protegidas, logout, recuperação de sessão e cliente API com bearer token. O backend valida
JWT por JWKS com `jose` e expõe somente `GET /auth/me` como endpoint de prova. Supabase Auth,
`supabase-js`, acesso browser → PostgreSQL, CRUD de domínio e autorização de negócio permanecem
fora do escopo.

Configure os valores públicos `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID` e
`VITE_AUTH0_AUDIENCE` em `apps/web/.env.development.local`. No backend, configure
`AUTH0_ISSUER_BASE_URL` e `AUTH0_AUDIENCE`; não use client secret no frontend. O contrato completo
está em [`docs/auth/p020-auth0-authentication-session.md`](docs/auth/p020-auth0-authentication-session.md).

```powershell
npm.cmd run p020:check
npm.cmd run p020:acceptance
```

## Estrutura

```text
.
|-- apps/
|   |-- api/              # fundação NestJS/Express + PostgreSQL server-only
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

O workspace contém a fundação backend, ainda sem módulos CRUD:

```text
apps/
|-- web/                  # frontend React/Vite
`-- api/                  # backend NestJS/Express
```

`apps/api` existe desde P019. Tipos de banco permanecem server-only nesse workspace; tipos ou
schemas compartilhados só serão extraídos para pacote dedicado quando houver necessidade concreta.

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
