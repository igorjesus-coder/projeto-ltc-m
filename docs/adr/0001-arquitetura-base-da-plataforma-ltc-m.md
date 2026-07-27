# ADR-0001: Arquitetura base da plataforma LTC-M

- Estado: Aceita
- Data: 2026-07-27
- Tarefa: 0.07
- Decisores: pendente de nomeação formal
- Escopo: fundação técnica e operação da plataforma

## Contexto

O LTC-M substituirá uma planilha por uma aplicação CRUD, um banco relacional com rastreabilidade e
uma camada analítica para Tableau. O domínio contém valores financeiros, versões de planejamento,
realizados e divergências que não podem ser corrigidas implicitamente.

O repositório já possui uma fundação validada:

- npm workspaces;
- React e TypeScript;
- Vite;
- Vitest, ESLint e Prettier;
- Supabase CLI;
- diretórios para aplicação, migrations, seeds, testes, scripts e documentação.

Os comandos de instalação, desenvolvimento e qualidade funcionam. O computador atual não possui
Docker nem Podman, o que impede executar a stack local do Supabase. Ainda não há remoto Git
configurado, projetos Supabase hospedados, provedor de frontend ou decisões financeiras
aprovadas.

Esta decisão precisa permitir avanço controlado sem trocar uma stack funcional, sem antecipar o
schema de negócio e sem transformar a ausência temporária de Docker em dependência permanente de
um banco remoto compartilhado.

## Decisão

### Plataforma

Manter a fundação atual:

- monorepo leve com npm workspaces;
- SPA React/TypeScript construída pelo Vite em `apps/web`;
- Supabase gerenciado como backend para ambientes compartilhados;
- PostgreSQL como fonte de verdade;
- Supabase Auth para identidade;
- Data API sob RLS para acesso comum do frontend;
- RPCs PostgreSQL para operações transacionais e regras críticas;
- Edge Functions somente para integrações externas e operações privilegiadas fora do navegador;
- views SQL estáveis para o Tableau.

Não introduzir Next.js, servidor Node, ORM, framework de monorepo ou microsserviços antes de existir
um requisito concreto.

### Autenticação e autorização

O sistema será privado. Cadastro público ficará desabilitado. Usuários serão convidados ou
provisionados por administradores. Supabase Auth emitirá JWTs; autorização funcional será
aplicada no PostgreSQL, não apenas na interface.

A modelagem futura contemplará visualizador, editor, aprovador financeiro e administrador, além
de eventual escopo por projeto ou cliente. A fonte de autorização será uma estrutura controlada
no banco. Custom claims podem ser uma otimização, desde que o processo de revogação e renovação de
token seja aceito.

### RLS

Adotar negação por padrão:

- RLS habilitada e forçada em tabelas de negócio expostas;
- nenhum acesso de negócio para `anon`;
- grants mínimos e políticas por operação;
- `USING` e `WITH CHECK` explícitos;
- testes positivos e negativos para cada papel;
- views de frontend com `security_invoker = true`;
- funções `security invoker` por padrão;
- funções `security definer` somente quando necessárias, com `search_path` fixo, nomes
  qualificados e `EXECUTE` restrito;
- nenhuma chave secreta ou `service_role` no frontend.

### Ambientes

Usar ambientes isolados:

1. local com Vite e Supabase CLI/Docker;
2. projeto remoto de desenvolvimento temporário enquanto Docker não existir;
3. projeto Supabase e frontend próprios para homologação;
4. projeto Supabase e frontend próprios para produção.

O projeto remoto temporário receberá somente dados sintéticos e não poderá ser staging ou
produção. Ele será descartável e não elimina a obrigação de validar migrations e RLS localmente
quando Docker estiver disponível.

### Hospedagem e entrega

Adotar Vercel como padrão proposto para o frontend Vite, com preview por pull request e produção
em domínio corporativo. A adoção é reversível porque o artefato é estático.

Adotar GitHub Actions como padrão proposto para CI/CD assim que o remoto GitHub existir. Pull
requests executam as verificações npm e, quando houver banco, testes locais do Supabase em runner
com Docker. Deploy de staging ocorre após integração aprovada; produção exige ambiente protegido,
secrets próprios e aprovação manual.

### Configuração e segredos

Usar:

- `.env.example` para contrato sem segredos;
- `.env.local`/cofre para desenvolvimento;
- variáveis por ambiente na Vercel;
- GitHub Environment secrets para pipelines;
- secrets do Supabase para Edge Functions;
- chave publicável no navegador;
- chaves secretas, `service_role`, senha do banco e token do CLI somente em contexto confiável.

### Banco, migrations e recuperação

