# P034 — central de qualidade de dados

Contract ID: ltcm.p034.data-quality-center.v3

Emenda documental de `ltcm.p034.data-quality-center.v1`. O fingerprint SHA-256 histórico da v1
é `10ac760c17f64234222979690228be239540233401dc0a6cce4dbb5de3936098`. O fingerprint SHA-256
histórico da v2 (`ltcm.p034.data-quality-center.v2`) é
`42c3b6b73e8c9c0e05d19f11d0c4ea26a90ed21787048343faff2c9bebf01d44`.

Status do Master Control: Não iniciada / 0%.

Este documento formaliza exclusivamente o contrato documental do P034 v3. Não cria API, frontend,
schema, persistência, migration, view, função SQL, índice, enum, policy, grant ou lifecycle de
alerta. A autorização estrutural limitada desta emenda descreve somente uma capability futura de
provenance; nenhum DDL ou writer/reader é implementado nesta execução.

## Objetivo e escopo

O P034 expõe um painel operacional read-only para listar, por projeto, findings de:

1. diferença entre contrato e itens;
2. saldo não programado;
3. item incompleto;
4. projeto desatualizado;
5. duplicidade de identidade de projeto/item;
6. divergência de moeda/unidade.

O painel é observabilidade de qualidade. Um finding, inclusive um finding com severity
BLOCKING herdada de P015/P016, não bloqueia CREATE, UPDATE ou qualquer outro fluxo.

Não fazem parte do MVP: correção inline, dismiss, acknowledge, resolve, owner, comentários,
histórico próprio, exportação, notificações, SLA, gráficos adicionais, bulk actions, FX ou
conversão de unidades.

## Autoridade e dependências

A hierarquia de autoridade é:

- P015 para findings determinísticos, códigos, severidade, valores, evidências, origem,
  explicação, remediação, campos obrigatórios e duplicidades;
- P016 para projeções analíticas, especialmente ltc_m.v_tableau_data_quality;
- P023 para portfólio, busca, filtros, ordenação, paginação, contexto, autorização, alertas
  materializados e saldo sem programação;
- P030 para a semântica financeira do saldo;
- P014, P021, P024, P026, P027, P028, P029, P031, P032 e P033 quando a origem exigir.

Dependências administrativas: 1.15=P015, 1.16=P016 e 2.06=P023. P026 é fonte complementar e
não é a dependência 2.06.

## Envelope QualityFinding

O envelope usa os campos existentes de P015, sem payload paralelo:

    QualityFinding {
      id: string;
      project: { id: string; code?: string; name?: string };
      rule: { code: string; label: string };
      severity: INFO | WARNING | ERROR | BLOCKING;
      expectedValue?: string | null;
      observedValue?: string | null;
      delta?: string | null;
      currencyCode?: string | null;
      origin: {
        findingOrigin?: string | null;
        entity: project | project_item | plan_version | actual_event | import;
        sourceReferences?: QualityReference[];
        databaseReferences?: QualityReference[];
      };
      evidence?: Record<string, unknown>;
      explanation?: string;
      remediation?: string;
      navigationAction?: QualityNavigationAction;
    }

QualityReference preserva a estrutura e os locators de P015Reference. Referências, IDs, status ou
valores não legíveis pelo ator não são incluídos.

expectedValue, observedValue e delta são strings canônicas. Para valores monetários, escala e
aritmética seguem P013/P014/P015. Os três campos são opcionais porque algumas regras possuem
somente evidência temporal, textual ou de identidade. currencyCode só aparece quando há moeda
aplicável.

O campo value do Master Control é representado pela combinação desses campos existentes.

Os labels dos códigos do MVP são estáveis e pertencem ao contrato: `PROJECT_VALUE_MISMATCH`
(Contrato x item), `UNPLANNED_BALANCE` (Saldo não programado), `MISSING_REQUIRED_FIELD` (Item
incompleto), `PROJECT_DATA_STALE` (Projeto desatualizado), os dois códigos elegíveis de duplicidade
(Duplicidade) e `GRAIN_MISMATCH` (Divergência de moeda/unidade). `IMPORT_DUPLICATION` permanece
P015-only e não integra o catálogo operacional P034.

## Identidade e lifecycle

P034 continua `DERIVED_READ_ONLY`: findings são sempre derivados e não são fatos persistidos de
negócio. A emenda autoriza somente a persistência futura de fatos mínimos, imutáveis e append-only
de provenance/snapshot necessários para reconstruir os fatos/observações P015 relevantes para as duas
duplicidades elegíveis ao P034. Isso
nunca cria uma tabela de findings, registro de alerta ou estado operacional de QualityFinding.

