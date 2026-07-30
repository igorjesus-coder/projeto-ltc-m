# Projeto de Banco de Dados, CRUD e Dashboard LTC-M

## Baseline documental

| Campo | Valor |
| --- | --- |
| Estado | Aprovada para a primeira versão |
| Data | 2026-07-28 |
| Arquitetura vigente | [ADR-0002](adr/0002-arquitetura-render-supabase-database-auth0.md) |

Estão aprovados e datados nesta baseline o dicionário de dados conceitual, o escopo da primeira
versão, as métricas financeiras, o modelo da Curva S, as regras de atualização, os perfis de
usuário, os critérios de aceite e os itens fora do escopo. Entidades e campos abaixo são
conceituais; nenhuma tabela ou migration é criada por esta atualização.

## 1. Objetivo

Construir uma solução integrada para controlar o portfólio de projetos LTC-M, substituindo a lógica dispersa da planilha por:

1. banco relacional normalizado no Supabase/PostgreSQL;
2. sistema CRUD para cadastro e atualização manual;
3. camada analítica para Tableau, incluindo Curva S do avanço financeiro;
4. validações, histórico e rastreabilidade das alterações.

A solução deve permitir que novos dados sejam inseridos periodicamente e associados ao projeto correto, sem sobrescrever informações indevidas nem duplicar valores.

---

## 2. Diagnóstico da planilha analisada

### 2.1 Estrutura encontrada

A pasta possui três abas:

- **Valores Projetos LTC-M**: resumo por projeto com Valor de Venda, Faturado, A Faturar, Custo Orçado, Custo Incorrido e Resultados.
- **Prev. Receita Mensal**: itens dos projetos, quantidade, unidade, moeda, preço unitário, preço total e distribuição mensal prevista.
- **Curva S**: consolidação mensal do previsto e uma linha manual de realizado.

### 2.2 Perfil dos dados

- 9 códigos de projeto.
- 48 linhas de itens.
- 9 competências mensais, de julho/2026 a março/2027.
- Todos os registros atuais estão em BRL.
- Unidades encontradas: Unidade, Serviço e US.
- Valor total das linhas da aba de previsão: **R$ 31.517.382,39**.
- Valor programado nos meses: **R$ 2.800.460,15**.
- Somente 5 dos 9 projetos possuem algum valor programado.
- Somente 4 projetos estão integralmente distribuídos nos meses.

### 2.3 Problemas de qualidade e modelagem

1. **Formato largo da previsão**: cada mês é uma coluna. A inclusão de novos meses exige alterar a estrutura da planilha e do dashboard.
2. **Resumo e detalhe misturados**: alguns valores do resumo são fórmulas e outros são digitados manualmente.
3. **Consolidação conjunta no resumo**: os projetos 2024-10-12524 e 2025-07-14416 aparecem
   consolidados porque pertencem ao mesmo cliente. A apresentação é intencional, mas os registros
   devem permanecer separados no banco e nos filtros por projeto.
4. **Valor oficial do projeto 2026-04-16531**: a divergência da fonte foi resolvida; o valor
   aprovado é R$ 164.000,00.
5. **Contrato total versus recebimento**: o projeto 2024-02-10990 está integralmente faturado. R$
   369.749,17 são previsão de recebimento, não saldo de faturamento.
6. **Projetos sem programação mensal**: os projetos de maior valor, incluindo 2025-12-15568 e 2026-01-15797, ainda não alimentam a Curva S.
7. **Clientes não normalizados**: PETROBRAS aparece com variações como “PETROBRAS IBT (saldo)”, “PETROBRAS SRP/BF (Demanda)” e “PETROBRAS (Demanda)”. Saldo e Demanda devem ser atributos do projeto, não parte do nome do cliente.
8. **Código de projeto com espaço inicial**: 2024-06-11837 contém espaço antes do código.
9. **Código de item repetido no mesmo projeto**: há códigos repetidos com quantidades ou linhas diferentes. Portanto, projeto + código do item não pode ser a chave única.
10. **Linhas incompletas**: o projeto FLEET possui código e descrição vazios.
11. **Realizado sem vínculo documental**: o valor realizado da Curva S é digitado diretamente em uma célula agregada, sem projeto, documento, competência ou usuário responsável.
12. **Curva S incompleta**: o realizado acumulado não está preenchido ao longo dos meses e o gráfico combina valores mensais sem uma estrutura confiável de acumulado.
13. **Percentuais 30/70 embutidos em fórmulas**: regras comerciais específicas estão espalhadas pelas células e não possuem versão ou justificativa.
14. **Sem histórico de atualização**: existe apenas uma observação textual de atualização, sem lote, autor ou data de referência estruturada.