Toda mudança de banco será migration incremental, revisada e imutável depois de compartilhada.
Seeds serão sintéticos e restritos a local/teste. A mesma sequência de migrations será promovida
para staging e produção; mudanças manuais remotas não serão aceitas como fonte de verdade.

Produção usará backups gerenciados. PITR, retenção externa, RPO e RTO precisam de aprovação antes
do go-live. Restaurações serão testadas periodicamente e antes de migrations de risco haverá
backup e plano de reversão.

### Observabilidade

Separar auditoria de negócio, logs técnicos e error tracking do frontend. O primeiro ciclo usará
as ferramentas nativas de Supabase/Vercel; uma solução central, preferencialmente Sentry ou
compatível com OpenTelemetry, será escolhida antes de produção. Logs não conterão segredos,
payloads financeiros completos nem dados pessoais desnecessários.

### Tableau

O Tableau usará TLS e usuário técnico PostgreSQL exclusivo, com senha rotacionável, modo
read-only e grants apenas sobre views analíticas. Não usará `postgres`, `service_role` nem
credenciais pessoais.

A conexão preferida é direta; em rede IPv4 sem endpoint direto, usar Supavisor em modo de sessão.
Não usar pooler transacional para o Tableau. O primeiro ciclo prefere fonte publicada com extract
e atualização controlada; live connection depende de testes de carga e SLA.

### Domínio

O frontend usará `app.<dominio-corporativo>` com HTTPS gerenciado. O endpoint padrão do Supabase
será mantido inicialmente; `api.<dominio>` depende de aprovação do add-on. Redirect URLs do Auth
serão separadas por ambiente e restritas a origens conhecidas.

## Alternativas consideradas

### Next.js no lugar de React/Vite

Rejeitada agora. SSR e backend-for-frontend não são requisitos atuais. A troca aumentaria
complexidade e invalidaria uma base já testada. Pode ser revista se SEO, renderização no servidor,
middleware confiável ou rotas server-side se tornarem requisitos.

### Bubble.io ou plataforma low-code

Não adotada. A especificação aceitava essa possibilidade, mas o repositório já possui stack web
tipada e o domínio exige migrations, RLS, testes e revisão de regras financeiras com rastreabilidade
que se beneficiam de código versionado.

### Backend Node/Express próprio

Não adotado inicialmente. Data API, Auth e RPCs cobrem o fluxo atual com menos componentes
operacionais. Um backend dedicado será considerado quando houver integrações longas, filas,
protocolos não atendidos, requisitos de rede ou lógica que não pertença ao banco/Edge Functions.

### PostgreSQL sem Supabase

Não adotado. Reduziria lock-in, mas exigiria operar autenticação, API, conexões, observabilidade e
backups adicionais. O Supabase atende a fase atual e preserva portabilidade dos dados por usar
PostgreSQL.

### Supabase totalmente self-hosted

Não adotado para ambientes compartilhados. Aumenta responsabilidade por atualização, TLS,
backups, monitoramento, disponibilidade e resposta a incidentes. A stack Docker local continua
apropriada somente para desenvolvimento/testes.

### Um único projeto Supabase para todos os ambientes

Rejeitada. Compartilhar banco e credenciais aumenta risco de vazamento, drift, colisão de dados e
deploy acidental em produção.

### Desenvolver temporariamente em staging ou produção

Rejeitada. A ausência de Docker será tratada com um projeto dev isolado e sintético.

### Cloudflare Pages, Netlify ou hosting corporativo

Alternativas viáveis. Vercel foi preferida pela integração simples com Vite, previews, ambientes e
TLS. A escolha pode mudar por contratação, residência de dados, rede ou padrão corporativo.

### CI do Supabase por integração nativa

É alternativa válida. GitHub Actions foi preferido para reunir aplicação, banco, gates e
aprovações em um pipeline auditável. Branching do Supabase pode complementar previews se o plano
e custo forem aprovados.

### Tableau com acesso a tabelas base

Rejeitada. Acopla workbooks ao modelo transacional, expõe colunas desnecessárias e espalha regras
de cálculo. Tableau consumirá somente views reconciliadas.

### Tableau com live connection desde o início

Não adotada como padrão. Extract controlado reduz carga e torna a atualização previsível. Live
permanece possível após medição de volume, concorrência e SLA.

## Justificativas

- A stack existente já passa em instalação, lint, typecheck, testes e build.
- React/Vite atende um CRUD interno sem impor servidor adicional.
- PostgreSQL oferece constraints, transações, tipos monetários precisos e views analíticas.
- Supabase integra Auth, Data API e RLS sem impedir acesso SQL pelo Tableau.
- Ambientes separados reduzem blast radius e tornam promoção auditável.
- Migrations versionadas combatem drift e permitem reconstrução.
- RLS no banco protege o acesso mesmo quando o navegador chama a API diretamente.
- Usuário analítico dedicado respeita menor privilégio e separa carga operacional.
- Vercel e GitHub Actions oferecem um caminho simples, mas substituível, para entrega.