Para findings existentes, id, código e referências determinísticas de P015/P016 são preservados.
Para regras novas, a identidade conceitual é determinística por:

    rule code + project id + origin entity + origin entity id

O resultado desaparece quando a fonte deixa de satisfazer a condição. Não há acknowledge, dismiss,
ignored, owner, comments, resolved, closed, snooze ou histórico P034.

### Provenance mínima autorizada pela emenda v3

Razão estrutural: `P034_CONTRACT_RUNTIME_SOURCE_GAP`.

`P034-D16 = HUMAN_DECISION_APPROVED` e a estratégia aprovada é a Opção A:
`PERSIST_SOURCE_FACTS_NOT_FINDINGS`. P034 pode persistir exclusivamente os fatos mínimos imutáveis
de provenance/snapshot necessários para reconstruir os fatos P015 elegíveis ao envelope operacional
P034 de:

- `DUPLICATE_PROJECT_SOURCE_IDENTITY`;
- `DUPLICATE_ITEM_SOURCE_IDENTITY`.

Não pode persistir `QualityFinding`, status de finding, lifecycle, acknowledgement, resolution,
dismissal, owner, comentários, severity como estado ou cache tratado como autoridade. Provenance é
evidência de origem; o finding continua sendo recomputado.

`P034-D17 = HUMAN_DECISION_APPROVED`. A central operacional usa somente o
`LATEST_SUCCESSFUL_AUTHORITATIVE_SNAPSHOT` aplicável a cada escopo lógico. O snapshot selecionado
deve ter status `SUCCESS` e ser autoritativo para o escopo. O mais recente é escolhido por uma
ordenação determinística: maior ordem factual de conclusão autoritativa prevista pelo modelo de
ingestão e, em caso de empate, identificador ou fingerprint determinístico. O DDL futuro deve
formalizar os campos factuais dessa ordem sem inventar semântica baseada apenas em relógio de
parede. Snapshots anteriores não participam de `items`, `totalItems`, filtros ou severity atual.
Quando uma duplicidade presente no snapshot N deixa de existir no snapshot N+1 selecionado, ela
desaparece naturalmente da central; isso não é lifecycle de finding.

Snapshots são imutáveis. Um novo snapshot não edita o anterior: ele pode se tornar o snapshot
operacional selecionado e os findings são derivados novamente. Qualquer cache futuro deve ser
vinculado ao fingerprint do snapshot e nunca substituir a autoridade factual.

`P034-D18 = HUMAN_DECISION_APPROVED`. No MVP, aplica-se `NO_AUTOMATIC_PROVENANCE_PURGE` e
`PROVENANCE_RETENTION_POLICY_DEFERRED`. Não há TTL de 30 dias, 90 dias, um ano ou outro prazo
arbitrário. Snapshots/provenance permanecem retidos até política formal posterior; isso não define
retenção infinita como política normativa definitiva.

`P034-D19 = HUMAN_DECISION_APPROVED`. P034 permanece central operacional do estado atual. O MVP
não cria histórico de snapshots, seletor, timeline, endpoint histórico, comparação histórica,
histórico de findings ou página de provenance. Snapshots anteriores podem existir internamente
para reprodutibilidade, mas não são expostos pela API/UI operacional P034.

### Requisitos conceituais de estrutura futura

`P034-D20 = HUMAN_DECISION_APPROVED`. A antiga proibição absoluta `NO_MIGRATION_REQUIRED` é
superada somente pelo gap de provenance. Fica autorizada, de forma estritamente limitada,
`P034_PROVENANCE_STRUCTURE_AUTHORIZED` para o mínimo necessário a:

1. envelope e identidade do snapshot;
2. observações de projetos da fonte;
3. observações de itens da fonte;
4. referências ou fingerprints sanitizáveis;
5. associação das observações ao snapshot e ao escopo/projeto autorizado.

O modelo conceitual é append-only/immutable provenance. Este contrato não congela nomes de tabelas
nem escolhe entre extensão segura de `import_staging_rows` e estruturas novas específicas; essa
comparação pertence ao design DDL futuro. `import_staging_rows` é apenas parcialmente adequado
hoje. A estrutura futura não pode autorizar tabela de alerts ou `QualityFinding`, lifecycle,
cache autoritativo, materialized view, trigger de alert ou workflow de resolução.