### 2.4 Reconciliação inicial por projeto

| Projeto | Total das linhas | Programado mensal | Saldo sem programação |
|---|---:|---:|---:|
| 2024-02-10990 | R$ 369.749,17 | R$ 0,00 | R$ 0,00 |
| 2024-06-11837 | R$ 2.783.700,00 | R$ 0,00 | R$ 2.783.700,00 |
| 2024-10-12524 | R$ 684.820,00 | R$ 684.820,00 | R$ 0,00 |
| 2025-07-14416 | R$ 343.730,00 | R$ 343.730,00 | R$ 0,00 |
| 2025-08-14656 | R$ 1.238.160,98 | R$ 1.238.160,98 | R$ 0,00 |
| 2025-12-15568 | R$ 13.786.887,44 | R$ 0,00 | R$ 13.786.887,44 |
| 2026-01-15797 | R$ 12.095.014,80 | R$ 0,00 | R$ 12.095.014,80 |
| 2026-03-16231 | R$ 47.320,00 | R$ 0,00 | R$ 47.320,00 |
| 2026-04-16531 | R$ 164.000,00 | R$ 164.000,00 | R$ 0,00 |

A diferença entre “Valor Total do Contrato”, “Saldo Contratual”, “Valor dos Itens Ativos” e “Valor Programado” deve ser mantida explicitamente no banco; não deve ser resolvida por uma única coluna genérica de valor.

No projeto 2024-02-10990, os R$ 369.749,17 da primeira coluna são `receipt_forecast`; por isso não
integram a coluna de faturamento programado.

### 2.5 Tratamentos aprovados para projetos

- **2026-04-16531:** valor oficial de R$ 164.000,00.
- **2024-10-12524 e 2025-07-14416:** projetos separados, com itens associados ao projeto correto.
  A consolidação conjunta ocorre somente por cliente ou grupo de reporte. Um filtro por projeto não
  mistura registros, e nenhum valor é transferido fisicamente de um projeto para o outro.
- **2024-02-10990:** projeto integralmente faturado e encerrado quanto ao faturamento. R$
  369.749,17 permanecem como `receipt_forecast`, fora do previsto de faturamento da Curva S.

---

## 3. Arquitetura proposta

```mermaid
flowchart LR
    U[Usuários] --> C[React + TypeScript + Vite no Render]
    C --> AUTH[Auth0 Universal Login]
    AUTH --> C
    C --> B[NestJS + Express no Render Web Service]
    B --> S[(Supabase PostgreSQL us-east-1)]
    S --> V[Views analíticas]
    V --> T[Tableau Extract read-only]
    S --> AUDIT[Auditoria e histórico]
    I[Importação controlada da planilha] --> ST[Staging]
    ST --> B
```

### Componentes

- **Frontend CRUD**: React, TypeScript e Vite, hospedado no Render.
- **Backend próprio**: Node.js LTS, TypeScript, NestJS e Express, futuramente hospedado como Render
  Web Service.
- **Banco**: PostgreSQL hospedado no Supabase, usado somente como banco e na região `us-east-1`.
- **Autenticação**: Auth0 com OIDC/OAuth 2.0, Authorization Code Flow e PKCE.
- **Autorização**: perfis e permissões de negócio mantidos no LTC-M.
- **Regras transacionais**: backend orquestra operações e funções PostgreSQL quando aplicável.
- **Camada analítica**: views específicas para Tableau Extract.
- **Auditoria**: registro de inclusão, alteração, exclusão lógica, usuário e data.
- **Importação opcional**: staging para futuras cargas de planilha sem gravar diretamente nas tabelas finais.

O frontend não acessa PostgreSQL, tabelas ou RPCs diretamente. No fluxo da aplicação, somente o
backend usa `DATABASE_URL`. A conexão separada do Tableau é exclusivamente read-only e limitada às
views analíticas.

