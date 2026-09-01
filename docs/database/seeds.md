# Seeds de valores controlados

## Mecanismo oficial

O arquivo [`supabase/seed.sql`](../../supabase/seed.sql) é a fonte única dos valores controlados
aprovados para a primeira versão. Não existe migration de dados com os mesmos registros.

Essa escolha segue a estrutura já existente do repositório, mantém DDL e dados de referência
separados e permite aplicar exatamente o mesmo SQL em PostgreSQL local ou no desenvolvimento
remoto. A baseline P004 permanece imutável.

## Matriz aprovada

| Entidade | Tabela             | Chave natural | Nome/semântica preservada                            | Metadados aprovados                   |
| -------- | ------------------ | ------------- | ---------------------------------------------------- | ------------------------------------- |
| Moeda    | `ltc_m.currencies` | `BRL`         | `Real brasileiro`                                    | `decimal_places = 2`, `active = true` |
| Moeda    | `ltc_m.currencies` | `USD`         | `Dólar americano`                                    | `decimal_places = 2`, `active = true` |
| Unidade  | `ltc_m.units`      | `US`          | código histórico; significado normativo pendente D07 | `category = null`, `active = true`    |

`USD` é código de moeda. `US` é código histórico de unidade e não é reinterpretado por esta
documentação; o rótulo textual legado armazenado pelo seed permanece preservado até decisão D07.

Não existem outras moedas ou unidades seedadas/aprovadas. Cada projeto possui exatamente uma moeda, o
portfólio pode conter projetos em moedas diferentes e não há conversão cambial implementada.
Novas moedas e novas unidades exigem aprovação explícita.

Os papéis, estados, níveis e métricas da baseline são enums do PostgreSQL, não tabelas de
cadastro, e não recebem seed.

## Idempotência, divergências e atomicidade

O seed executa em uma transação explícita e adquire locks `SHARE ROW EXCLUSIVE` sobre
`ltc_m.currencies` e `ltc_m.units`. Os locks serializam escritas concorrentes nas duas tabelas
durante a validação e a inserção.

Antes de inserir qualquer linha, o bloco de validação trata os três estados:

- registro inexistente: a linha aprovada é inserida;
- registro idêntico: nenhuma linha é inserida ou atualizada;
- registro divergente: uma exceção clara interrompe a transação e exige revisão humana.

As três divergências são verificadas antes das inserções. Assim, uma falha em `BRL`, `USD` ou `US`
reverte toda a transação e não deixa aplicação parcial. O arquivo não usa `UPDATE`, `DELETE`,
`TRUNCATE`, `ON CONFLICT DO UPDATE` ou objetos fora de `ltc_m`.

Para `BRL` e `USD`, nome, casas decimais e status devem coincidir. Para `US`, o código, rótulo
textual legado, categoria nula e status devem coincidir. A categoria permanece nula porque nenhum
valor foi aprovado para ela.

## Validação estática

Execute:

```bash
npm run seeds:check
npm run test:seeds
```

O scanner não possui dependências novas. Ele exige a transação, os dois locks, validações antes
das inserções e exatamente os três payloads aprovados (BRL, USD e US). Também rejeita:

- schemas e tabelas fora do escopo;
- comandos destrutivos, alterações de schema e updates;
- projetos, clientes, usuários, planejamentos, eventos e outros cadastros;
- moedas diferentes de `BRL` e `USD`, e unidades diferentes de `US`;
- nome incorreto de `US`;
- Supabase Auth, dados pessoais, credenciais, endpoints e project refs;
- arquivo vazio e declarações duplicadas.

Os testes modelam primeira e segunda execução, divergências e rollback lógico da operação. Como
Docker, Podman, `psql` e `pg_dump` não estavam disponíveis na P005, não houve teste local real em
PostgreSQL descartável. Essa limitação não é tratada como evidência de execução local.

## Execução local

Com o Supabase local já iniciado:

```bash
supabase db query --local --file supabase/seed.sql
```

O `supabase db reset` local também usa o `seed.sql` configurado, mas é destrutivo e não deve ser
usado em bancos compartilhados ou remotos.

## Execução remota controlada

O único alvo temporariamente autorizado é `Funcionarios`, em `us-east-1`. Antes de qualquer
escrita:

```bash
supabase projects list --output-format json
supabase migration list --linked
npm run migrations:check
npm run seeds:check
node scripts/collect-db-inventory.mjs --phase pre --output docs/database/seed-inventory-pre.json
supabase db query --linked --file database/audit/controlled-values-check.sql --output-format json
```

Confirme o nome, a região, a baseline P004, tabelas-alvo em `ltc_m`, ausência de divergências,
tabelas operacionais vazias e fingerprints separados para objetos externos, `ltc_m` e histórico
de migrations.

Aplicação e prova de idempotência:

```bash
supabase db query --linked --file supabase/seed.sql
supabase db query --linked --file database/audit/controlled-values-check.sql --output-format json
supabase db query --linked --file supabase/seed.sql
supabase db query --linked --file database/audit/controlled-values-check.sql --output-format json
node scripts/collect-db-inventory.mjs --phase post --output docs/database/seed-inventory-post.json
```

Nunca usar `db reset`, `db pull`, `migration repair`, SQL Editor manual ou arquivos de seed de
outros projetos nesse fluxo.

## Alterações futuras

Para incluir um novo código:

1. obter aprovação explícita de código, nome e todos os campos obrigatórios;
2. atualizar a matriz, o `supabase/seed.sql`, o scanner e os testes na mesma mudança;
3. executar o preflight, a prova de idempotência e a auditoria completa;
4. interromper diante de qualquer registro preexistente divergente.

Uma correção de valor já existente não pode ser transformada em atualização silenciosa. Ela exige
uma nova decisão arquitetural e revisão explícita da estratégia; até lá, o seed continuará
bloqueando a divergência.
