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

Não implemente decisões de negócio ainda pendentes como se estivessem aprovadas. Consulte
`docs/architecture.md` e a documentação funcional de origem.

## Qualidade

Antes de concluir uma alteração, execute:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Adicione testes no mesmo pacote do comportamento alterado. Migrations devem ser incrementais,
idempotentes quando aplicável e acompanhadas por testes SQL para constraints, grants e políticas
RLS quando utilizadas como defesa em profundidade.

Quando `apps/api` existir, mudanças no backend devem cobrir, conforme o comportamento afetado,
testes unitários, integração, autenticação, autorização, contratos, transações e concorrência.

## Segurança

- Nunca grave tokens, senhas, chaves privadas ou dados reais em fixtures.
- Variáveis públicas do Vite usam `VITE_`; credenciais privilegiadas nunca usam esse prefixo.
- Use `.env.example` apenas com nomes e valores locais não sensíveis.
- `DATABASE_URL`, segredos do Auth0 e credenciais PostgreSQL são exclusivamente server-side.
- Não execute `supabase db reset`, migrations remotas ou comandos de produção sem autorização.
- A conexão do Tableau deve usar uma função somente leitura.

## Código e documentação

- TypeScript deve permanecer em modo estrito.
- Prefira módulos pequenos, nomes de domínio explícitos e APIs tipadas.
- Formate com Prettier e valide com ESLint.
- Use Conventional Commits e as regras de branch em `docs/conventions.md`.
- Atualize o `README.md` quando comandos, pré-requisitos ou fluxo local mudarem.