O envelope deve representar identidade determinística, fingerprint, escopo, status de ingestão,
conclusão autoritativa, origem, criação/conclusão e pertencimento ao tenant/projeto quando
aplicável. Observações de projetos e itens devem preservar todas as ocorrências relevantes antes
da deduplicação normalizada. Para itens, isso inclui combinações repetidas de
`project_code + source_line_key`. A multiplicidade de `import_identities` permanece responsabilidade
do P015, mas não integra a provenance P034 v3. Referências devem conter somente fatos
necessários para reconstruir referências P015 com segurança; locator sensível bruto não é exigido.

É obrigatório preservar `SOURCE_OCCURRENCE_CARDINALITY_MUST_BE_PRESERVED`. A captura deve ocorrer
antes que unique constraint, upsert, normalização, deduplicação ou rejeição removam a multiplicidade
necessária ao P015. Storage contendo apenas o registro aceito não satisfaz D16.

`P034-D21 = HUMAN_DECISION_APPROVED`. Qualquer estrutura futura de provenance deve possuir
isolamento por escopo/projeto/tenant, RLS e FORCE RLS, actor transaction nas leituras da API,
grants mínimos e proteção contra cross-project, batch enumeration e source reference leakage.
P034 API recebe somente referências sanitizadas autorizadas. Não pode expor raw payload arbitrário,
path local ou de workstation, connection string, secret, token, bucket privado, locator sensível
ou conteúdo reservado. `totalItems` não pode revelar provenance não autorizado.
Observações elegíveis sem `project_id` direto devem ser associadas a um snapshot e escopo autorizados
antes de qualquer leitura; não podem servir para enumerar projetos ou atravessar isolamento.

`receipt_actual` permanece fora do universo funcional P034. A provenance autorizada não concede
visibilidade de `receipt_actual`, IDs, status ou valores reservados; D16–D26 não alteram P032/P033.

`P034-D22 = HUMAN_DECISION_APPROVED` e `P015_UNCHANGED`. O algoritmo e o contrato P015 permanecem
semanticamente inalterados. O adapter futuro de provenance deve reconstruir as observações P015
relevantes suficientes para reproduzir com paridade os findings P015 elegíveis ao P034 —
`DUPLICATE_PROJECT_SOURCE_IDENTITY` e `DUPLICATE_ITEM_SOURCE_IDENTITY` — e não precisa armazenar
nem reconstruir `import_identities` para a central. Isso não autoriza passar um payload parcial à
função P015 existente: a implementação futura deverá reutilizar uma primitiva de domínio
compartilhada ou extrair uma primitiva pura sem mudança semântica do contrato P015. Se o design
exigir mudança semântica em P015, deve parar com `P034_P015_CONTRACT_CHANGE_REQUIRED`.

Antes de qualquer implementação, esse adapter deve provar paridade com fixtures equivalentes para
cada código de duplicidade elegível: mesmo fato lógico, código, severity, domínio, identidade
determinística, project, provenance relevante, ausência de falso positivo e ausência de falso
negativo. `IMPORT_DUPLICATION` permanece coberto exclusivamente pelos testes próprios P015 e não
participa do gate de paridade do adapter P034.

O writer futuro deve capturar provenance no pipeline de importação/normalização antes da perda de
cardinalidade das observações de projeto/item, com idempotência por snapshot e atomicidade coerente.
Snapshot incompleto nunca se torna autoritativo; falha parcial nunca produz `SUCCESS`; ocorrências
duplicadas de projeto/item são preservadas.
Idempotência por snapshot significa que um retry não duplica a mesma captura já aceita; ela não
deduplica as ocorrências internas legítimas de projeto/item do snapshot, que continuam preservadas.
O reader futuro seleciona apenas o snapshot autoritativo atual permitido ao ator, consulta fatos
autorizados, monta o adapter P015, deriva findings, normaliza-os em `QualityFinding` e só então
aplica filtros/paginação. Nunca retorna provenance raw.

`P034-D23 = HUMAN_DECISION_APPROVED`. O PR funcional #29 permanece aberto e não mergeado. As
correções locais independentes da provenance permanecem preservadas fora desta branch documental:
`GRAIN_MISMATCH`, paridade de `MISSING_REQUIRED_FIELD`, parser/frontend e os testes
correspondentes. Esta decisão é operacional/de governança e não altera a semântica do domínio.

### Emenda v3: escopo por projeto da duplicidade de importação

`P034-D24 = HUMAN_DECISION_APPROVED`. `IMPORT_DUPLICATION` permanece integralmente uma regra P015.
P034 não altera seu payload, finding, severity, domínio, identidade, explanation, remediation ou
semântica de portfólio. No P015, `IMPORT_DUPLICATION` pode continuar com `project_id = null` e
`project_code = null`; esse é um resultado válido do P015.