---

# ETAPA 1 — Banco relacional e normalização

## 4. Modelo de dados proposto

Todos os nomes desta seção são nomes lógicos. Na implementação física, cada tabela, view,
materialized view, função/RPC, sequência, tipo e objeto auxiliar exclusivo do LTC-M pertence ao
schema dedicado `ltc_m` quando tecnicamente apropriado; triggers e policies pertencem somente às
tabelas desse schema. Migrations e consultas da aplicação devem usar nomes qualificados, como
`ltc_m.projects`, e não criar objetos de domínio em `public`.

Essa regra é especialmente obrigatória durante a exceção temporária que usa o projeto
`Funcionarios` para desenvolvimento, pois ele contém objetos e dados de outro sistema. A exceção
não autoriza migration nesta tarefa nem altera os modelos lógicos abaixo. A primeira migration
futura deverá criar `ltc_m` de forma versionada, após backup e revisão explícita.

### 4.1 Tabelas principais

#### `app_users`

Identidade e autorização internas, sem armazenar senha:

- `id` — identificador interno;
- `auth_subject` — claim `sub` do Auth0, estável e único;
- `email`;
- `name`;
- `role` — `viewer`, `editor` ou `admin`;
- `active`;
- `created_at` e `updated_at`.

E-mail não é identificador imutável. Auth0 comprova identidade; status, perfil e permissões de
negócio permanecem no LTC-M. Alterações de perfil devem ser auditáveis.

#### `clients`
Cadastro único de clientes.

Campos principais:

- `id` UUID;
- `legal_name`;
- `display_name`;
- `tax_id`;
- `active`;
- datas de criação e atualização.

#### `projects`
Cadastro mestre do projeto.

Campos principais:

- `id` UUID;
- `project_code` — código natural único, por exemplo 2026-01-15797;
- `project_name`;
- `client_id`;
- `reporting_group`, quando a consolidação não for representada apenas pelo cliente;
- `classification` — contrato completo, demanda ou saldo;
- `status`;
- `base_currency` — exatamente uma moeda por projeto;
- `contract_value` — valor total contratual;
- `opening_balance` — saldo trazido para o horizonte, quando aplicável;
- `budget_cost` — custo orçado atual;
- `start_date` e `end_date`;
- `manager_user_id`;
- `data_reference_date`;
- `notes`;
- `version` para controle de concorrência;
- `created_at`, `updated_at` e `deleted_at`.

#### `project_items`
Itens comerciais ou de serviço de cada projeto.

Campos principais:

- `id` UUID;
- `project_id`;
- `line_number`;
- `source_line_key` — identificador estável da linha;
- `item_code`;
- `description`;
- `quantity`;
- `unit_code`;
- `currency_code`;
- `unit_price`;
- `total_amount` calculado;
- `active`;
- datas de criação e atualização.

**Regra crítica:** código do item pode repetir. A chave operacional deve ser `project_id + source_line_key` ou `project_id + line_number`, nunca somente projeto + código.

**Regra de moeda:** `currency_code` deve ser igual à moeda do projeto, ou ser derivado dela. Um
projeto não pode conter itens em moedas diferentes.

#### `plan_versions`
Versões da previsão financeira.

Campos principais:

- `id` UUID;
- `name`;
- `reference_date`;
- `status`: rascunho, aprovado, bloqueado ou arquivado;
- `is_baseline`;
- `created_by`;
- `approved_by` e `approved_at`.

Essa tabela permite comparar o plano-base com revisões posteriores sem apagar o histórico.

#### `financial_plan_lines`
Distribuição mensal planejada em formato normalizado.

Cada registro representa um valor em um mês:

- `plan_version_id`;
- `project_id`;
- `project_item_id`, nulo somente para planejamento no nível do projeto;
- `planning_level`: `project` ou `item`;
- `metric_type`: ao menos `billing_planned` e `receipt_forecast`;
- `competence_month` — sempre o primeiro dia do mês;
- `amount`;
- `currency_code`;
- `notes`.

Em vez de criar uma coluna para Jul/26, Ago/26 etc., são criadas linhas. Novos meses não alteram o banco.

