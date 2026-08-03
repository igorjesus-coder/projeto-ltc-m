# ADR-0003: Segurança PostgreSQL e aplicação controlada do P008

- Estado: Aceita
- Data: 31/07/2026
- Tarefa: P008-PRE/P008/P009 — decisões D22–D33 e validação controlada
- Decisão base: complementa o
  [ADR-0002](0002-arquitetura-render-supabase-database-auth0.md)
- Implementação: migrations P008/D28/P009 aplicadas; validação funcional P009/D33 concluída
- Escopo: autorização PostgreSQL, último administrador, consulta de auditoria e aplicação remota

## Contexto

O P007 implementou o contexto transacional do ator, a resolução do usuário em
`ltc_m.app_users`, a auditoria e as funções controladas de workflow. Auth0 continua responsável
pela autenticação, e o futuro backend NestJS/Express continuará sendo a única fronteira da
aplicação com o PostgreSQL. Os perfis oficiais de negócio são somente `viewer`, `editor` e
`admin`.

O projeto Supabase remoto temporário `Funcionarios`, na região `us-east-1`, é compartilhado com
outro sistema. Objetos de domínio do LTC-M pertencem exclusivamente ao schema `ltc_m`. Não há
backup recuperável disponível para a aplicação do P008, por isso qualquer exceção precisa ser
específica, explícita e limitada.

Este ADR é a fonte canônica de D22–D28. Ele registra decisões aprovadas pelo responsável do
projeto em 31/07/2026. D26 aceita a associação administrativa criada automaticamente pelo
Supabase e D27 autoriza, apenas para validação dinâmica, uma segunda associação temporária e
reversível, sem nova migration ou novo push.

## Resumo das decisões

| ID  | Status   | Data       | Decisão                                                        |
| --- | -------- | ---------- | -------------------------------------------------------------- |
| D22 | Decidida | 31/07/2026 | papel PostgreSQL dedicado e de menor privilégio para o backend |
| D23 | Decidida | 31/07/2026 | preservação de pelo menos um administrador ativo               |
| D24 | Decidida | 31/07/2026 | consulta de auditoria somente por função controlada            |
| D25 | Decidida | 31/07/2026 | aplicação remota controlada do P008 sem backup recuperável     |
| D26 | Decidida | 31/07/2026 | associação administrativa automática aceita e preservada       |
| D27 | Decidida | 31/07/2026 | harness temporário para validação dinâmica do runtime          |
| D28 | Decidida | 31/07/2026 | ACL forward mínima para dependência invoker do runtime         |
| D29 | Decidida | 31/07/2026 | aplicação remota da estrutura P009 sem backup recuperável      |
| D30 | Decidida | 03/08/2026 | reexecução única do harness funcional P009 corrigido           |
| D31 | Decidida | 03/08/2026 | gate integral e validação P009 em duas fases                   |
| D32 | Decidida | 03/08/2026 | request de auditoria igual ao contexto e validação final P009  |
| D33 | Decidida | 03/08/2026 | envelope terminal e acompanhamento integral do harness P009    |

## D22 — Papel PostgreSQL do backend

**Status:** Decidida
**Data:** 31/07/2026

### Decisão

- criar o papel PostgreSQL dedicado `ltc_m_runtime`;
- configurá-lo como `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION` e
  `NOBYPASSRLS`;
- não torná-lo proprietário de schema, tabelas, sequências ou funções e não permitir que crie
  objetos;
- conceder somente privilégios mínimos sobre objetos do schema `ltc_m`;
- provisionar futuramente o login real do backend fora das migrations, com segredo gerenciado, e
  associá-lo a `ltc_m_runtime`;
- proibir o backend de usar `postgres`, proprietário de objetos, `service_role` ou qualquer papel
  com `BYPASSRLS`;
- manter `viewer`, `editor` e `admin` como perfis de negócio armazenados em
  `ltc_m.app_users`, nunca como roles PostgreSQL;
- manter o backend NestJS como a única fronteira de acesso da aplicação ao banco;
- usar RLS como defesa em profundidade, sem substituir validação JWT, autorização no backend e
  queries parametrizadas.

### Justificativa e impacto no P008

Uma credencial compartilhada não deve transformar o backend em proprietário nem permitir bypass
das políticas por perfil. O P008 deverá criar o papel sem login, revisar grants e aplicar RLS com
negação por padrão. Nenhuma credencial será criada no repositório ou em migration.

## D23 — Último administrador ativo

**Status:** Decidida
**Data:** 31/07/2026

