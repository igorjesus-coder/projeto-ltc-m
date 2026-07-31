# ADR-0002: Render, Supabase Database, Auth0 e NestJS

- Estado: Aceita
- Data: 2026-07-28
- Tarefa: 0.07 — seleção da stack e arquitetura de implantação concluída
- Decisão anterior: substitui o
  [ADR-0001](0001-arquitetura-base-da-plataforma-ltc-m.md)
- Escopo: arquitetura da primeira versão do LTC-M

> **Complemento posterior:** as decisões D22–D27 sobre o papel PostgreSQL do backend, último
> administrador ativo, consulta controlada da auditoria e aplicação remota do P008 foram decididas
> em 31/07/2026 e estão no
> [ADR-0003](0003-seguranca-postgresql-e-aplicacao-p008.md). As pendências históricas abaixo devem
> ser lidas à luz desse complemento; as migrations P008 foram aplicadas e a validação D27 está
> parcial, com bloqueio funcional documentado no relatório de runtime.

## Contexto

O ADR-0001 tratava o Supabase como backend completo, previa autenticação pelo Supabase Auth,
acesso do frontend pela Data API/RPC e recomendava Vercel. Essas premissas foram revistas pelo
responsável do projeto. O domínio financeiro também teve decisões aprovadas que exigem uma
fronteira explícita entre interface, autorização de negócio e banco.

A fundação React/TypeScript/Vite e o PostgreSQL permanecem válidos. Nenhuma implementação de
backend, autenticação, infraestrutura ou schema de domínio integra esta decisão documental.

## Decisão

### Plataforma e ambientes

- manter npm workspaces e o frontend React, TypeScript e Vite;
- hospedar o frontend e o futuro backend próprio no Render;
- manter domínio e responsabilidade pelo DNS no Render;
- usar GitHub Actions para CI/CD;
- usar Supabase exclusivamente para hospedar PostgreSQL na região `us-east-1`;
- permitir projeto Supabase remoto e isolado para desenvolvimento temporário, apenas com dados
  sintéticos;
- manter desenvolvimento, homologação e produção isolados;
- manter Supabase local com Docker como fluxo desejável, sem bloquear a evolução documental.

O Supabase não é o backend da aplicação. Supabase Auth, Data API, Edge Functions e acesso direto
do navegador ao banco não fazem parte da arquitetura aprovada.

### Backend próprio

O backend próprio será desenvolvido com Node.js em versão LTS, TypeScript, NestJS e o adaptador
HTTP padrão Express. Será implantado futuramente como Render Web Service e continuará sendo a
única fronteira da aplicação para acesso ao banco.

O NestJS foi escolhido por oferecer arquitetura modular, controllers, services, providers,
dependency injection, guards, interceptors, pipes e filters integrados ao TypeScript. Essa
estrutura é adequada para separar regras de negócio, autorização, auditoria e testes unitários e
de integração. A escolha não garante segurança ou desempenho automaticamente; esses atributos
dependem da implementação, configuração, testes e operação.

O Express será o adaptador HTTP inicial por ser o padrão do NestJS, possuir amplo ecossistema
Node.js, reduzir a complexidade inicial, integrar-se com middlewares e bibliotecas de autenticação
e atender ao volume inicial esperado. Fastify poderá ser avaliado somente após medição de
desempenho, identificação de gargalo real, validação de compatibilidade e nova decisão
arquitetural aprovada.

A biblioteca de acesso ao PostgreSQL — ORM, query builder ou driver — permanece pendente. Este
ADR não escolhe Prisma, TypeORM, Drizzle ou alternativa equivalente.

### Autenticação

O provedor oficial é Auth0, usando OpenID Connect e OAuth 2.0. A aplicação React pública usará
Authorization Code Flow com PKCE:

1. o usuário acessa o frontend React;
2. o frontend redireciona para o Universal Login do Auth0;
3. o Auth0 autentica o usuário;
4. o frontend obtém um access token de curta duração;
5. o frontend envia o token ao backend próprio;
6. o backend valida o token antes de executar qualquer operação;
7. somente o backend acessa o PostgreSQL no Supabase.

O Auth0 responde por login, logout, recuperação de acesso, verificação de identidade, emissão e
renovação de tokens, políticas de sessão, MFA e futura federação corporativa. O LTC-M não
armazenará senhas.

O backend deverá validar ao menos assinatura JWT por JWKS, algoritmo permitido, `issuer`,
`audience`, expiração e integridade. Apenas decodificar o token não é validação. A implementação
futura usará o SDK oficial do Auth0 para React, manterá tokens em memória sempre que tecnicamente
possível, não orientará armazenamento manual de access tokens em `localStorage` e não colocará
client secret no frontend.