Cada linha pertence ao projeto **ou** a um item. Quando `planning_level = project`,
`project_item_id` é nulo; quando `planning_level = item`, ele é obrigatório. Uma view não pode
somar linhas de item com um total duplicado no nível do projeto.

#### `financial_actual_events`
Movimentos realizados.

Campos principais:

- `project_id`;
- `project_item_id`, opcional;
- `metric_type`: ao menos `billing_actual` e `receipt_actual`;
- `competence_date`;
- `source_key` — chave obrigatória para impedir duplicidade;
- `document_number`;
- `installment_key`;
- `amount`;
- `currency_code`;
- `status`;
- `notes`;
- usuário e datas de criação/alteração.

O modelo suporta `receipt_actual`, embora o realizado de recebimento não faça parte da primeira
entrega. Faturamento planejado/realizado e recebimento previsto/realizado são séries distintas.

#### `units` e `currencies`
Cadastros de referência para evitar digitação livre.

Exemplos de unidade inicial:

- `UN` — Unidade;
- `SERV` — Serviço;
- `US` — Unidade e Serviço.

#### `import_batches` e `import_row_errors`
Controle das importações futuras:

- arquivo/lote;
- data de referência;
- usuário;
- quantidade recebida, aceita e rejeitada;
- erros por linha;
- hash opcional do arquivo.

#### `audit_log`
Histórico das mudanças com tabela, registro, operação, valores anteriores, novos valores, usuário e data.

### 4.2 Relacionamentos

```mermaid
erDiagram
    APP_USERS ||--o{ PROJECTS : gerencia
    APP_USERS ||--o{ PLAN_VERSIONS : cria_aprova
    CLIENTS ||--o{ PROJECTS : possui
    PROJECTS ||--o{ PROJECT_ITEMS : contem
    PLAN_VERSIONS ||--o{ FINANCIAL_PLAN_LINES : versiona
    PROJECTS ||--o{ FINANCIAL_PLAN_LINES : planeja
    PROJECT_ITEMS ||--o{ FINANCIAL_PLAN_LINES : distribui
    PROJECTS ||--o{ FINANCIAL_ACTUAL_EVENTS : realiza
    PROJECT_ITEMS ||--o{ FINANCIAL_ACTUAL_EVENTS : referencia
    CURRENCIES ||--o{ PROJECTS : moeda_base
    CURRENCIES ||--o{ PROJECT_ITEMS : mesma_moeda_do_projeto
    UNITS ||--o{ PROJECT_ITEMS : unidade
```

## 5. Regras de normalização

1. Remover espaços externos dos códigos.
2. Converter códigos de projeto para um padrão único.
3. Separar cliente, unidade operacional e classificação do projeto.
4. Transformar colunas mensais em linhas.
5. Manter contrato total, saldo, valor dos itens, programado e realizado como medidas distintas.
6. Não gravar acumulados e percentuais; eles devem ser calculados por views.
7. Não permitir preço total digitado: `quantidade × preço unitário`.
8. Não permitir “A Faturar” digitado: calculá-lo após a definição pendente do denominador
   contratual aplicável.
9. Não permitir resultado digitado: calculá-lo com receita/faturamento e custo.
10. Utilizar `numeric`, nunca ponto flutuante, para valores monetários.
11. Cada projeto possui exatamente uma moeda; itens e linhas financeiras usam a mesma moeda do
    projeto.
12. Não consolidar moedas diferentes sem uma política de conversão aprovada. Taxa, fonte e data de
    câmbio permanecem pendentes.
13. Manter `billing_planned`, `billing_actual`, `receipt_forecast` e `receipt_actual` como métricas
    distintas.
14. Registrar `planning_level` e impedir a soma duplicada entre total de projeto e linhas de item.

## 6. Processo de migração inicial

1. Carregar as três abas em tabelas de staging, preservando a linha de origem.
2. Limpar códigos, textos, unidades e clientes.
3. Criar clientes únicos.
4. Criar projetos únicos pelo código normalizado.
5. Criar itens com uma chave de linha estável.
6. Despivotar os meses para `financial_plan_lines`.
7. Criar uma versão de plano chamada, por exemplo, `Baseline - Planilha inicial`.
8. Importar o realizado da Curva S como `billing_actual`; importar previsão de recebimento como
   `receipt_forecast`, em série separada.