### Decisão

- manter pelo menos um administrador ativo;
- bloquear a inativação do último admin ativo;
- bloquear a mudança de role do último admin ativo para `viewer` ou `editor`;
- bloquear autoalteração que deixe zero admins;
- permitir a operação quando existir outro admin ativo;
- exigir justificativa e registrar ator, request ID, before/after e data/hora;
- aplicar proteção transacional contra concorrência;
- garantir a regra independentemente de RLS e do backend;
- não criar usuário de emergência, admin oculto ou bypass permanente.

### Justificativa e impacto no P008

A validação apenas na API ou em uma policy não impediria duas alterações concorrentes de removerem
o último administrador. O P008 deverá implementar a proteção transacional no banco, integrá-la ao
contexto e à auditoria do P007 e testar inativação, mudança de perfil, autoalteração e concorrência.

## D24 — Consulta da auditoria

**Status:** Decidida
**Data:** 31/07/2026

### Decisão

- não conceder `SELECT` direto em `ltc_m.audit_log` a `ltc_m_runtime`;
- negar acesso de auditoria a `viewer` e `editor`;
- permitir que `admin` consulte a trilha somente por função controlada;
- validar o contexto P007 e exigir administrador ativo;
- exigir paginação, limite máximo e filtros parametrizados;
- não usar SQL dinâmico inseguro;
- retornar somente dados sanitizados;
- registrar a própria consulta como evento de auditoria antes de retornar dados;
- cancelar a consulta se o registro do acesso falhar;
- não retornar JWT, senha, chave, token ou credencial;
- não oferecer ao runtime qualquer outro acesso direto à tabela.

### Justificativa e impacto no P008

A trilha contém dados de governança e não deve ser exposta por um grant amplo. O P008 deverá
implementar uma função controlada, com execução restrita, paginação determinística, filtros seguros
e auditoria atômica do acesso.

## D25 — Aplicação remota do P008 sem backup recuperável

**Status:** Decidida  
**Data:** 31/07/2026

### Decisão

A implementação e a aplicação remota controlada do P008 estão autorizadas exclusivamente sob as
seguintes condições:

- projeto `Funcionarios`, região `us-east-1`, reconhecido como ambiente compartilhado;
- aceitação da ausência de backup recuperável somente para o P008;
- preflight e dry-run obrigatórios;
- exatamente um `supabase db push --linked`, contendo somente migrations P008;
- mudanças de domínio restritas ao schema `ltc_m`;
- único delta global permitido: criação de `ltc_m_runtime`;
- grants somente em objetos `ltc_m`;
- proibição de `repair`, reset, pull, migration down, SQL Editor e DDL manual;
- proibição de segundo push após falha;
- interrupção imediata diante de alteração externa não autorizada.

### Justificativa, risco aceito e impacto no P008

O risco de executar sem ponto de restauração é aceito de forma excepcional porque a mudança será
aditiva, inventariada e limitada. Permanecem os riscos de indisponibilidade, erro de policy ou
grant e impacto no banco compartilhado. O preflight deverá confirmar o alvo, o histórico, o estado
externo e o delta; o dry-run deverá listar somente o P008. Falha ou divergência não autoriza nova
escrita ou reparo.

Esta decisão não executa nem implementa o P008. A aplicação depende de uma nova execução que
observe todos os gates acima.

## D26 — Associação administrativa automática do Supabase

**Status:** Decidida
**Data:** 31/07/2026

### Decisão

- aceitar como comportamento esperado do ambiente hospedado a associação automática de
  `ltc_m_runtime` a `postgres` concedida por `supabase_admin`;
- exigir a forma exata `ADMIN OPTION = true`, `INHERIT OPTION = false` e `SET OPTION = false`;
- preservar essa associação permanentemente, sem revogá-la, substituí-la ou alterar suas opções;
- considerar a associação inerte para uso de privilégios: `postgres` possui `MEMBER`, mas não
  possui `USAGE` nem `SET` sobre `ltc_m_runtime` por meio dela;
- manter todas as demais exigências de menor privilégio de D22 para `ltc_m_runtime` e para o
  futuro login real do backend.

### Justificativa e limite

No PostgreSQL 17, a criação de uma role por um papel com `CREATEROLE` pode produzir essa
associação administrativa sem transmitir herança nem permitir `SET ROLE`. Ela habilita a
administração da role, mas não autoriza o executor `postgres` a operar como runtime. D26 resolve o
delta observado após o único push D25 sem ampliar os privilégios efetivos do backend e sem
autorizar qualquer outra associação permanente.

