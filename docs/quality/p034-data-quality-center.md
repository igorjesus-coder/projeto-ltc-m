# P034 — central de qualidade de dados

Contract ID: ltcm.p034.data-quality-center.v1

Status do Master Control: Não iniciada / 0%.

Este documento formaliza exclusivamente o contrato documental do P034. Não cria API, frontend,
persistência, migration, view, função SQL, índice, enum, policy, grant ou lifecycle de alerta.

## Objetivo e escopo

O P034 expõe um painel operacional read-only para listar, por projeto, findings de:

1. diferença entre contrato e itens;
2. saldo não programado;
3. item incompleto;
4. projeto desatualizado;
5. duplicidade de fonte/importação;
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

## Identidade e lifecycle

P034 é DERIVED_READ_ONLY. Não existe tabela P034 nem registro persistido de alerta.

Para findings existentes, id, código e referências determinísticas de P015/P016 são preservados.
Para regras novas, a identidade conceitual é determinística por:

    rule code + project id + origin entity + origin entity id

O resultado desaparece quando a fonte deixa de satisfazer a condição. Não há acknowledge, dismiss,
ignored, owner, comments, resolved, closed, snooze ou histórico P034.

## Catálogo de regras

| Família              | Código(s)                                                                             | Origem    | Severidade                 | Semântica                                                                      |
| -------------------- | ------------------------------------------------------------------------------------- | --------- | -------------------------- | ------------------------------------------------------------------------------ |
| contrato x item      | findings P015/P016, incluindo PROJECT_VALUE_MISMATCH                                  | P015/P016 | original                   | contract_value versus total derivado dos itens ativos compatíveis              |
| saldo não programado | UNPLANNED_BALANCE                                                                     | P023/P030 | WARNING                    | saldo canônico maior que zero                                                  |
| item incompleto      | MISSING_REQUIRED_FIELD                                                                | P015      | original, atualmente ERROR | ausência de description, quantity, unit_code ou currency_code                  |
| dado desatualizado   | PROJECT_DATA_STALE                                                                    | projects  | WARNING                    | updated_at com mais de 30 dias corridos                                        |
| duplicidade          | DUPLICATE_PROJECT_SOURCE_IDENTITY, DUPLICATE_ITEM_SOURCE_IDENTITY, IMPORT_DUPLICATION | P015      | original, atualmente ERROR | somente findings P015 autorizados                                              |
| moeda/unidade        | GRAIN_MISMATCH quando aplicável                                                       | P015/P034 | original; mismatch ERROR   | moeda divergente ou unidade literalmente diferente com referência autoritativa |

P034 não cria detector adicional de duplicidade e não reimplementa P033.

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
resulta em ausência de finding ou falha estrutural da fonte conforme o contrato vigente.

Não há threshold por item, planejamento, realizado, importação ou projeto; não há calendário útil,
SLA variável ou alteração de updated_at.

Para a regra nova, observedValue é o timestamp UTC observado e a evidência contém o instante de
avaliação e o threshold aplicado; expectedValue e delta permanecem nulos quando não aplicáveis.

## Duplicidade

P034 agrega apenas:

- DUPLICATE_PROJECT_SOURCE_IDENTITY;
- DUPLICATE_ITEM_SOURCE_IDENTITY;
- IMPORT_DUPLICATION.

P033 permanece autoridade exclusiva do conflito moderno de
financial_actual_events(project_id, source_key), incluindo 409 P033_SOURCE_KEY_CONFLICT, savepoint
e UX de abrir lançamento existente. P034 não reproduz essa UX nem reconstrói o detector.

## Moeda e unidade

A moeda base do projeto é autoritativa. Itens, planejamento e realizados devem obedecer à
autoridade de moeda vigente. Moedas incompatíveis não são somadas; cálculos dependentes de
compatibilidade falham fechado e findings existentes são preservados.

Não há FX, conversão cambial ou normalização monetária automática.

Unidade só gera divergência quando existe referência autoritativa aplicável à mesma entidade,
item e contexto, ambos os códigos são conhecidos e os códigos são literalmente diferentes. Sem
referência comparável não há finding. Não se inferem equivalências como kg/t, h/dia ou un/m.

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
- project_item: contexto de itens do projeto;
- planning: contexto de planejamento do projeto;
- realized_event: /projects/:projectId/realized-events;
- master_data: rota administrativa vigente, somente quando autorizada.

O retorno do detalhe reutiliza returnTo validado de P023, preservando query string e contexto.
Não são aceitos URL externa, javascript:, caminho arbitrário vindo da origem ou destino sem
permissão. Quando a ação não for segura ou aplicável, ela é omitida.

## API read-only futura

Rota semântica: GET /quality/findings.

Autorização: Auth0, perfil ativo, capabilities data:read e financial:read, além de RLS/FORCE
RLS e isolamento por projeto. Nenhuma ACL nova é criada.