## Consequências positivas

- Nenhuma reescrita da implementação validada.
- Menos componentes para operar na primeira fase.
- Autorização centralizada e testável.
- Desenvolvimento e deploy reproduzíveis.
- Separação clara entre dados transacionais e contrato analítico.
- Menor risco de credenciais privilegiadas no navegador.
- Promoção controlada de banco e frontend.
- Possibilidade de trocar o hosting estático sem reescrever o app.
- Portabilidade dos dados e views por permanecer em PostgreSQL.

## Consequências negativas

- RLS e RPCs exigem conhecimento avançado de PostgreSQL e testes rigorosos.
- Supabase local consome recursos e depende de runtime Docker compatível.
- O projeto remoto temporário gera custo e risco de drift.
- SPA não oferece SSR; uma necessidade futura pode exigir nova decisão.
- Dois projetos Supabase compartilhados aumentam custo operacional.
- Vercel, Supabase e GitHub introduzem dependências de fornecedores.
- Extract do Tableau não é em tempo real.
- Backups, PITR, log drains e domínios customizados podem exigir planos pagos.
- Promoções de banco não têm rollback automático seguro para toda mudança SQL.

## Riscos

| Risco                                 | Tratamento                                                       |
| ------------------------------------- | ---------------------------------------------------------------- |
| Política RLS permissiva               | negação por padrão, revisão e testes por papel                   |
| `service_role` exposta                | proibição em `VITE_`, secret scanning e rotação                  |
| Drift remoto                          | migrations como fonte de verdade e checagem no CI                |
| Testes de banco bloqueados sem Docker | projeto dev sintético temporário e bloqueio de go-live           |
| Migration destrutiva                  | expand/contract, backup, gate manual e plano de reversão         |
| Tableau sobrecarrega produção         | extract inicial, views otimizadas, timeout e monitoramento       |
| Perda maior que o tolerado            | aprovar RPO/RTO, PITR e testes de restore                        |
| Claims obsoletas                      | tokens curtos, refresh/revogação e fonte de autorização no banco |
| Preview usa produção                  | secrets por ambiente e allowlist de redirects                    |
| Lock-in de fornecedor                 | SQL portátil, artefato estático e documentação de recuperação    |

## Decisões pendentes

Dependem de responsáveis humanos:

1. aprovar a matriz de papéis, permissões e escopos;
2. escolher login por senha, magic link ou SSO e exigir ou não MFA;
3. confirmar organização, região, plano e responsáveis no Supabase;
4. aprovar Vercel e GitHub ou indicar provedores corporativos;
5. definir domínio, acesso a DNS e nomenclatura de staging;
6. definir RPO, RTO, PITR, retenção e cópia externa;
7. classificar dados e definir retenção de logs/LGPD;
8. selecionar error tracking, alertas e responsáveis por incidentes;
9. decidir Tableau Cloud/Server, live/extract e agenda de refresh;
10. confirmar todas as decisões financeiras da especificação, incluindo o conceito de realizado;
11. aprovar a política de convites, desligamento, sessão e rotação de credenciais;
12. decidir se o projeto dev remoto temporário pode ser criado e quem paga/opera.

## Condições para revisão futura

Este ADR deve ser revisto quando ocorrer qualquer uma destas condições:

- necessidade comprovada de SSR ou backend-for-frontend;
- integrações assíncronas, filas ou jobs longos;
- volume ou concorrência exceder a capacidade escolhida;
- requisito de residência de dados, rede privada ou self-hosting;
- política corporativa impedir Supabase, Vercel ou GitHub;
- mudança relevante de custos ou limites dos provedores;
- RPO/RTO incompatível com os recursos contratados;
- Tableau live causar impacto operacional;
- novo modelo multiempresa ou isolamento por organização;
- incidente de segurança indicar insuficiência da estratégia RLS/secrets;
- aprovação das decisões de negócio exigir nova fronteira transacional.

## Referências

- [Supabase local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase managing environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase custom claims e RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase logs](https://supabase.com/docs/guides/telemetry/logs)
- [Vercel environments](https://vercel.com/docs/deployments/environments)
- [Vercel SSL](https://vercel.com/docs/domains/working-with-ssl)
- [GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)
- [GitHub Actions secrets](https://docs.github.com/en/actions/concepts/security/secrets)
- [Tableau PostgreSQL connector](https://help.tableau.com/current/pro/desktop/en-us/examples_postgresql.htm)