9. Executar reconciliações automáticas.
10. Liberar a migração somente após aprovação das divergências.

### Validações de reconciliação

- soma dos itens por projeto versus valor dos itens informado;
- soma do plano mensal versus valor que deveria ser programado;
- faturado + a faturar versus valor contratual;
- custo orçado versus custos planejados;
- documentos realizados duplicados;
- itens sem código, descrição, unidade ou quantidade;
- projetos sem cliente ou sem moeda;
- valores negativos ou datas inválidas;
- programação fora das datas do projeto, quando essa regra for obrigatória.

---

# ETAPA 2 — Sistema CRUD

## 7. Perfis de acesso

- **`viewer`**: perfil inicial de consulta.
- **`editor`**: perfil inicial de edição.
- **`admin`**: perfil administrativo; somente ele pode aprovar, bloquear e reabrir previsões.

Auth0 autentica o usuário. O LTC-M verifica usuário ativo/inativo, perfil e permissão para cada
operação. A matriz completa de leitura, edição, inativação e administração permanece pendente;
não se presume exclusão definitiva.

## 8. Telas sugeridas

### 8.1 Lista de projetos

Exibir:

- código;
- cliente;
- nome;
- status;
- valor contratual;
- faturado;
- a faturar;
- previsto no horizonte;
- saldo sem programação;
- última atualização;
- alerta de inconsistência.

Ações:

- abrir;
- editar;
- duplicar versão de previsão;
- encerrar;
- exportar;
- consultar histórico.

### 8.2 Cadastro do projeto

#### Campos que o usuário deve informar

| Grupo | Campo | Obrigatório | Regra |
|---|---|---:|---|
| Identificação | Código do projeto | Sim | Único, sem espaços externos |
| Identificação | Nome do projeto | Sim | Texto padronizado |
| Identificação | Cliente | Sim | Seleção do cadastro, sem texto livre |
| Identificação | Classificação | Sim | Contrato completo, Demanda ou Saldo |
| Controle | Status | Sim | Lista controlada |
| Controle | Responsável | Recomendado | Usuário ou responsável cadastrado |
| Controle | Data inicial | Recomendado | Data válida |
| Controle | Data final | Recomendado | Maior ou igual à data inicial |
| Financeiro | Moeda-base | Sim | Código ISO, inicialmente BRL |
| Financeiro | Valor contratual | Sim | Maior ou igual a zero |
| Financeiro | Saldo de abertura | Condicional | Para projetos carregados apenas com saldo |
| Financeiro | Custo orçado | Recomendado | Maior ou igual a zero |
| Governança | Data de referência | Sim | Data da informação recebida |
| Governança | Observações | Não | Justificativas e contexto |

#### Campos calculados, não editáveis

- valor total dos itens;
- valor programado;
- saldo sem programação;
- faturado realizado;
- recebido realizado;
- a faturar;
- custo incorrido;
- resultado orçado;
- resultado realizado;
- margem;
- avanço financeiro;
- datas de criação e alteração.

### 8.3 Itens do projeto

Campos manuais relevantes, conforme a planilha:

- projeto;
- número da linha;
- código do item;
- descrição;
- quantidade;
- UN/unidade;
- moeda;
- preço unitário;
- observação;
- ativo/inativo.

Campos calculados:

- preço total;
- total programado do item;
- saldo do item sem programação;
- total realizado do item.

A tela deve aceitar vários itens e permitir duplicação de uma linha para agilizar o cadastro, mas deve gerar uma chave interna nova.

### 8.4 Programação mensal

Interface recomendada:

- seletor de projeto;
- seletor de versão;
- visão por item ou por projeto;
- grade mensal dinâmica;
- distribuição automática opcional por percentual;
- botão “distribuir saldo”;
- campo de justificativa;
- indicador de diferença em tempo real.

Regras:

- o total programado não pode exceder o limite definido, salvo autorização;
- valores mensais podem ser zero;
- não apagar versões aprovadas;
- revisões criam nova versão;
- linha aprovada deve ser bloqueada para edição comum.
- a programação aceita `planning_level = project` ou `planning_level = item`;
- uma linha pertence ao projeto ou a um item, nunca aos dois grãos ao mesmo tempo;
- totais de projeto não podem duplicar a soma das linhas de item.