`IMPORT_DUPLICATION_NOT_P034_MVP_ELIGIBLE`: P034 exige projeto factual e autorizado para cada
finding operacional. Como `import_identities: string[]` não possui autoridade que associe cada
ocorrência a exatamente um projeto, o adapter/reader P034 não agrega esse código no MVP. Não pode
atribuir o primeiro projeto do batch, um projeto arbitrário, todos os projetos, `projectId` fabricado,
posição, source path ou import batch. `project` continua obrigatório no `QualityFinding`; não há
exceção de projeto ausente para essa regra.

`P034-D25 = HUMAN_DECISION_APPROVED`. A família funcional `Duplicidade` do P034 é satisfeita
exatamente por:

1. `DUPLICATE_PROJECT_SOURCE_IDENTITY`;
2. `DUPLICATE_ITEM_SOURCE_IDENTITY`.

`P034_DUPLICATE_RULE_SET = {
  DUPLICATE_PROJECT_SOURCE_IDENTITY,
  DUPLICATE_ITEM_SOURCE_IDENTITY
}`

`IMPORT_DUPLICATION` não integra o catálogo, endpoint, paginação ou filtros operacionais P034. Isso
não depreca, remove ou reduz cobertura do P015; seus testes, relatório e portfolio summary continuam
inalterados.

`P034-D26 = HUMAN_DECISION_APPROVED`. A provenance P034 armazena somente o conjunto factual mínimo
necessário para reconstruir `DUPLICATE_PROJECT_SOURCE_IDENTITY` e `DUPLICATE_ITEM_SOURCE_IDENTITY`:
snapshot envelope, project source observations, item source observations e source references ou
fingerprints sanitizáveis. Não inclui armazenamento genérico de ocorrências de identidade de importação, multiconjunto de
`import_identities`, associação de import identity a projeto ou tabela criada unicamente para
`IMPORT_DUPLICATION`.

D24–D26 são decisões posteriores e específicas que refinam D05, D16, D20 e D22 somente no conflito
relacionado a `IMPORT_DUPLICATION`. Elas não reabrem as demais decisões P034. A família duplicidade
do Master Control permanece coberta por projeto e item, e o Master Control continua
`Não iniciada / 0%`.

## Catálogo de regras

| Família              | Código(s)                                                         | Origem    | Severidade                 | Semântica                                                                      |
| -------------------- | ----------------------------------------------------------------- | --------- | -------------------------- | ------------------------------------------------------------------------------ |
| contrato x item      | findings P015/P016, incluindo PROJECT_VALUE_MISMATCH              | P015/P016 | original                   | contract_value versus total derivado dos itens ativos compatíveis              |
| saldo não programado | UNPLANNED_BALANCE                                                 | P023/P030 | WARNING                    | saldo canônico maior que zero                                                  |
| item incompleto      | MISSING_REQUIRED_FIELD                                            | P015      | original, atualmente ERROR | ausência de description, quantity, unit_code ou currency_code                  |
| dado desatualizado   | PROJECT_DATA_STALE                                                | projects  | WARNING                    | updated_at com mais de 30 dias corridos                                        |
| duplicidade          | DUPLICATE_PROJECT_SOURCE_IDENTITY, DUPLICATE_ITEM_SOURCE_IDENTITY | P015      | original, atualmente ERROR | somente findings P015 elegíveis com projeto                                    |
| moeda/unidade        | GRAIN_MISMATCH quando aplicável                                   | P015/P034 | original; mismatch ERROR   | moeda divergente ou unidade literalmente diferente com referência autoritativa |

P034 não cria detector adicional de duplicidade, não reimplementa P033 e não agrega
`IMPORT_DUPLICATION`.

## Contrato x item

A regra formal é P034_CONTRACT_ITEM_SCOPE_REUSE_P015_P016.

Comparam-se somente:

- projects.contract_value como valor contratual;
- soma dos totais derivados dos itens ativos, não excluídos e monetariamente compatíveis.

Não entram nessa regra opening_balance, budget_cost, planejamento, realizado, datas, texto,
unidade ou comparação campo-a-campo. Findings próprios dessas dimensões podem ser agregados sob
seus códigos específicos.

Não se cria tolerância: a comparação é exata segundo P015/P016. Moedas incompatíveis não são
somadas e produzem o finding de incompatibilidade aplicável.

## Saldo não programado

