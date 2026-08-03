# AGENTS.md

Este arquivo define as regras para agentes e contribuidores automatizados neste repositório.

## Antes de alterar

1. Leia este arquivo, o `README.md` e os documentos relevantes em `docs/`.
2. Verifique `git status` e preserve alterações existentes.
3. Limite a mudança à tarefa solicitada e registre decisões arquiteturais relevantes.
4. Não faça commit, merge, push ou ações destrutivas sem solicitação explícita.

## Arquitetura e limites

- `apps/web`: aplicação CRUD React/TypeScript.
- `apps/api`: futuro backend Node.js LTS/TypeScript/NestJS com Express; não existe até a tarefa de
  scaffold correspondente.
- `supabase`: configuração local, migrations, seed e testes de banco.
- `scripts`: automações reproduzíveis e sem segredos.
- `docs`: arquitetura, convenções e decisões do projeto.
- `tests`: testes transversais que não pertencem a um pacote específico.

O PostgreSQL hospedado no Supabase é a fonte de verdade. O Supabase é usado somente como banco;
o frontend não acessa o banco diretamente. Autenticação usa Auth0, e o backend NestJS/Express é a
fronteira para validar tokens, aplicar autorização e acessar o PostgreSQL. Regras que exigem
atomicidade ou integridade devem permanecer no banco; o frontend não deve duplicar regras
críticas.

Não escolha ORM/query builder antes da decisão correspondente. Fastify só pode substituir Express
com medição, compatibilidade validada e nova decisão arquitetural aprovada.

O modelo deve manter separados contrato total, saldo de abertura, itens ativos, valores
planejados e realizados. Valores monetários usam `numeric`; códigos recebidos são normalizados;
itens repetidos não podem usar apenas o código do item como chave; acumulados analíticos devem
ser calculados por views.

Enquanto vigorar a exceção documentada em `docs/environments.md`, o projeto Supabase
`Funcionarios` é somente desenvolvimento temporário e compartilhado; nunca o trate como
homologação ou produção. Todo objeto de domínio futuro do LTC-M deve pertencer ao schema `ltc_m`,
nunca a `public`. Qualifique objetos com `ltc_m.` em migrations e consultas, não altere objetos do
outro sistema e exija backup recuperável antes de migrations remotas. A ausência de backup só pode
ser aceita por exceção formal, explícita e documentada para a execução específica. Extensões
compartilhadas exigem análise explícita, e migrations devem falhar antes de operar fora de `ltc_m`.

Não implemente decisões de negócio ainda pendentes como se estivessem aprovadas. Consulte
`docs/architecture.md` e a documentação funcional de origem.

As decisões de segurança D22–D28 estão, cada uma, marcadas como `Decidida` desde 31/07/2026 e têm
como fonte canônica o
[`ADR-0003`](docs/adr/0003-seguranca-postgresql-e-aplicacao-p008.md). As migrations P008 já foram
aplicadas. D26 aceita e exige preservar a associação automática
`ltc_m_runtime` → `postgres`, concedida por `supabase_admin` com `ADMIN=true`, `INHERIT=false` e
`SET=false`. D27 permite somente ao harness versionado de validação criar uma segunda associação
temporária, concedida por `postgres` com `ADMIN=false`, `INHERIT=false` e `SET=true`; o harness
deve provar a reversibilidade, usar trava e conexões separadas, revogar seletivamente o grantor
`postgres` em `finally` e restaurar exatamente D26. D28 autoriza uma única migration forward
somente de ACL de funções no schema `ltc_m`, seguida de um único `db push`; nenhuma outra
migration, grant manual, login persistente de teste ou alteração de policy/tabela/role é permitida.
Preserve os perfis em `ltc_m.app_users`, proteja o último admin ativo e impeça acesso direto do
runtime a `ltc_m.audit_log`.

A D29 foi decidida em 31/07/2026 e a migration P009 foi aplicada remotamente uma única vez; nunca
repita o push. Na revalidação de 03/08/2026, P007/P008, cleanup, D26 e fingerprints passaram, mas
a etapa P009 não executou por erro sintático do renderizador local. O estado é parcialmente
concluído. A D30 foi decidida e aprovada pelo responsável do projeto em 03/08/2026 e autoriza
exatamente uma reexecução remota do harness P009 corrigido, sem repetição automática. Ela não
autoriza migration, `db push`, DDL, SQL Editor, alteração persistente de ACL/policies/roles/
memberships, seeds ou dados permanentes. A execução D30 `r20260803132652-ada2b257` já consumiu
essa autorização: P007/P008 e o cleanup passaram, mas a suíte P009 parou em outro erro local de
aridade de `VALUES`; `rollback_clean=true` e os fingerprints permaneceram intactos. A fixture foi
corrigida somente localmente, e qualquer nova execução remota exige outra decisão explícita. O
staging permanece genérico em `ltc_m`, sem leitura de XLSX ou dados reais.