## D27 — Harness temporário para validação dinâmica de `ltc_m_runtime`

**Status:** Decidida
**Data:** 31/07/2026

### Decisão

- executar a validação somente por harness versionado, auditável, reproduzível e sem segredos;
- provar primeiro, dentro de transação revertida, que uma segunda associação pode ser criada com
  `ADMIN OPTION = false`, `INHERIT OPTION = false`, `SET OPTION = true` e grantor `postgres`, e
  removida seletivamente com `REVOKE ... GRANTED BY postgres` sem tocar na associação D26;
- persistir a segunda associação somente depois dessa prova, pelo menor intervalo necessário;
- usar trava e precondições estritas para impedir dois harnesses concorrentes ou execução diante
  de drift;
- executar cada cenário funcional em conexão separada, assumindo `ltc_m_runtime` apenas durante
  o cenário e usando contexto P007 transacional;
- cobrir contexto inválido, Viewer, Editor, Admin, workflow P007, D23 sequencial e concorrente,
  D24 e limpeza;
- executar a revogação seletiva em bloco `finally`, mesmo após falha funcional;
- confirmar ao final exatamente a associação D26, `SET=false`, ausência de dados e travas do
  harness, migrations alinhadas e fingerprint externo inalterado;
- proibir login persistente de teste, nova migration, novo `db push`, `repair`, reset, pull,
  migration down, rollback, SQL Editor ou alteração manual fora do harness.

### Justificativa e limite

A associação D26 não permite `SET ROLE`, portanto não serve para comprovar RLS com a identidade
efetiva do runtime. A segunda associação D27 é uma capacidade operacional efêmera para teste,
distinguível pelo grantor e removível sem ambiguidade. Ela não é configuração de aplicação, não
substitui o futuro login do backend e não pode permanecer após a execução.

## Relação com decisões anteriores e P007

D22–D27 complementam D13, D15 e D16 sem reabrir seus escopos aprovados: preservam Auth0 como
fonte de autenticação, o NestJS como fronteira da aplicação, o PostgreSQL do Supabase somente como
banco e o isolamento de objetos LTC-M em `ltc_m`. Os registros Markdown anteriores não usam de
forma consistente os identificadores literais D13, D15 e D16; este ADR mantém a referência
fornecida pelo histórico de aprovação sem renumerar documentos retroativamente.

## D28 — ACL mínima corretiva do runtime

**Status:** Decidida
**Data:** 31/07/2026

D28 autoriza uma única migration forward no projeto `Funcionarios`, região `us-east-1`, contendo
somente a revogação de `PUBLIC EXECUTE` e a concessão explícita de `EXECUTE` a
`ltc_m_runtime` para dependências comprovadas do grafo P007/P008. A auditoria confirmou que o
trigger invoker `ltc_m.maintain_row_metadata()` chama `ltc_m.current_actor_id(boolean)` durante
DML do runtime; essa é a única função adicional concedida. A migration não cria/substitui
funções, policies, tabelas, roles ou memberships, nem concede privilégios fora de `ltc_m`.

O corpo, owner, `SECURITY DEFINER`/`INVOKER` e `search_path` das funções permanecem inalterados.
`PUBLIC EXECUTE` continua revogado, e `current_actor_id` apenas valida o contexto já existente;
o grant não concede acesso de tabela nem bypass de RLS. D28 exige preflight, dry-run, exatamente
um `db push --linked`, comparação ACL antes/depois e reexecução integral do harness D27.

O contexto transacional, a resolução por `app_users.auth_subject`, a matriz de perfis, o workflow
e a auditoria que o P008 deverá reutilizar estão documentados em
[`versioning-audit-workflow-p007.md`](../database/versioning-audit-workflow-p007.md). D23 resolve a
regra de último admin que permanecia fora do P007; D24 restringe a leitura da trilha criada no
P007; D22 define a identidade PostgreSQL que ficará sujeita aos grants e à RLS.

## D29 — Aplicação remota do P009 sem backup recuperável

**Status:** Decidida
**Data:** 31/07/2026

D29 autoriza uma única aplicação remota controlada da migration P009 no projeto `Funcionarios`,
região `us-east-1`, sem backup recuperável, somente após preflight e dry-run conformes. O delta
fica restrito ao schema `ltc_m`, preserva P007/P008, mantém D26, não cria roles, memberships ou
dados e lista exclusivamente a migration P009. Em caso de falha não há nova tentativa; a
validação pós-aplicação exige a suíte P009 e as regressões P007/P008, com limpeza confirmada.