### 8.5 Lançamentos realizados

Campos:

- projeto;
- item, quando aplicável;
- tipo: faturamento, recebimento, receita ou custo;
- competência;
- chave de origem;
- número do documento;
- parcela;
- moeda;
- valor;
- situação;
- observação/anexo opcional.

A chave de origem é obrigatória para prevenir lançamentos duplicados.

### 8.6 Central de inconsistências

Mostrar:

- valor contratual diferente do valor dos itens;
- programação maior que o saldo;
- saldo não programado;
- item incompleto;
- projeto sem atualização recente;
- documento duplicado;
- moeda divergente;
- realizado sem projeto ou competência;
- diferença entre resumo e detalhe.

## 9. Comportamento de atualização — UPSERT

### Projeto

- procurar pelo `project_code` normalizado;
- se não existir, inserir;
- se existir, atualizar somente os campos enviados e autorizados;
- usar `version` ou `updated_at` para impedir que um usuário sobrescreva uma edição mais recente.

### Item

- procurar por `project_id + source_line_key`;
- não usar somente `item_code`, pois a planilha possui códigos repetidos;
- uma exclusão deve ser lógica, mantendo histórico.

### Programação mensal

- chave: versão + projeto + nível de planejamento + item, quando aplicável + tipo de métrica +
  competência;
- se existir, atualizar o valor;
- se não existir, inserir;
- salvar o conjunto em uma transação única.

### Realizado

- chave: projeto + `source_key`;
- não fazer upsert usando apenas data e valor;
- documento cancelado deve continuar registrado com status cancelado.

## 10. Fluxo de gravação recomendado

1. Usuário abre o projeto.
2. Frontend carrega a versão atual do registro.
3. Usuário altera projeto, itens ou programação.
4. Frontend envia um bearer access token e o pacote para o backend NestJS.
5. NestJS valida assinatura JWT por JWKS, algoritmo, `issuer`, `audience` e expiração, resolve
   `app_users` pelo claim `sub` e verifica status e permissão.
6. Backend valida entradas, chaves, totais e concorrência.
7. Backend grava todas as alterações em uma transação, usando função PostgreSQL quando aplicável.
8. Auditoria registra identidade, antes/depois e data.
9. Views analíticas passam a refletir os novos dados no próximo Tableau Extract.

---

# ETAPA 3 — Dashboard Tableau

## 11. Modelo analítico

### Dimensões

- Projeto;
- Cliente;
- Data/Mês;
- Item;
- Unidade;
- Moeda;
- Status;
- Classificação;
- Responsável;
- Versão da previsão.

### Fatos

- valor contratual;
- valor dos itens;
- `billing_planned` — faturamento previsto;
- `billing_actual` — faturamento realizado;
- `receipt_forecast` — previsão de recebimento;
- `receipt_actual` — recebimento realizado, suportado pelo modelo mas fora da primeira entrega;
- receita planejada;
- custo planejado;
- receita realizada;
- custo realizado.

Faturamento e recebimento são métricas diferentes e não formam uma única série acumulada. O
Tableau deve consumir views prontas, evitando cálculos complexos e joins feitos diretamente no
workbook.

## 12. Dashboard 1 — Visão Executiva do Portfólio

### KPIs

- Valor contratual total;
- Valor dos itens ativos;
- Faturado realizado;
- Previsão de recebimento;
- A faturar;
- Previsto no horizonte;
- Saldo sem programação;
- Custo orçado;
- Custo realizado;
- Resultado e margem;
- quantidade de projetos ativos;
- projetos com inconsistência.

### Visuais

- barras por projeto e cliente;
- contratado versus faturado;
- previsão de recebimento em visual separado;
- ranking de saldo a faturar;
- composição por classificação: contrato, demanda e saldo;
- calendário/heatmap da previsão mensal;
- alertas de projetos sem programação.

### Filtros

- período;
- projeto;
- cliente;
- status;
- classificação;
- responsável;
- moeda;
- versão do plano.

KPIs financeiros devem ser segmentados por moeda. Não há total de portfólio entre moedas
diferentes enquanto a política de conversão estiver pendente.