O contrato usa exatamente:

    max(contract_value - billing_actual_posted - billing_planned, 0)

billing_actual_posted soma somente eventos billing_actual com status posted. Actual draft,
cancelled, estados não concretizados, receipt_forecast e métricas reservadas são excluídos.

billing_planned considera somente linhas billing_planned no grão item, da única versão oficial do
projeto em estado approved ou locked. Sem versão oficial, com múltiplas versões oficiais, com
moeda incompatível ou com dados insuficientes, o P034 não fabrica UNPLANNED_BALANCE; preserva o
estado fail-closed da fonte.

Para UNPLANNED_BALANCE:

- expectedValue = "0";
- observedValue = unplanned_balance;
- delta = unplanned_balance;
- currencyCode = moeda base do projeto;
- condição: unplanned_balance > 0;
- severity: WARNING.

O P034 não duplica o warning textual do P030/P023; apenas agrega o finding normalizado.

## Item incompleto

P034 consome exclusivamente MISSING_REQUIRED_FIELD de P015. O conjunto factual é:

- description;
- quantity;
- unit_code;
- currency_code.

Embora description seja nullable no modelo físico, ela é obrigatória na entrada factual P015.
item_code é opcional e sua ausência nunca gera finding. Campos estruturais que o parser valida,
mas que não geram MISSING_REQUIRED_FIELD, também não criam regra paralela P034.

## Dado desatualizado

Código: PROJECT_DATA_STALE.

- entidade: project;
- origem: projects;
- timestamp: projects.updated_at;
- relógio: instante atual do backend em UTC;
- threshold: 30 dias corridos;
- condição: now - projects.updated_at > 30 days;
- severity: WARNING.

O finding é emitido somente quando o intervalo é estritamente superior a 30 dias completos.
Exatamente 30 dias não gera finding. Timestamps são comparados como instantes absolutos,
independentemente do fuso de apresentação. updated_at nulo não é convertido em idade ou zero;
o schema atual o torna impossível; se uma projeção defensiva encontrar null, a consulta falha
explicitamente em modo fail-closed e não produz finding.

Não há threshold por item, planejamento, realizado, importação ou projeto; não há calendário útil,
SLA variável ou alteração de updated_at.

Para a regra nova, observedValue é o timestamp UTC observado e a evidência contém o instante de
avaliação e o threshold aplicado; expectedValue e delta permanecem nulos quando não aplicáveis.

## Duplicidade

P034 agrega apenas os findings P015 elegíveis ao envelope operacional por projeto:

- DUPLICATE_PROJECT_SOURCE_IDENTITY;
- DUPLICATE_ITEM_SOURCE_IDENTITY;

P033 permanece autoridade exclusiva do conflito moderno de
financial_actual_events(project_id, source_key), incluindo 409 P033_SOURCE_KEY_CONFLICT, savepoint
e UX de abrir lançamento existente. P034 não reproduz essa UX nem reconstrói o detector.

Os dois códigos continuam semanticamente os findings P015 autorizados ao P034. A persistência
futura de fatos mínimos de provenance apenas permite reconstruir as observações P015 elegíveis; ela
não transforma P033 em substituto semântico: `P033_NOT_SEMANTIC_REPLACEMENT_FOR_P015_DUPLICATES`.
O conflito P033 não é finding P034 persistido: `P033_CONFLICT_NOT_PERSISTED_FINDING`.

## Moeda e unidade

A moeda base do projeto é autoritativa. Itens, planejamento e realizados devem obedecer à
autoridade de moeda vigente. Moedas incompatíveis não são somadas; cálculos dependentes de
compatibilidade falham fechado e findings existentes são preservados.

Não há FX, conversão cambial ou normalização monetária automática.

Unidade só gera divergência quando existe referência autoritativa aplicável à mesma entidade,
item e contexto, ambos os códigos são conhecidos e os códigos são literalmente diferentes. Sem
referência comparável não há finding: `NO_AUTHORITATIVE_UNIT_COMPARISON_AVAILABLE`. Não se inferem
equivalências como kg/t, h/dia ou un/m.

## Origem, evidência e remediação

origin projeta a origem/proveniência existente do finding, preservando a distinção entre fonte,
database projection, planejamento, realizados, importação e master data. explanation e remediation
são preservados de P015/P016 quando presentes.

Correções são executadas nos módulos de origem, com suas próprias trilhas de auditoria. A central
é somente leitura.

## Ação de navegação

