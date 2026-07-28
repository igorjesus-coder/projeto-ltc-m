# Convenções de desenvolvimento

## Branches

A branch protegida principal é `main`. Todo trabalho deve partir de uma `main` atualizada e ser
integrado por pull request.

Formato:

```text
<tipo>/<tarefa>-<descricao-curta>
```

Tipos aceitos:

- `feat`: nova capacidade;
- `fix`: correção;
- `chore`: infraestrutura e manutenção;
- `docs`: documentação;
- `test`: cobertura sem mudança funcional;
- `refactor`: mudança interna sem alterar comportamento.

Exemplo: `chore/1.01-inicializar-repositorio`.

Use letras minúsculas, hífens e identificador da tarefa. Não reutilize uma branch já integrada.

## Commits

Use Conventional Commits:

```text
<tipo>(<escopo>): <descricao no imperativo>
```

Exemplos:

```text
feat(db): adiciona cadastro normalizado de projetos
fix(web): impede envio duplicado do lançamento
docs(repo): documenta ambiente local
```

Um commit deve representar uma mudança coerente. Não inclua artefatos gerados, segredos ou
formatação sem relação com a tarefa.

## Pull requests

O pull request deve informar:

- problema e escopo;
- abordagem adotada;
- migrations e comandos necessários;
- evidências de lint, typecheck, testes e build;
- riscos, decisões pendentes e plano de reversão;
- capturas de tela para mudanças visuais.

Pelo menos uma revisão é necessária. Mudanças de schema, RLS, funções financeiras ou views
analíticas exigem revisão de alguém responsável pelo banco e pela regra de negócio.

## Critério de pronto

Uma tarefa está pronta quando:

- os critérios de aceite estão cobertos;
- o fluxo local continua reproduzível com `npm ci`;
- lint, typecheck, testes e build passam;
- migrations e seeds foram validados localmente, quando aplicável;
- documentação e `.env.example` refletem novas configurações;
- não há segredos ou dados pessoais no diff.

## SQL

- Objetos usam `snake_case`; tabelas usam nomes no plural.
- Migrations são imutáveis depois de compartilhadas.
- Chaves primárias usam UUID, salvo justificativa registrada.
- Timestamps usam `timestamptz`.
- Dinheiro usa `numeric` com precisão definida pelo domínio.
- Tabelas de negócio não são expostas diretamente ao frontend; o backend próprio é a fronteira da
  API. Grants, constraints e eventual RLS usados como defesa em profundidade devem ser testados.
- Views do Tableau usam o prefixo `v_tableau_`.

## TypeScript

- Modo estrito é obrigatório.
- Componentes usam `PascalCase`; funções e variáveis usam `camelCase`.
- Evite `any`; valide dados externos na fronteira do sistema.
- Regras financeiras e estados de domínio não devem existir apenas na interface.
- No futuro `apps/api`, módulos NestJS devem separar controllers, services, providers, guards e
  responsabilidades de domínio sem acoplamento circular.
- Express é o adaptador HTTP aprovado; não introduza Fastify ou biblioteca de acesso ao banco sem
  a decisão arquitetural correspondente.

## Versionamento

Até o primeiro release público, o projeto usa versão `0.x`. Releases seguem versionamento
semântico e devem incluir notas de migrations e incompatibilidades.
