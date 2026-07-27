# AGENTS.md

Este arquivo define as regras para agentes e contribuidores automatizados neste repositório.

## Antes de alterar

1. Leia este arquivo, o `README.md` e os documentos relevantes em `docs/`.
2. Verifique `git status` e preserve alterações existentes.
3. Limite a mudança à tarefa solicitada e registre decisões arquiteturais relevantes.
4. Não faça commit, merge, push ou ações destrutivas sem solicitação explícita.

## Arquitetura e limites

- `apps/web`: aplicação CRUD React/TypeScript.
- `supabase`: configuração local, migrations, seed e testes de banco.
- `scripts`: automações reproduzíveis e sem segredos.
- `docs`: arquitetura, convenções e decisões do projeto.
- `tests`: testes transversais que não pertencem a um pacote específico.

O PostgreSQL/Supabase é a fonte de verdade. Regras que exigem atomicidade, autorização ou
integridade devem ficar no banco/RPC. O frontend não deve duplicar regras críticas.

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
idempotentes quando aplicável e acompanhadas por testes SQL para constraints e políticas RLS.

## Segurança

- Nunca grave tokens, senhas, chaves privadas ou dados reais em fixtures.
- Variáveis públicas do Vite usam `VITE_`; credenciais privilegiadas nunca usam esse prefixo.
- Use `.env.example` apenas com nomes e valores locais não sensíveis.
- Não execute `supabase db reset`, migrations remotas ou comandos de produção sem autorização.
- A conexão do Tableau deve usar uma função somente leitura.

## Código e documentação

- TypeScript deve permanecer em modo estrito.
- Prefira módulos pequenos, nomes de domínio explícitos e APIs tipadas.
- Formate com Prettier e valide com ESLint.
- Use Conventional Commits e as regras de branch em `docs/conventions.md`.
- Atualize o `README.md` quando comandos, pré-requisitos ou fluxo local mudarem.