O backend retorna semântica e identificadores, nunca URL arbitrária:

    QualityNavigationAction {
      target: project | project_item | planning | realized_event | master_data;
      projectId?: string;
      entityId?: string;
      entityCode?: string;
    }

O frontend resolve somente rotas existentes:

- project: /projects/:projectId;
- project_item: /projects/:projectId/items;
- planning: /projects/:projectId/planning;
- realized_event: /projects/:projectId/realized-events;
- master_data: /admin/clients, somente quando autorizada.

O retorno do detalhe reutiliza returnTo validado de P023, preservando query string e contexto.
Não são aceitos URL externa, javascript:, caminho arbitrário vindo da origem ou destino sem
permissão. Quando a ação não for segura ou aplicável, ela é omitida.

## API read-only futura

Rota semântica: GET /quality/findings.

Autorização: Auth0, perfil ativo, capabilities data:read e financial:read, além de RLS/FORCE
RLS e isolamento por projeto. Nenhuma ACL nova é criada.

Envelope:

    {
      "contract": "ltcm.p034.data-quality-center.v3",
      "items": [],
      "page": 1,
      "pageSize": 25,
      "totalItems": 0,
      "totalPages": 0
    }

Parâmetros:

- projectId: UUID do projeto;
- rule: código allowlisted;
- severity: INFO, WARNING, ERROR ou BLOCKING;
- origin: entidade allowlisted: project, project_item, plan_version, actual_event ou import;
- search: busca parcial case-insensitive, com escaping P023, somente em project.code,
  project.name, rule.code, rule.label, origin.findingOrigin e origin.entity;
- sort: severity, project, rule, origin ou id;
- order: asc ou desc;
- page: inteiro positivo, default 1;
- pageSize: inteiro de 1 a 100, default 25.

Filtros e paginação são server-side. A ordenação padrão é determinística por project.code ASC,
rule.code ASC e id ASC. `severity` usa a ordem P015 BLOCKING, ERROR, WARNING, INFO; `project`,
`rule` e `origin` usam seus códigos textuais canônicos. Todas as ordenações terminam em id ASC.
Não há saved filters, saved views, export ou bulk action.

Resposta vazia é sucesso com items=[], totalItems=0 e totalPages=0. Query inválida falha com
erro 400 estruturado. Falha técnica em origem autorizada encerra explicitamente a consulta; não
retorna resposta parcial silenciosa nem infere zero inconsistências. Dados não autorizados são
excluídos fail-closed sem revelar existência, contagem, ID ou resumo.

## Frontend futuro

A futura central fornece loading, erro, vazio, lista/tabela, filtros, paginação, projeto, regra,
severity, valores, origem e ação de navegação quando segura.

Deve reutilizar padrões P022/P023 de query string, contexto, returnTo, autenticação, autorização,
estados de erro e acessibilidade. Não inclui edição inline, resolve, dismiss, acknowledge,
exportação, notificações, SLA ou gráficos adicionais.

## Segurança e auditoria

O navegador acessa somente a API. A API consulta dentro do contexto do ator. RLS/FORCE RLS é a
barreira definitiva; P034 não cria policy, grant ou capability nesta emenda. Grants e policies
futuros devem ser mínimos e específicos à estrutura de provenance, depois de design e revisão
próprios.

P034 não amplia visibilidade de receipt_actual, eventos reservados, IDs ocultos, status ocultos ou
valores restritos de P014/P032/P033. Se uma origem necessária não for legível no contexto,
aplica-se fail-closed.

Consulta da central não cria audit log. Operações de correção continuam usando auditorias dos
módulos responsáveis.

`AUDIT_LOG_NOT_VALID_P015_PROVENANCE_SOURCE`: o `audit_log` P007 não é fonte válida para reconstruir
as regras de duplicidade P015, inclusive `IMPORT_DUPLICATION`. Auditoria operacional não substitui os fatos de origem capturados pelo
provenance autorizado em D16.

## Estrutura e performance

O MVP continua composição read-only no backend para findings. Nenhuma estrutura é criada nesta
execução. A autorização conceitual limitada exige que uma implementação posterior reconheça
`PROVENANCE_MIGRATION_REQUIRED_BUT_NOT_YET_AUTHORIZED_FOR_EXECUTION`: haverá pelo menos uma
migration futura de provenance, com quantidade e nome ainda indefinidos, append-only e segura. O
design estrutural deve ser formalizado e revisado antes da migration; nenhum DDL é autorizado por
esta PR documental. Não criar tabela de alert/finding, materialized view, view nova, função SQL,
índice, enum, RLS, FORCE RLS ou grant agora.