Envelope:

    {
      "contract": "ltcm.p034.data-quality-center.v1",
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
- origin: origem allowlisted;
- search: busca parcial case-insensitive, com escaping P023, em campos textuais allowlisted;
- sort: campo allowlisted;
- order: asc ou desc;
- page: inteiro positivo, default 1;
- pageSize: inteiro de 1 a 100, default 25.

Filtros e paginação são server-side. A ordenação padrão é determinística por project.code ASC,
rule.code ASC e id ASC; ordenações alternativas terminam em id ASC. Não há saved filters, saved
views, export ou bulk action.

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
barreira definitiva; P034 não cria policy, grant ou capability.

P034 não amplia visibilidade de receipt_actual, eventos reservados, IDs ocultos, status ocultos ou
valores restritos de P014/P032/P033. Se uma origem necessária não for legível no contexto,
aplica-se fail-closed.

Consulta da central não cria audit log. Operações de correção continuam usando auditorias dos
módulos responsáveis.

## Estrutura e performance

O MVP é composição read-only no backend, usando views/queries existentes e paginação server-side.
Não criar tabela, materialized view, view nova, função SQL, índice, enum, migration, RLS, FORCE RLS
ou grant.

É obrigatório evitar N+1 e preservar isolamento por projeto. Se a consulta real não atender
cardinalidade, latência ou paginação sem nova estrutura, a implementação deve parar e emitir
P034_STRUCTURAL_DECISION_REQUIRED antes de qualquer alteração estrutural.

## Matriz de decisões

| Decisão  | Estado                         | Formalização                                                                                           |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| P034-D01 | RESOLVED_BY_EXISTING_AUTHORITY | reutilizar expected/observed/delta, moeda, evidências, referências, explicação e remediação P015       |
| P034-D02 | HUMAN_DECISION_APPROVED        | findings existentes preservam severity; stale e saldo são WARNING; nenhuma regra nova é BLOCKING       |
| P034-D03 | RESOLVED_BY_EXISTING_AUTHORITY | consumir MISSING_REQUIRED_FIELD e seus quatro campos factuais                                          |
| P034-D04 | HUMAN_DECISION_APPROVED        | PROJECT_DATA_STALE, projeto, updated_at, UTC, superior a 30 dias corridos, WARNING                     |
| P034-D05 | RESOLVED_BY_EXISTING_AUTHORITY | agregar somente os três findings P015 autorizados; não reimplementar P033                              |
| P034-D06 | HUMAN_DECISION_APPROVED        | moeda sem conversão; unidade somente com referência autoritativa e diferença literal                   |
| P034-D07 | RESOLVED_BY_EXISTING_AUTHORITY | DERIVED_READ_ONLY, sem tabela ou UUID persistido P034                                                  |
| P034-D08 | NO_LONGER_APPLICABLE           | NO_P034_ALERT_LIFECYCLE; desaparecimento automático quando a fonte for corrigida                       |
| P034-D09 | RESOLVED_BY_EXISTING_AUTHORITY | herdar P023: server-side, página 1, 25/100, query string, contexto e ordenação determinística          |
| P034-D10 | RESOLVED_BY_EXISTING_AUTHORITY | não autorizado é ocultado; falha técnica autorizada encerra explicitamente a consulta                  |
| P034-D11 | HUMAN_DECISION_APPROVED        | action estruturada com target e IDs; frontend resolve rotas existentes e returnTo seguro               |
| P034-D12 | RESOLVED_BY_EXISTING_AUTHORITY | composição read-only; parar com P034_STRUCTURAL_DECISION_REQUIRED se estrutura se tornar indispensável |
| P034-D13 | RESOLVED_BY_EXISTING_AUTHORITY | 1.15=P015, 1.16=P016, 2.06=P023; P026 é complementar                                                   |
| P034-D14 | HUMAN_DECISION_APPROVED        | UNPLANNED_BALANCE, saldo > 0, WARNING, fórmula P023/P030, sem duplicar warning textual                 |
| P034-D15 | RESOLVED_BY_EXISTING_AUTHORITY | P034_CONTRACT_ITEM_SCOPE_REUSE_P015_P016                                                               |

## Testes contratuais futuros

### Findings e valores

- contrato x item: mismatch, igualdade, itens inativos, total derivado e ausência de falso positivo;
- saldo: positivo gera finding; zero não gera; piso zero; posted conta; draft/cancelled não contam;
  versão oficial conta; ausência, multiplicidade e moeda incompatível falham fechado;
- item incompleto: cada um dos quatro campos, múltiplos campos, item_code ausente sem finding e
  consumo do finding P015;
- staleness: 29 dias, exatamente 30 dias, superior a 30 dias, UTC, boundary e relógio
  determinístico;
- duplicidade: os três findings P015 aparecem e P033 não é reimplementado;
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

## Restrições de implementação

Qualquer implementação futura deve preservar P015, P016, P023, P030, P032 e P033. Não pode alterar
CREATE/UPDATE de outras áreas, adicionar ACL, mudar schema ou introduzir conversão. Uma necessidade
estrutural comprovada exige parada e P034_STRUCTURAL_DECISION_REQUIRED.