## 13. Dashboard 2 — Curva S do Avanço Financeiro LTC-M

A Curva S principal compara exclusivamente faturamento previsto e faturamento realizado:

- **Previsto Mensal**: valor previsto para faturamento em cada mês;
- **Realizado Mensal**: valor efetivamente faturado no mês;
- **Previsto Acumulado**: soma do previsto do mês corrente com os meses anteriores;
- **Realizado Acumulado**: soma do realizado do mês corrente com os meses anteriores.

Recebimento não é realizado da Curva S principal. `receipt_forecast` e `receipt_actual` permanecem
em análises separadas.

### Visual principal recomendado

Gráfico combinado:

- **barras**: previsto mensal e realizado mensal;
- **linha 1**: previsto acumulado percentual;
- **linha 2**: realizado acumulado percentual;
- eixo secundário de 0% a 100%;
- linha vertical na data de corte;
- tooltip com valores mensais, acumulados, diferença e versão.

### Indicadores da Curva S

- previsto acumulado na data de corte;
- realizado acumulado na data de corte;
- desvio acumulado em R$;
- desvio acumulado em pontos percentuais;
- aderência ao plano: realizado acumulado ÷ previsto acumulado;
- saldo sem programação;
- mês previsto de conclusão;
- última competência realizada.

### Definições recomendadas

- **Avanço financeiro do contrato** = faturado acumulado ÷ valor contratual.
- **Avanço financeiro do plano** = realizado acumulado ÷ total do plano-base.
- **Aderência à Curva S** = realizado acumulado até a data de corte ÷ previsto acumulado até a mesma data.

Essas três medidas não devem ser tratadas como sinônimos.

### Comparações interativas

- portfólio completo;
- um ou vários projetos;
- cliente;
- plano-base versus previsão atual;
- valores em R$ versus percentual.

Uma análise separada pode comparar previsão e realizado de recebimento quando `receipt_actual`
entrar no escopo, sem misturá-los com a Curva S de faturamento.

## 14. Dashboard 3 — Detalhe do Projeto

Cabeçalho:

- código, nome, cliente, status e responsável;
- valor contratual;
- saldo de abertura;
- faturado, previsão de recebimento e a faturar;
- custo e margem;
- avanço financeiro.

Visuais:

- Curva S individual;
- tabela de itens;
- programação mensal por item;
- documentos realizados;
- waterfall de valor contratual até resultado;
- histórico de versões;
- alertas de consistência.

A seleção de um projeto na Visão Executiva deve abrir ou filtrar este dashboard.

## 15. Dashboard 4 — Qualidade e Governança

Indicadores:

- projetos sem programação;
- valor total sem programação;
- projetos com diferença entre contrato e itens;
- itens incompletos;
- documentos duplicados ou cancelados;
- previsões não aprovadas;
- dados sem atualização no prazo;
- divergências de moeda e unidade.

Esse dashboard é necessário porque a planilha atual contém diferenças que podem distorcer o painel executivo.

## 16. Views sugeridas para o Tableau

- `v_tableau_project_overview`;
- `v_tableau_project_items`;
- `v_tableau_financial_monthly`;
- `v_tableau_s_curve_portfolio`;
- `v_tableau_s_curve_project`;
- `v_tableau_data_quality`;
- `v_tableau_plan_versions`.

A fonte do Tableau usa obrigatoriamente Extract, com usuário PostgreSQL somente leitura e acesso
apenas às views analíticas. Agenda de atualização, monitoramento e tratamento de falhas permanecem
pendentes.

---

## 17. Testes de aceitação

### Banco e migração

- todos os 9 projetos são carregados sem duplicidade;
- todas as 48 linhas recebem chave própria;
- meses são convertidos em linhas;
- divergências ficam registradas e não são corrigidas silenciosamente;
- valores monetários mantêm precisão de centavos;
- códigos são normalizados;
- cada projeto e seus itens usam exatamente uma moeda;
- linhas com grãos `project` e `item` não causam dupla contagem;
- o projeto 2026-04-16531 reconcilia em R$ 164.000,00;
- 2024-10-12524 e 2025-07-14416 permanecem separados quando filtrados por projeto;
- R$ 369.749,17 de 2024-02-10990 aparecem somente como previsão de recebimento.