Esta emenda não incrementa o inventário atual de migrations, que permanece em `18`; P009 continua
somente na baseline conhecida.

O reader futuro deve usar paginação server-side, evitar N+1 e preservar isolamento por projeto.

É obrigatório evitar N+1 e preservar isolamento por projeto. Se a consulta real não atender
cardinalidade, latência ou paginação sem nova estrutura, a implementação deve parar e emitir
P034_STRUCTURAL_DECISION_REQUIRED antes de qualquer alteração estrutural.

## Matriz de decisões

| Decisão  | Estado                         | Formalização                                                                                                                                |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P034-D01 | RESOLVED_BY_EXISTING_AUTHORITY | reutilizar expected/observed/delta, moeda, evidências, referências, explicação e remediação P015                                            |
| P034-D02 | HUMAN_DECISION_APPROVED        | findings existentes preservam severity; stale e saldo são WARNING; nenhuma regra nova é BLOCKING                                            |
| P034-D03 | RESOLVED_BY_EXISTING_AUTHORITY | consumir MISSING_REQUIRED_FIELD e seus quatro campos factuais                                                                               |
| P034-D04 | HUMAN_DECISION_APPROVED        | PROJECT_DATA_STALE, projeto, updated_at, UTC, superior a 30 dias corridos, WARNING                                                          |
| P034-D05 | RESOLVED_BY_EXISTING_AUTHORITY | agregar somente findings P015 elegíveis ao envelope por projeto; na duplicidade, somente project/item                                       |
| P034-D06 | HUMAN_DECISION_APPROVED        | moeda sem conversão; unidade somente com referência autoritativa e diferença literal                                                        |
| P034-D07 | RESOLVED_BY_EXISTING_AUTHORITY | findings `DERIVED_READ_ONLY`, sem tabela/UUID persistido de finding P034; facts de provenance seguem D16–D20 conforme refinados por D24–D26 |
| P034-D08 | NO_LONGER_APPLICABLE           | NO_P034_ALERT_LIFECYCLE; desaparecimento automático quando a fonte for corrigida                                                            |
| P034-D09 | RESOLVED_BY_EXISTING_AUTHORITY | herdar P023: server-side, página 1, 25/100, query string, contexto e ordenação determinística                                               |
| P034-D10 | RESOLVED_BY_EXISTING_AUTHORITY | não autorizado é ocultado; falha técnica autorizada encerra explicitamente a consulta                                                       |
| P034-D11 | HUMAN_DECISION_APPROVED        | action estruturada com target e IDs; frontend resolve rotas existentes e returnTo seguro                                                    |
| P034-D12 | RESOLVED_BY_EXISTING_AUTHORITY | composição read-only; estrutura de provenance somente no limite D16–D20 conforme refinado por D24–D26; demais gaps exigem decisão           |
| P034-D13 | RESOLVED_BY_EXISTING_AUTHORITY | 1.15=P015, 1.16=P016, 2.06=P023; P026 é complementar                                                                                        |
| P034-D14 | HUMAN_DECISION_APPROVED        | UNPLANNED_BALANCE, saldo > 0, WARNING, fórmula P023/P030, sem duplicar warning textual                                                      |
| P034-D15 | RESOLVED_BY_EXISTING_AUTHORITY | P034_CONTRACT_ITEM_SCOPE_REUSE_P015_P016                                                                                                    |
| P034-D16 | HUMAN_DECISION_APPROVED        | Opção A: persistir somente facts mínimos imutáveis das duas duplicidades elegíveis; `PERSIST_SOURCE_FACTS_NOT_FINDINGS`                     |
| P034-D17 | HUMAN_DECISION_APPROVED        | somente `LATEST_SUCCESSFUL_AUTHORITATIVE_SNAPSHOT`, com seleção determinística e findings recomputados                                      |
| P034-D18 | HUMAN_DECISION_APPROVED        | `NO_AUTOMATIC_PROVENANCE_PURGE`; `PROVENANCE_RETENTION_POLICY_DEFERRED`                                                                     |
| P034-D19 | HUMAN_DECISION_APPROVED        | `NO_P034_HISTORY_UI`; snapshots anteriores não entram na API/UI operacional                                                                 |
| P034-D20 | HUMAN_DECISION_APPROVED        | `P034_PROVENANCE_STRUCTURE_AUTHORIZED`, somente envelope/observações/referências de project/item; DDL futuro não autorizado                 |
| P034-D21 | HUMAN_DECISION_APPROVED        | isolamento por escopo, RLS/FORCE RLS, actor transaction, grants mínimos e referências sanitizadas                                           |
| P034-D22 | HUMAN_DECISION_APPROVED        | `P015_UNCHANGED`; adapter futuro e paridade somente das duplicidades project/item elegíveis                                                 |
| P034-D23 | HUMAN_DECISION_APPROVED        | PR #29 aberto/não mergeado; quatro correções locais preservadas fora da branch documental                                                   |
| P034-D24 | HUMAN_DECISION_APPROVED        | `IMPORT_DUPLICATION` permanece P015-only; P015 pode manter project nulo; P034 não altera sua semântica                                      |
| P034-D25 | HUMAN_DECISION_APPROVED        | `P034_DUPLICATE_RULE_SET` contém somente project e item; `IMPORT_DUPLICATION` é inelegível no MVP                                           |
| P034-D26 | HUMAN_DECISION_APPROVED        | provenance P034 reduzida a envelope, project/item observations e referências; sem storage de import identities                              |

