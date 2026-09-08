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

## Governanca de revisao e mantenedor unico

### Regra normal

Quando houver outro mantenedor ou reviewer humano legitimamente autorizado, toda mudanca deve
seguir a regra normal: branch propria, pull request contra `main`, diff completo revisado e pelo
menos uma revisao humana independente antes do merge. Revisao independente significa uma pessoa
autorizada diferente do autor e do responsavel pelo merge. Self-review, automated review e checks
de CI nao sao revisao humana independente.

Quando nao for possivel determinar com seguranca se existe outro reviewer autorizado, aplica-se a
regra normal ate que o mantenedor registre a situacao. Nao se adiciona colaborador externo apenas
para satisfazer formalmente a regra.

### `SINGLE_MAINTAINER_MODE`

O modo `SINGLE_MAINTAINER_MODE` pode ser usado somente quando o repositorio tiver um unico
mantenedor humano autorizado e isso for explicitamente atestado pelo mantenedor no PR. A ausencia
de reviews, por si so, nao prova essa condicao. Se houver outro mantenedor legitimamente autorizado,
retorna-se a regra normal.

Nesse modo, a segunda aprovacao humana e substituida, de forma explicita e auditavel, pelo gate
`SOLO_MAINTAINER_REVIEW`. O gate nao chama self-review ou automated review de revisao humana
independente e nao altera a identidade do autor ou do mantenedor.

O `SOLO_MAINTAINER_REVIEW` exige, no minimo:

- pull request obrigatorio, com autor e responsavel pelo merge identificados;
- diff completo lido e revisado;
- escopo comparado com o contrato, plano ou decisao autoritativa aplicavel;
- confirmacao de que nao ha arquivos ou alteracoes fora do escopo;
- head SHA e fingerprints relevantes congelados antes da decisao;
- checks/CI obrigatorios quando existirem;
- validacoes locais obrigatorias do projeto;
- falhas preexistentes diferenciadas de regressoes;
- nenhuma falha nova material sem resolucao ou decisao explicita;
- automated review separado, quando houver mecanismo disponivel;
- declaracao explicita de self-review do mantenedor;
- decisao explicita de merge pelo mantenedor;
- nenhuma desativacao ou bypass silencioso de protecao;
- justificativa rastreavel para o uso de `SINGLE_MAINTAINER_MODE`.

O registro do gate deve ficar no corpo ou na conversa do PR e conter, no minimo, os campos abaixo.
Valores ausentes devem ser registrados como `NOT_AVAILABLE`, nunca presumidos como aprovados:

```text
SOLO_MAINTAINER_REVIEW
mode: SINGLE_MAINTAINER_MODE
pr: <numero>
author: <identidade>
merge_responsible: <identidade>
single_maintainer_basis: <justificativa verificavel>
base_sha: <SHA>
head_sha: <SHA congelado>
fingerprints: <valores ou NOT_APPLICABLE>
scope_authority: <documento/decisao>
full_diff_review: PASS
out_of_scope_changes: NONE
local_validations: <comandos e resultados>
ci_checks: <checks e resultados ou NOT_AVAILABLE>
known_failures: <baseline diferenciada ou NONE>
new_material_failures: NONE
automated_review: APPROVED|CHANGES_REQUIRED|BLOCKED|NOT_AVAILABLE
self_review: <declaracao explicita do mantenedor>
human_owner_decision: <decisao explicita>
critical_change: NO|YES
decision: MERGE_AUTHORIZED|BLOCKED
decision_at: <timestamp>
```

Automated review e um controle complementar. Quando disponivel, deve revisar o PR inteiro sem
modificar arquivos e produzir `APPROVED`, `CHANGES_REQUIRED` ou `BLOCKED`. Seu resultado deve ser
registrado separadamente do self-review e nao pode ser apresentado como aprovacao humana.

### Alteracoes criticas

Sao criticas, entre outras, migrations destrutivas, relaxamento ou remocao de RLS, alteracoes de
autenticacao/autorizacao ou grants, perda de dados, quebra destrutiva de contrato publico, force
operation, history rewrite, deploy produtivo, acesso ou alteracao de banco remoto e manuseio de
segredos.

`SINGLE_MAINTAINER_MODE` nao autoriza automaticamente uma alteracao critica. Antes da operacao,
e obrigatorio o gate `HUMAN_OWNER_DECISION_REQUIRED`, com decisao explicita do mantenedor,
justificativa, riscos, impacto, validacoes e plano de reversao. Autorizacoes especificas de
`AGENTS.md`, seguranca, ambiente ou banco continuam obrigatorias; este modo nao as substitui.

### Bootstrap da governanca

A primeira alteracao que introduz esta politica pode ser aberta em branch e PR proprios pelo unico
mantenedor. Como a regra anterior exige uma revisao que o proprio modelo nao consegue fornecer,
esse PR de bootstrap pode usar `SOLO_MAINTAINER_REVIEW` sem self-approval do GitHub. O mantenedor
deve registrar a impossibilidade objetiva de uma segunda pessoa, revisar o diff completo, executar
os checks aplicaveis e declarar a decisao humana explicita. Isso nao e revisao humana independente,
nao cria identidade alternativa e nao permite admin bypass.

O bootstrap deve permanecer em PR separado, sem misturar implementacao funcional. Depois de
incorporada, esta secao passa a reger novos PRs; qualquer mudanca futura nesta politica exige novo
PR e novo registro do gate. A politica documental nao altera automaticamente branch protection,
rulesets ou exigencias configuradas no GitHub. Se a configuracao efetiva continuar exigindo
approval de outra pessoa, o merge permanece tecnicamente bloqueado ate uma alteracao de configuracao
explicitamente autorizada, sem bypass.

## Versionamento

Até o primeiro release público, o projeto usa versão `0.x`. Releases seguem versionamento
semântico e devem incluir notas de migrations e incompatibilidades.