### CRUD

- novo projeto pode ser criado;
- projeto existente pode ser atualizado pelo código;
- dois usuários não sobrescrevem alterações sem aviso;
- item com código repetido pode coexistir em linhas diferentes;
- programação salva vários meses em transação única;
- versão aprovada não pode ser alterada por editor comum;
- somente `admin` pode aprovar, bloquear ou reabrir uma previsão;
- lançamento duplicado é bloqueado;
- auditoria identifica usuário, data e valores alterados;
- backend NestJS rejeita token inválido, usuário inativo ou operação não autorizada;
- frontend não acessa o PostgreSQL diretamente.

### Tableau

- KPIs reconciliam com as views SQL;
- filtros afetam todos os gráficos previstos;
- Curva S usa acumulados corretos de `billing_planned` e `billing_actual`;
- recebimentos não aparecem como realizado da Curva S principal;
- seleção de projeto abre o detalhe;
- saldo sem programação é visível;
- valores nulos não são tratados automaticamente como zero quando isso altera o significado;
- versão do plano selecionada aparece no painel;
- Tableau usa Extract e acessa somente views com credencial read-only.

---

## 18. Entregáveis por etapa

### Etapa 1

- dicionário de dados;
- diagrama relacional;
- scripts SQL;
- tabelas de staging;
- rotina de migração;
- relatório de reconciliação;
- views analíticas iniciais.

### Etapa 2

- autenticação e perfis;
- lista e formulário de projetos;
- CRUD de itens;
- editor de programação mensal;
- lançamentos realizados;
- aprovação de versão;
- central de inconsistências;
- auditoria e testes.

### Etapa 3

- fonte de dados Tableau;
- dashboard executivo;
- dashboard Curva S;
- detalhe do projeto;
- painel de qualidade;
- documentação de métricas;
- roteiro de homologação e publicação.

---

## 19. Escopo aprovado da primeira versão

Incluído:

- autenticação Auth0 e vínculo com `app_users`;
- perfis `viewer`, `editor` e `admin`;
- cadastros de clientes, projetos e itens;
- planejamento nos níveis de projeto e item;
- `billing_planned`, `billing_actual` e `receipt_forecast`;
- versões de previsão, aprovação, bloqueio e reabertura por administradores;
- auditoria e controles de consistência;
- views analíticas e dashboards por Tableau Extract.

Fora do escopo:

- `receipt_actual` na primeira entrega, embora o modelo deva suportá-lo;
- exclusão definitiva de registros;
- conversão entre moedas sem política aprovada;
- armazenamento de senhas no LTC-M;
- acesso direto do frontend ao PostgreSQL/Supabase;
- Supabase Auth, Data API e Edge Functions como backend da aplicação;
- implementação ou scaffold de `apps/api` nesta atualização documental;
- Tableau Live como estratégia da primeira versão;
- implementação de tenant Auth0 ou infraestrutura real nesta atualização documental.

---

## 20. Decisões pendentes

1. biblioteca de acesso ao PostgreSQL;
2. matriz completa de permissões, especialmente exclusão e inativação;
3. periodicidade, SLA e data de corte das atualizações;
4. política de conversão monetária, incluindo taxa, fonte e data;
5. agenda, monitoramento e tratamento de falhas dos Extracts do Tableau;
6. significado do valor de venda como contrato total ou escopo LTC-M ativo;
7. natureza reutilizável ou pontual dos percentuais 30/70;
8. regras detalhadas de edição e inativação de cadastros;
9. RPO, RTO, PITR e retenção detalhada;
10. ferramenta de observabilidade;
11. estratégia final de RLS e propagação segura do contexto de autorização;
12. parâmetros de sessão e step-up além do MFA obrigatório para administradores.

---

## 21. Recomendação final

A planilha deve ser usada como fonte para a migração inicial, mas não como estrutura definitiva. O
núcleo da solução deve registrar projetos, itens, versões de plano e movimentos realizados em
tabelas separadas. A Curva S deve ser construída com faturamento mensal normalizado e acumulados
calculados no banco. O CRUD deve impedir duplicidade por chaves estáveis, versionamento e
transações; o backend deve concentrar acesso e autorização; e o Tableau Extract deve consumir views
reconciliadas.