## Testes contratuais futuros

### Findings e valores

- contrato x item: mismatch, igualdade, itens inativos, total derivado e ausência de falso positivo;
- saldo: positivo gera finding; zero não gera; piso zero; posted conta; draft/cancelled não contam;
  versão oficial conta; ausência, multiplicidade e moeda incompatível falham fechado;
- item incompleto: cada um dos quatro campos, múltiplos campos, item_code ausente sem finding e
  consumo do finding P015;
- staleness: 29 dias, exatamente 30 dias, superior a 30 dias, UTC, boundary e relógio
  determinístico;
- duplicidade: `DUPLICATE_PROJECT_SOURCE_IDENTITY` e `DUPLICATE_ITEM_SOURCE_IDENTITY` aparecem no P034; `IMPORT_DUPLICATION` permanece somente nos testes P015; P033 não é reimplementado;
- provenance: fatos mínimos reconstroem exatamente as observações P015 relevantes das duas regras elegíveis, sem persistir findings;
- snapshot: somente `SUCCESS` autoritativo mais recente participa da derivação e a ordenação é
  determinística;
- retenção: nenhum purge automático e nenhuma UI histórica;
- cardinalidade: ocorrências de projeto e item repetidas não são perdidas antes da captura;
- moeda/unidade: currency mismatch, currency match, unidade literal com referência, ausência de
  referência sem finding e nenhuma conversão;
- severity: preservação dos findings existentes, stale WARNING e saldo WARNING;
- value: expected, observed, delta, currency e campos opcionais;
- origin/evidence: origem correta, entidade correta e ausência de dados restritos.

### API, autorização e navegação

- autenticação, capability, projeto autorizado, projeto não autorizado, cross-project, RLS,
  FORCE RLS e ausência de receipt_actual;
- action válida para projeto, item, planejamento, realizado e master data;
- returnTo, query preservada, destino sem permissão e ausência de open redirect;
- filtros, ordenação determinística, página 1, default 25 e máximo 100;
- erro explícito de origem autorizada, ausência fail-closed de origem não autorizada e ausência de
  resposta parcial silenciosa.

### UI e performance

- loading, error, empty, findings, múltiplas severities, ação ausente e múltiplos alertas;
- paginação server-side, cardinalidade, ausência de N+1 e limite de página;
- desaparecimento automático após correção da fonte;
- nenhum fluxo de lifecycle ou mutação P034.

## Critério de aceite

Cada finding exposto possui projeto, regra, valor representado por expected/observed/delta quando
aplicável, severity, origem e ação de navegação quando segura. O painel mantém a semântica e a
severity dos findings existentes, aplica as regras novas autorizadas e permanece read-only,
fail-closed e sem persistência própria.

O contrato v3 também exige que qualquer implementação futura mantenha `QualityFinding` não
persistido, sem lifecycle, reconstrua as duas duplicidades elegíveis por adapter P015 com paridade comprovada,
selecione apenas o snapshot autoritativo atual e não exponha provenance raw. O Master Control
permanece `Não iniciada / 0%`.

## Restrições de implementação

Qualquer implementação futura deve preservar P015, P016, P023, P030, P032 e P033. Não pode alterar
CREATE/UPDATE de outras áreas, adicionar ACL fora do design autorizado, mudar schema sem migration
formalmente revisada ou introduzir conversão. A migration futura fica limitada à provenance mínima
aprovada; não autoriza alert/finding, lifecycle ou cache autoritativo. Uma necessidade estrutural
fora desse limite exige parada e P034_STRUCTURAL_DECISION_REQUIRED.
