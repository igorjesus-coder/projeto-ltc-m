# ADR-0002: Render, Supabase Database e Auth0

- Estado: Aceita, com tecnologia do backend pendente
- Data: 2026-07-28
- Tarefa: atualização da baseline arquitetural e funcional
- Decisão anterior: substitui o
  [ADR-0001](0001-arquitetura-base-da-plataforma-ltc-m.md)
- Escopo: arquitetura da primeira versão do LTC-M

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

Um backend próprio, hospedado no Render, será a única fronteira de acesso da aplicação ao banco.
Ele validará identidade e autorização antes das operações e usará `DATABASE_URL` exclusivamente
em contexto server-side.

A tecnologia ou o framework desse backend permanece pendente. Este ADR não escolhe linguagem,
framework, ORM ou biblioteca de validação JWT.

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
em profundidade. Não se assume que o JWT do Auth0 será consumido diretamente por RLS. A estratégia
final de RLS e a propagação segura de contexto serão revistas após a escolha do backend.

### CI/CD

O pipeline proposto no GitHub Actions executará `npm ci`, formatação, lint, typecheck, testes,
build, verificações de segurança e, quando houver migrations, validações SQL. A promoção seguirá
desenvolvimento, homologação e produção isolados. Deploy de produção terá controles e aprovação
compatíveis com o risco. O pipeline não é implementado nesta tarefa.

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
- PostgreSQL preserva constraints, transações, auditoria e views analíticas;
- frontend, backend e banco podem evoluir com responsabilidades explícitas;
- Tableau fica isolado por views e credencial somente leitura.

### Negativas

- um backend adicional precisa ser escolhido, implementado, implantado e operado;
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
| Mistura entre ambientes            | projetos, credenciais e dados isolados                                  |
| Perda de dados                     | backup mensal e testes periódicos de restauração                        |
| Extract desatualizado              | agenda, monitoramento e tratamento de falhas ainda devem ser definidos  |
| Dupla contagem ou mistura de moeda | grão analítico explícito e nenhuma conversão sem política aprovada      |

## Decisões pendentes

- tecnologia/framework do backend próprio;
- matriz completa de permissões, especialmente exclusão e inativação;
- significado oficial da unidade `US`;
- periodicidade, SLA e data de corte das atualizações;
- política de conversão monetária;
- agenda, monitoramento e tratamento de falhas dos Extracts do Tableau;
- RPO, RTO, PITR e retenção detalhada;
- parâmetros operacionais de sessão e step-up além do MFA obrigatório para administradores;
- estratégia final de RLS e propagação segura do contexto de autorização;
- ferramentas e responsabilidades de observabilidade e resposta a incidentes.

## Condições de revisão

Revisar esta decisão quando:

- a tecnologia do backend for aprovada;
- os requisitos de rede, residência de dados ou identidade corporativa mudarem;
- a política de autorização ou isolamento por organização for detalhada;
- volume, concorrência ou SLA exigirem outra topologia;
- RPO/RTO ou retenção exigirem recursos adicionais;
- uma solução segura de propagação de contexto justificar alteração na estratégia de RLS;
- Tableau Extract deixar de atender os requisitos operacionais;
- custos ou políticas corporativas impedirem Auth0, Render, Supabase ou GitHub Actions.