MFA é obrigatório para administradores. Reautenticação ou step-up authentication é recomendada
para ações administrativas críticas.

No NestJS, a implementação futura deverá separar conceitualmente:

- guard de autenticação para validar o bearer access token;
- guard de autorização para verificar perfis e permissões;
- decorator ou metadata de permissões, quando aplicável;
- serviço de usuários internos para resolver o claim `sub`;
- auditoria das ações administrativas.

O backend não confiará somente em claims de perfil contidos no token. O usuário interno, seu
status e suas permissões de negócio serão consultados conforme a estratégia de autorização
aprovada.

### Autorização de negócio

Auth0 comprova a identidade; a aplicação e o banco LTC-M controlam usuário ativo/inativo, perfil,
permissões, acesso às operações e auditoria. Os perfis iniciais aprovados são `viewer`, `editor` e
`admin`. Somente `admin` pode aprovar, bloquear ou reabrir previsões.

Uma entidade futura equivalente a `app_users` associará uma identidade a:

- identificador interno;
- `auth_subject`, correspondente ao `sub` do Auth0 e único;
- e-mail e nome;
- perfil;
- status ativo/inativo;
- datas de criação e atualização.

O e-mail não será identificador imutável. Permissões de negócio não ficarão exclusivamente no
Auth0, e alterações de perfil serão auditáveis. A matriz completa de leitura, edição, inativação
e administração permanece pendente; não se presume exclusão definitiva.

### Defesa no banco

O backend valida autorização, enquanto constraints, grants e, quando aplicável, RLS formam defesa
em profundidade. A API usará papel PostgreSQL próprio e de menor privilégio; credenciais
administrativas não serão usadas em operação normal. `DATABASE_URL` é exclusivamente server-side.

Transações serão controladas pela aplicação ou pela futura biblioteca de acesso a dados.
Migrations continuam sendo a fonte de verdade do schema. Não se assume que o JWT do Auth0 será
consumido diretamente por RLS. A estratégia final de RLS e a propagação segura de contexto
permanecem pendentes.

### Organização modular

O npm workspace evoluirá, quando o scaffold for criado, para incluir `apps/web` e `apps/api`. A
estrutura conceitual do backend é:

```text
apps/
|-- web/
`-- api/
    `-- src/
        |-- auth/
        |-- authorization/
        |-- users/
        |-- clients/
        |-- projects/
        |-- project-items/
        |-- financial-plans/
        |-- actual-events/
        |-- imports/
        |-- audit/
        |-- health/
        `-- common/