A D31 foi decidida e aprovada pelo responsável do projeto em 03/08/2026. Ela autoriza exatamente
uma nova invocação remota do harness P009 somente depois da aprovação do gate local integral do
SQL renderizado. A invocação deve executar a Fase A transacional com `ROLLBACK` e iniciar a Fase B
somente com `phase_a_passed=true`. Não há autorização para repetição automática, migration,
`db push`, DDL, SQL Editor, correção remota, ACL/policy/role/membership persistente, seed ou dado
permanente. Toda fixture, trava e concessão D27 deve ser limpa em `finally`, preservando D26.

A única invocação D31 `r20260803141344-e3356875` já consumiu a autorização. A Fase A passou; a
Fase B falhou na assertion de auditoria P009 antes da matriz RLS específica. P007/P008, D23,
cleanup, D26 e fingerprints passaram, `rollback_clean=true`, contagens e locks ficaram zerados.
Não reexecute o harness sem nova decisão explícita.

A D32 foi decidida e aprovada pelo responsÃ¡vel do projeto em 03/08/2026. O contrato canÃ´nico Ã©
`audit_log.request_id = request_id` do contexto transacional ativo no instante do DML auditado;
o campo homÃ´nimo da entidade nÃ£o substitui o contexto. D32 autoriza somente a correÃ§Ã£o local do
harness, renderer, fixtures sintÃ©ticas, scanners e testes, seguida de exatamente uma invocaÃ§Ã£o
remota final. Trigger, funÃ§Ã£o, schema e migrations permanecem inalterados. NÃ£o repita a
invocaÃ§Ã£o D32, mesmo em falha.

A única invocação D32 `r20260803151221-2d4f91ba` já foi consumida. Fase A, SQL P009, P007/P008,
D23 e cleanup executaram sem erro SQL, mas o orquestrador não capturou o marcador intermediário
P009 e retornou código 1. O estado é parcialmente concluído, `rollback_clean=true`, D26 e
fingerprints foram preservados. Não reexecute o harness sem nova decisão explícita.

A D33 foi decidida e aprovada pelo responsável do projeto em 03/08/2026. Ela autorizou somente o
launcher, a captura, o protocolo de evidência e uma única invocação remota final. A invocação
`r20260803173036-ddabb07d` terminou com código 0, envelope `P009_RESULT_V1` íntegro após `close`,
Fases A/B, P009, P007/P008, cleanup e fingerprints aprovados. D33 foi consumida: não reexecute o
harness sem nova decisão explícita.

## Qualidade

Antes de concluir uma alteração, execute:

```bash
npm run env:check
npm run migrations:check
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Adicione testes no mesmo pacote do comportamento alterado. Migrations devem ser incrementais,
idempotentes quando aplicável e acompanhadas por testes SQL para constraints, grants e políticas
RLS quando utilizadas como defesa em profundidade.

Toda migration deve passar por `npm run migrations:check`. O scanner rejeita DML, operações
destrutivas, objetos fora de `ltc_m`, referências a schemas externos, Supabase Auth, seeds, roles,
grants, extensões, SQL dinâmico e tipos financeiros imprecisos. Exceções exigem decisão
arquitetural e revisão explícitas antes de alterar o scanner.

Quando `apps/api` existir, mudanças no backend devem cobrir, conforme o comportamento afetado,
testes unitários, integração, autenticação, autorização, contratos, transações e concorrência.

## Segurança

- Nunca grave tokens, senhas, chaves privadas ou dados reais em fixtures.
- Variáveis públicas do Vite usam `VITE_`; credenciais privilegiadas nunca usam esse prefixo.
- Use `.env.example` apenas com nomes e valores locais não sensíveis.
- `DATABASE_URL`, segredos do Auth0 e credenciais PostgreSQL são exclusivamente server-side.
- Não execute `supabase db reset`, migrations remotas ou comandos de produção sem autorização.
- No banco compartilhado, interrompa diante de migration remota desconhecida; não use
  `migration repair` para forçar alinhamento.
- A conexão do Tableau deve usar uma função somente leitura.

## Código e documentação

- TypeScript deve permanecer em modo estrito.
- Prefira módulos pequenos, nomes de domínio explícitos e APIs tipadas.
- Formate com Prettier e valide com ESLint.
- Use Conventional Commits e as regras de branch em `docs/conventions.md`.
- Atualize o `README.md` quando comandos, pré-requisitos ou fluxo local mudarem.
