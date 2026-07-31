# ADR-0003: Segurança PostgreSQL e aplicação controlada do P008

- Estado: Aceita
- Data: 31/07/2026
- Tarefa: P008-PRE — registro documental das decisões D22–D25
- Decisão base: complementa o
  [ADR-0002](0002-arquitetura-render-supabase-database-auth0.md)
- Implementação: P008 ainda não implementado; exige nova execução
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

Este ADR é a fonte canônica de D22–D25. Ele registra decisões aprovadas pelo responsável do
projeto em 31/07/2026, mas não cria migration, role, grant, policy ou função e não autoriza uma
execução fora dos limites de D25.

## Resumo das decisões

| ID  | Status   | Data       | Decisão                                                        |
| --- | -------- | ---------- | -------------------------------------------------------------- |
| D22 | Decidida | 31/07/2026 | papel PostgreSQL dedicado e de menor privilégio para o backend |
| D23 | Decidida | 31/07/2026 | preservação de pelo menos um administrador ativo               |
| D24 | Decidida | 31/07/2026 | consulta de auditoria somente por função controlada            |
| D25 | Decidida | 31/07/2026 | aplicação remota controlada do P008 sem backup recuperável     |

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

## Relação com decisões anteriores e P007

D22–D25 complementam D13, D15 e D16 sem reabrir seus escopos aprovados: preservam Auth0 como
fonte de autenticação, o NestJS como fronteira da aplicação, o PostgreSQL do Supabase somente como
banco e o isolamento de objetos LTC-M em `ltc_m`. Os registros Markdown anteriores não usam de
forma consistente os identificadores literais D13, D15 e D16; este ADR mantém a referência
fornecida pelo histórico de aprovação sem renumerar documentos retroativamente.

O contexto transacional, a resolução por `app_users.auth_subject`, a matriz de perfis, o workflow
e a auditoria que o P008 deverá reutilizar estão documentados em
[`versioning-audit-workflow-p007.md`](../database/versioning-audit-workflow-p007.md). D23 resolve a
regra de último admin que permanecia fora do P007; D24 restringe a leitura da trilha criada no
P007; D22 define a identidade PostgreSQL que ficará sujeita aos grants e à RLS.

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

O P008 permanece não implementado até nova execução. Este registro não altera SQL, migrations,
configuração executável, banco remoto, Auth0, frontend, backend ou Tableau. O primeiro admin e o
login real do backend deverão ser provisionados futuramente por processos operacionais
controlados; nenhuma senha, token, chave ou connection string é criada aqui.