```

Um pacote dedicado a tipos ou schemas compartilhados só será criado quando houver necessidade
concreta. Esta decisão não cria diretórios nem altera o workspace atual.

### Implantação no Render

Frontend e backend serão serviços separados. O backend será um Render Web Service que:

- escutará a porta indicada por `PORT`;
- oferecerá health check obrigatório e readiness check quando aplicável;
- manterá variáveis server-side no ambiente do serviço;
- receberá chamadas do frontend por HTTPS;
- permitirá CORS somente para origens aprovadas por ambiente.

Build e start commands serão definidos quando o scaffold existir. Nenhuma configuração real do
Render integra esta decisão documental.

### CI/CD

O pipeline proposto no GitHub Actions executará `npm ci`, formatação, lint, typecheck, testes,
build, verificações de segurança e, quando houver migrations, validações SQL. A promoção seguirá
desenvolvimento, homologação e produção isolados. Deploy de produção terá controles e aprovação
compatíveis com o risco. O pipeline não é implementado nesta tarefa.

### Qualidade, observabilidade e segurança do backend

A implementação futura deverá ter testes unitários, de integração, autenticação, autorização,
contratos da API, fluxos financeiros críticos, transações e concorrência, além de lint, typecheck,
build e validação de variáveis. Nenhuma meta numérica de cobertura foi aprovada.

Também serão requisitos:

- logs estruturados com correlation/request ID;
- tratamento centralizado de exceções e respostas padronizadas;
- ausência de tokens, credenciais e dados sensíveis em logs;
- limitação de tamanho de payload;
- timeouts e encerramento gracioso;
- health e readiness checks;
- auditoria de ações de negócio;
- atualização periódica de dependências;
- avaliação futura de rate limiting.

A ferramenta específica de observabilidade permanece pendente.

### Backup

Será executada rotina mensal de backup, acompanhada de testes periódicos de restauração e
evidências. RPO, RTO, PITR, retenção detalhada e garantias operacionais permanecem pendentes.

### Tableau

O Tableau usará Extract e consumirá somente views analíticas por conexão PostgreSQL somente
leitura. A agenda de atualização, o monitoramento e o tratamento de falhas do Extract permanecem
pendentes.

### Baseline funcional

Ficam aprovados, em 2026-07-28, o dicionário de dados conceitual, o escopo da primeira versão, as
métricas financeiras, a Curva S de faturamento, as regras de atualização, os perfis iniciais, os
critérios de aceite e os itens fora do escopo descritos em
[`project-specification.md`](../project-specification.md).

## Consequências

### Positivas

- identidade fica delegada a um provedor especializado sem armazenar senhas no LTC-M;
- o navegador deixa de possuir credenciais ou acesso direto ao PostgreSQL;
- o backend centraliza validação de token, autorização e contratos de API;
- NestJS fornece fronteiras modulares explícitas para o domínio;
- Express reduz a complexidade operacional inicial;
- PostgreSQL preserva constraints, transações, auditoria e views analíticas;
- frontend, backend e banco podem evoluir com responsabilidades explícitas;
- Tableau fica isolado por views e credencial somente leitura.

### Negativas

- um backend adicional precisa ser implementado, testado, implantado e operado;
- NestJS e Express aumentam a superfície de dependências e atualização;
- a estrutura modular exige disciplina para evitar acoplamento entre módulos;
- Express pode precisar ser revisto se medições futuras identificarem gargalo real;
- Auth0 e Render adicionam dependências externas e configuração por ambiente;
- a aplicação não pode usar diretamente facilidades de Auth, Data API ou RPC do Supabase;
- a autorização precisa de contexto seguro entre backend e banco;
- Tableau Extract não é em tempo real;
- isolamento de ambientes, backups e restauração aumentam o esforço operacional.

## Riscos e restrições

| Risco ou restrição                 | Tratamento                                                              |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Token inválido aceito              | validação completa por JWKS, algoritmo, issuer, audience e expiração    |
| Token exposto no navegador         | SDK oficial, curta duração e memória quando possível                    |
| Segredo no bundle Vite             | nenhum client secret ou credencial server-side com prefixo `VITE_`      |
| Acesso indevido ao banco           | backend como única fronteira, menor privilégio e defesa em profundidade |
| Permissão obsoleta                 | autorização consultada e auditada no LTC-M                              |
| Autorização baseada só no token    | consultar usuário interno, status e permissões aprovadas                |
| API usa credencial administrativa  | papel PostgreSQL próprio e de menor privilégio                          |
| CORS permissivo                    | allowlist de origens por ambiente                                       |
| Falha silenciosa do serviço        | health/readiness checks, logs estruturados e alertas futuros            |
| Mistura entre ambientes            | projetos, credenciais e dados isolados                                  |
| Perda de dados                     | backup mensal e testes periódicos de restauração                        |
| Extract desatualizado              | agenda, monitoramento e tratamento de falhas ainda devem ser definidos  |
| Dupla contagem ou mistura de moeda | grão analítico explícito e nenhuma conversão sem política aprovada      |

## Decisões pendentes

- biblioteca de acesso ao PostgreSQL;
- matriz completa de permissões, especialmente exclusão e inativação;
- significado oficial da unidade `US`;
- periodicidade, SLA e data de corte das atualizações;
- política de conversão monetária;
- agenda, monitoramento e tratamento de falhas dos Extracts do Tableau;
- RPO, RTO, PITR e retenção detalhada;
- parâmetros operacionais de sessão e step-up além do MFA obrigatório para administradores;
- estratégia final de RLS e propagação segura do contexto de autorização;
- ferramenta e responsabilidades de observabilidade e resposta a incidentes.

## Condições de revisão

Revisar esta decisão quando:

- medições demonstrarem gargalo no Express e justificarem avaliar Fastify;
- a biblioteca de acesso ao PostgreSQL for aprovada;
- os requisitos de rede, residência de dados ou identidade corporativa mudarem;
- a política de autorização ou isolamento por organização for detalhada;
- volume, concorrência ou SLA exigirem outra topologia;
- RPO/RTO ou retenção exigirem recursos adicionais;
- uma solução segura de propagação de contexto justificar alteração na estratégia de RLS;
- Tableau Extract deixar de atender os requisitos operacionais;
- custos ou políticas corporativas impedirem Auth0, Render, Supabase ou GitHub Actions.
