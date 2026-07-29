# Revisão do schema inicial — P003 / 1.03

## Estado e escopo

Esta revisão adapta o desenho inicial do banco às decisões vigentes do LTC-M. Ela não cria uma
migration, não aplica SQL e não altera o projeto Supabase remoto.

Artefatos:

- fonte original: `C:\Users\Igor Jesus\Downloads\schema_supabase_ltc_m.sql`;
- tamanho da fonte: 17.806 bytes;
- SHA-256 da fonte:
  `F7DFA395D0638157DB40899A442983BC7EF2669150F2FA76BD05D4B68D8E315F`;
- desenho revisado: [`schema-ltc-m-reviewed.sql`](schema-ltc-m-reviewed.sql).

O arquivo original foi somente lido e permanece inalterado em Downloads. Seu caminho e hash
permitem confirmar a referência exata utilizada. O desenho revisado fica fora de
`supabase/migrations` e contém avisos explícitos contra aplicação direta.

## Resumo da avaliação

O original oferece uma base útil de entidades, constraints, índices, auditoria e views, mas não
pode ser promovido como migration do LTC-M. Ele foi escrito para uma arquitetura anterior:
objetos em `public`, identidade em `auth.users`, papéis e RLS do Supabase Auth e acesso pela role
`authenticated`. Essas premissas conflitam com o ADR-0002, com Auth0, com o backend NestJS como
fronteira e, principalmente, com o uso compartilhado do projeto `Funcionarios`.

A versão revisada mantém o núcleo conceitual aproveitável, muda todo o domínio para `ltc_m`,
separa séries financeiras, reforça chaves relacionais e deixa fora do SQL as decisões de acesso
que ainda não foram aprovadas.

## Problemas encontrados no original

### Isolamento e risco operacional

1. Todos os tipos, tabelas, funções e views eram criados em `public`.
2. Triggers, políticas e SQL dinâmico também apontavam explicitamente para `public`.
3. Não havia criação nem validação do schema dedicado `ltc_m`.
4. O script poderia colidir com objetos do sistema já hospedado em `Funcionarios`.
5. `create extension if not exists pgcrypto` tentava alterar uma extensão compartilhada sem
   análise ou aprovação específica.
6. O bloco único entre `begin` e `commit` misturava schema, seed, views, função de autorização e
   políticas, dificultando revisão e promoção incremental.

### Identidade, autenticação e autorização

1. `profiles.user_id`, campos de autoria e responsáveis referenciavam `auth.users`.
2. `profiles` usava exclusão em cascata a partir do usuário de Supabase Auth.
3. `current_app_role()` dependia de `auth.uid()`.
4. As policies concediam acesso à role `authenticated`, premissa da Data API/Supabase Auth.
5. A leitura era liberada para qualquer usuário autenticado e a exclusão física era permitida ao
   administrador.
6. O papel `approver` não integra os perfis aprovados; a baseline define apenas `viewer`, `editor`
   e `admin`.
7. A função `security definer` e o `search_path = public` ampliavam o risco em um banco
   compartilhado.

### Modelo financeiro

1. O enum único `financial_metric` misturava `invoice`, `receipt`, `revenue` e `cost` sem
   distinguir planejado de realizado.
2. Os nomes não refletiam as séries aprovadas: `billing_planned`, `billing_actual`,
   `receipt_forecast` e `receipt_actual`.
3. `financial_plan_lines` não tinha `planning_level`.
4. Era possível gravar linhas no nível de projeto e item para a mesma série, causando dupla
   contagem nas views.
5. Não havia garantia de que `project_item_id` pertencia ao mesmo `project_id` da linha
   financeira.
6. Não havia garantia relacional de que a moeda do item, plano ou realizado era a moeda-base do
   projeto.
7. `unallocated_invoice` era calculado como contrato menos planejado, sem descontar o faturamento
   já realizado. Isso faria um projeto integralmente faturado aparecer com saldo não programado.
8. A view executiva calculava resultados de custo e receita apesar de essas séries não integrarem
   o escopo financeiro aprovado da primeira entrega.
9. A Curva S somava o portfólio sem segmentar por moeda.
10. Acumulados de recebimento e faturamento podiam ser interpretados a partir de um enum
    ambíguo, contrariando a separação financeira aprovada.

### Integridade e modelagem

1. Faltava `reporting_group` em projetos.
2. A ligação do responsável era com identidade externa, não com o usuário interno do LTC-M.
3. A chave de item repetido estava parcialmente correta, mas as tabelas financeiras não
   preservavam a coerência composta entre item e projeto.