O arquivo financeiro real não é lido nem versionado. A aba `Decisões Aprovadas` é documental e
não pode ser registrada como fonte operacional. O P010 produzirá os payloads JSON v1; nenhuma
retenção ou purge automático é decidido por D29.

A migration P009 foi aplicada uma única vez em 31/07/2026. Na continuação de 03/08/2026, o
harness confirmou D26, limpeza, fingerprints e as regressões P007/P008, mas a etapa P009 abortou
antes dos cenários por erro sintático do renderizador local. A limpeza foi comprovada e, conforme
D29, outra execução remota da suíte depende de nova decisão explícita.

## D30 — Reexecução única do harness funcional P009 corrigido

**Status:** Decidida

**Data:** 03/08/2026

**Aprovação:** responsável do projeto

D30 autoriza uma única reexecução remota do comando versionado do harness P009 corrigido, somente
para fixtures sintéticas temporárias, a concessão temporária D27 estritamente necessária ao
`SET ROLE`, a matriz funcional P009, as regressões P007/P008 e a limpeza em `finally`. Antes da
execução devem ser comprovados o hash imutável da migration P009, as dez migrations alinhadas,
D26 exata, contagens zeradas, ausência de drift e o fingerprint externo aprovado.

A decisão não autoriza migration nova ou alteração da migration aplicada, `db push`, DDL, SQL
Editor, `repair`, `reset`, `pull`, migration down, correção manual, alteração persistente de ACL,
policies, roles, memberships, seeds ou dados permanentes. Não há repetição automática diante de
falha. Com limpeza e estado final comprovados, mas cenário incompleto, o resultado permanece
parcial e uma nova tentativa depende de outra decisão explícita; qualquer resíduo ou delta
estrutural é falha crítica.

A autorização D30 foi consumida uma única vez pela execução `r20260803132652-ada2b257`, iniciada
em `2026-08-03T13:26:52.151Z` e encerrada em `2026-08-03T13:30:46.597Z`. O alias corrigido deixou
de causar erro, mas a suíte P009 parou antes das fixtures com SQLSTATE `42601` porque o INSERT de
usuários sintéticos declarava quatro colunas e trazia cinco valores na linha inativa. P007/P008,
D23, cleanup D27, estado final e fingerprints passaram; `rollback_clean=true`. A fixture e o
scanner foram corrigidos somente localmente após a execução. D30 não autoriza nova tentativa.

## D31 — Gate integral e validação remota P009 em duas fases

**Status:** Decidida

**Data:** 03/08/2026

**Aprovação:** responsável do projeto

D31 autoriza uma única nova invocação remota do harness P009, condicionada à aprovação prévia de
um gate local determinístico sobre todo o SQL já renderizado. O gate deve usar dois formatos de
run ID, validar a estrutura léxica, a invariância dos identificadores e aliases, todos os INSERTs,
a aridade de cada tupla e as fixtures `app_users` com `active` explícito. Seu manifesto e os hashes
dos SQLs renderizados devem ser registrados antes da conexão remota.

A invocação remota será dividida em Fase A e Fase B. A Fase A executa o bootstrap completo em uma
transação dedicada e termina obrigatoriamente em `ROLLBACK`; a Fase B só pode começar com
`phase_a_passed=true` e ausência de persistência ou trava residual. A Fase B cobre integralmente
P009, a matriz RLS Viewer/Editor/Admin e as regressões P007/P008. A concessão D27, quando
necessária ao `SET ROLE`, continua temporária, seletivamente revogada em `finally` e não pode
alterar a associação D26.

D31 não autoriza segunda invocação, repetição automática, migration nova ou alterada, `db push`,
DDL, SQL Editor, correção manual remota, `repair`, `reset`, `pull`, migration down, ACL, policy,
role ou membership persistente, seed ou dado permanente. Falha funcional com limpeza comprovada
é resultado parcial; resíduo ou delta estrutural é falha crítica.

A autorização D31 foi consumida uma única vez por `r20260803141344-e3356875`, de
`2026-08-03T14:13:45.010Z` a `2026-08-03T14:17:49.674Z`. A Fase A passou e liberou a Fase B. A
suíte P009 avançou até a auditoria, onde uma assertion confundiu o request do contexto com o
campo request da aba; a matriz RLS específica P009 não foi alcançada. P007/P008, D23, cleanup,
D26, contagens, locks e fingerprints passaram, com `rollback_clean=true`. O resultado é
parcialmente concluído e D31 não permite nova execução.

## D32 — Contrato de request da auditoria e validação final P009

**Status:** Decidida

**Data:** 03/08/2026

**Aprovação:** responsável do projeto

D32 decide que `audit_log.request_id` deve ser exatamente o request configurado no contexto
transacional ativo no momento do DML. O trigger e o contrato do banco permanecem inalterados.
Cada cenário P009 deve configurar request único e determinístico na mesma conexão/transação,
confirmá-lo antes do DML e comparar a auditoria ao mesmo valor. Contexto de setup não pode ser
reutilizado implicitamente.

D32 autoriza somente correções locais no harness, renderizador, fixtures, scanners e testes,
seguidas de uma única invocação remota final com gate, Fase A, matriz P009, P007/P008 e cleanup em
`finally`. Não autoriza segunda invocação, migration, `db push`, DDL, SQL Editor, correção manual,
alteração de trigger/função/schema, ACL, policy, role ou membership persistente, seed ou dado
permanente. Necessidade de alterar o banco bloqueia D32.

A única invocação D32 foi consumida por `r20260803151221-2d4f91ba`, de
`2026-08-03T15:12:21.173Z` a `2026-08-03T15:16:26.506Z`. Fase A, P007/P008, D23, cleanup,
estado final e fingerprints passaram. O SQL P009 retornou sucesso após executar as assertions de
request, auditoria e RLS, mas o orquestrador não encontrou no stdout o result set intermediário
`p009_rejection_partial_integrity`; encerrou com código 1 e sem capturar a matriz estruturada.
`rollback_clean=true`, D26 e os 1.625 objetos pré/pós foram preservados. D32 não autoriza nova
invocação.

## D33 — Envelope terminal e acompanhamento integral do harness P009

**Status:** Decidida

**Data:** 03/08/2026

**Aprovação:** responsável do projeto

D33 autoriza exclusivamente alterações no launcher, runner de processos, protocolo de saída,
parser, projeções de evidência e testes de observabilidade. O SQL funcional, suas assertions,
migrations e objetos do banco permanecem inalterados. O resultado remoto deve emitir exatamente
um envelope terminal `P009_RESULT_V1`, validado somente após `close`, com JSON compacto em
Base64url e SHA-256 dos bytes UTF-8.

Timeout deve encerrar a árvore inteira e classificar falha; não pode haver subprocesso órfão,
retry automático ou segunda invocação. Após gates e preflight, D33 autoriza exatamente uma
invocação remota final para repetir as fases e capturar a evidência estruturada.

A autorização D33 foi consumida uma única vez por `r20260803173036-ddabb07d`, de
`2026-08-03T17:30:36.232Z` a `2026-08-03T17:34:47.994Z`. O launcher aguardou `close`, recebeu um
único envelope íntegro e terminou com código 0. Fases A/B, matriz P009, oito requests auditados,
P007/P008, D23 e D24 passaram. Cleanup, D26, contagens, locks e fingerprints também passaram com
`rollback_clean=true`. D33 está concluída e não autoriza nova invocação.

## Consequências e riscos

### Positivas

- o backend opera com identidade PostgreSQL sem login e de menor privilégio;
- perfis de negócio permanecem centralizados em `ltc_m.app_users`;
- RLS reforça a autorização sem consumir JWT do Auth0 diretamente;
- o sistema não pode ficar sem administrador ativo;
- a auditoria não fica diretamente legível pelo runtime;
- a exceção de aplicação remota possui alvo, delta e número de tentativas explícitos.

### Negativas e riscos aceitos

- policies, grants e funções controladas aumentam a complexidade e exigem testes por perfil;
- funções com privilégios elevados, quando tecnicamente necessárias, ampliam a superfície de
  revisão;
- bloqueio transacional do conjunto de admins pode gerar contenção em operações administrativas;
- consultar auditoria gera um novo evento e aumenta o volume da própria trilha;
- a aplicação remota P008 ocorrerá sem backup recuperável, sob o risco excepcional de D25;
- o projeto compartilhado mantém risco residual de drift e impacto cruzado.

## Limites desta decisão documental

As migrations P008 já foram aplicadas; D28 autoriza somente a migration forward ACL descrita acima,
e D27 limita a validação dinâmica à evidência e à limpeza do harness. O registro não autoriza
outras migrations, alteração de Auth0,
frontend, backend ou Tableau. O primeiro admin real e o login real do backend deverão ser
provisionados futuramente por processos operacionais controlados; nenhuma senha, token, chave ou
connection string é criada aqui.