4. Códigos possuíam validação de trim, porém sem critérios consistentes de conteúdo não vazio.
5. `bigserial` criava sequences implicitamente; o desenho não explicitava que esses objetos
   também deveriam ficar em `ltc_m`.
6. Seeds estavam misturados ao DDL. O valor semântico da unidade `US` continua pendente e não
   deve ser materializado como decisão aprovada.
7. O audit log ainda dependia da identidade do Supabase Auth e aceitava operação `DELETE`, apesar
   da diretriz de exclusão lógica.
8. A política de auditoria, retenção de `raw_payload` e tratamento de dados sensíveis não estava
   definida.

### Camada analítica e acesso

1. As views estavam em `public`.
2. A versão corrente era escolhida globalmente pela data mais recente, sem documentar a
   consequência operacional.
3. O Tableau não estava protegido por uma estratégia versionada de ownership e grants de menor
   privilégio.
4. A view da Curva S não particionava acumulados por moeda.
5. A view executiva podia produzir indicadores financeiros não aprovados ou semanticamente
   incorretos.

## Alterações aplicadas no desenho revisado

### Schema e qualificação

- todos os tipos, tabelas, índices, funções, triggers e views pertencem a `ltc_m`;
- nenhum objeto de domínio é criado ou referenciado em `public`;
- nenhum objeto existente de `Funcionarios` é lido, movido, renomeado ou reutilizado;
- o arquivo usa `set search_path to pg_catalog` e nomes de domínio qualificados;
- a criação futura usa `create schema ltc_m` sem `if not exists`, para falhar diante de um schema
  inesperado em vez de aceitá-lo silenciosamente;
- não há criação ou alteração de extensões.

O uso de `pg_catalog.gen_random_uuid()` pressupõe PostgreSQL 17, versão configurada localmente. A
futura migration deverá confirmar a disponibilidade da função no alvo durante o preflight, sem
criar `pgcrypto` automaticamente.

### Auth0 e usuários internos

- `profiles` foi substituída por `ltc_m.app_users`;
- `auth_subject` armazena o claim estável `sub` do Auth0 e é único;
- e-mail não é usado como identificador imutável;
- senhas e tokens não são armazenados;
- responsáveis, autoria, aprovação e auditoria referenciam `app_users.id`;
- os papéis foram limitados a `viewer`, `editor` e `admin`;
- não há dependência de `auth.users`, `auth.uid()`, Supabase Auth ou role `authenticated`.

### Planejamento e realizado

- enums distintos separam métricas planejadas e realizadas;
- o plano aceita somente `billing_planned` e `receipt_forecast`;
- o realizado modela `billing_actual` e suporta `receipt_actual`, embora a gravação desta última
  permaneça fora da primeira entrega;
- `financial_plan_scopes` fixa um único grão por versão, projeto e métrica;
- `financial_plan_lines` exige consistência entre `planning_level` e presença do item;
- índices parciais definem as chaves de upsert para os grãos de projeto e item;
- FKs compostas impedem associar uma linha a item de outro projeto;
- FKs compostas também garantem que item, plano e realizado usem a moeda-base do projeto;
- a chave do realizado continua sendo `project_id + source_key`;
- valores monetários permanecem em `numeric`.

### Projetos, itens e governança

- contrato, saldo de abertura, custo orçado, itens ativos, planejado e realizado continuam
  separados;
- `reporting_group` foi adicionado sem fundir projetos;
- o item conserva `source_line_key` e `line_number`; `item_code` nunca é a chave única;
- descrição e código do item podem ficar ausentes para preservar e sinalizar linhas incompletas
  da fonte, sem inventar conteúdo;
- IDs de auditoria e erro usam identity, cujas sequences pertencem ao schema da tabela;
- operações de auditoria usam `SOFT_DELETE` em vez de autorizar exclusão física como fluxo de
  negócio;
- o incremento de versão do projeto foi separado do trigger genérico de timestamp.

### Views analíticas

- as views sugeridas ficam em `ltc_m` e usam nomes `v_tableau_*`;
- faturamento e recebimento são colunas e séries distintas;
- `to_bill` desconta somente faturamento realizado;
- `unallocated_billing` desconta faturamento realizado e faturamento futuro planejado;
- nenhuma margem ou resultado é inventado sem o modelo aprovado de custos/receitas;
- Curvas S usam exclusivamente `billing_planned` e `billing_actual`;
- acumulados do portfólio são particionados por moeda;
- existem visões separadas para portfólio e projeto;
- o grão único de planejamento evita somar total de projeto com linhas de item.

## Elementos deliberadamente não incluídos

- migrations em `supabase/migrations`;
- SQL de alteração do projeto remoto;
- seeds de moeda, unidade ou dados de domínio;
- criação ou modificação de extensões;
- roles PostgreSQL;
- grants para backend ou Tableau;
- policies RLS;
- integração direta com JWT/Auth0 no PostgreSQL;
- função `security definer`;
- funções transacionais de escrita;
- triggers automáticos de auditoria;
- tabelas físicas de staging e rotina de importação;
- métricas planejadas/realizadas de receita e custo;
- conversão cambial;
- exclusão física de registros.

Esses itens exigem decisões, revisão de segurança ou tarefas próprias. A omissão evita transformar
uma escolha pendente em arquitetura aprovada.

## Decisões ainda pendentes

1. biblioteca de acesso do backend ao PostgreSQL;
2. matriz completa de leitura, edição, inativação e administração;
3. roles PostgreSQL, ownership e grants de menor privilégio para backend e Tableau;
4. adoção de RLS como defesa em profundidade e propagação segura do contexto Auth0;
5. significado oficial da unidade `US`;
6. normalização e formato de `tax_id`;
7. formato exato permitido para `project_code`;
8. ciclo detalhado de estados de projeto, plano, aprovação, bloqueio e reabertura;
9. regra para selecionar a previsão “corrente” quando existirem versões concorrentes;
10. autorização para exceder limites de planejamento;
11. modelo aprovado de custo e receita, necessário para resultado e margem;
12. ativação funcional de `receipt_actual`;
13. política de conversão monetária;
14. automação, imutabilidade, retenção e conteúdo sensível da auditoria;
15. retenção e sanitização de `raw_payload` de importação;
16. estratégia de ownership das views e grants exclusivos do Tableau;
17. agenda, monitoramento e tratamento de falhas dos Extracts;
18. RPO, RTO, PITR, retenção e procedimento de restauração.

## Impacto nas futuras migrations

O desenho não deve ser copiado para uma migration monolítica. A decomposição recomendada é:

1. **preflight e schema:** verificar alvo, backup, ausência de `ltc_m` e criar o schema;
2. **tipos e referências:** enums, `app_users`, moedas e unidades, sem seeds ambíguos;
3. **cadastros:** clientes, projetos e itens com constraints e índices;
4. **planejamento:** versões, escopos e linhas financeiras;
5. **realizado:** eventos e chaves de idempotência;
6. **importação e auditoria:** após política de dados e retenção aprovada;
7. **funções e triggers:** timestamps, concorrência e funções transacionais revisadas;
8. **views analíticas:** contratos SQL reconciliados e testes por moeda/grão;
9. **acesso:** roles, grants e eventual RLS em migration própria, após decisão de segurança;
10. **dados de referência:** seeds sintéticos/versionados somente após significado aprovado.

Cada migration deverá:

- qualificar todo objeto com `ltc_m.`;
- usar preflight que interrompa antes de operar fora de `ltc_m`;
- não usar `if exists` ou `if not exists` para mascarar estado remoto inesperado;
- não criar nem alterar extensões compartilhadas sem aprovação;
- ser testada em banco descartável antes do desenvolvimento remoto;
- incluir testes SQL para constraints, grants e eventual RLS;
- ter plano de reversão compatível com a mudança;
- ser precedida por backup recuperável antes da primeira aplicação em `Funcionarios`;
- interromper diante de histórico remoto desconhecido.

## Cenários mínimos para os testes SQL futuros

- schema e todos os objetos de domínio pertencem a `ltc_m`;
- nenhuma tabela LTC-M existe em `public`;
- `auth_subject` é único e não vazio;
- somente os papéis aprovados são aceitos;
- projeto e itens usam a mesma moeda;
- item de outro projeto é rejeitado em plano e realizado;
- um escopo não mistura grão de projeto e item;
- itens com `item_code` repetido coexistem por `source_line_key`;
- competência planejada é o primeiro dia do mês;
- `project_id + source_key` impede realizado duplicado;
- valores negativos são rejeitados;
- projeto integralmente faturado não possui saldo de faturamento não programado;
- `receipt_forecast` não alimenta a Curva S de faturamento;
- Curvas S não somam moedas diferentes;
- editor não aprova, bloqueia ou reabre plano;
- Tableau lê somente views autorizadas;
- nenhuma credencial de frontend alcança o banco.

## Conclusão

O desenho revisado é coerente com a baseline funcional e com a arquitetura vigente, mas continua
sendo um artefato de revisão. O P003 prepara a base para migrations futuras; não autoriza aplicar
o arquivo, criar `ltc_m` remotamente ou declarar o modelo físico concluído antes da revisão das
pendências e dos testes em PostgreSQL descartável.
