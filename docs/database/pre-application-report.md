# Relatório pré-aplicação — P004 / 1.04

## Alvo

| Campo         | Resultado                                         |
| ------------- | ------------------------------------------------- |
| Projeto       | `Funcionarios`                                    |
| Região        | `us-east-1`                                       |
| Papel         | desenvolvimento remoto temporário e compartilhado |
| Estado remoto | ativo e saudável                                  |
| CLI           | Supabase CLI 2.110.0 local                        |
| Homologação   | adiada; não simulada                              |
| Produção      | fora do escopo                                    |

O vínculo local ignorado foi comparado internamente com o projeto retornado pela conta. Nenhum
project ref, token, senha ou connection string foi registrado.

## Backup e risco aceito

Foi consultada a ajuda de `supabase db dump` e executado seu dry-run. A CLI confirmou uso de
`pg_dump`, mas a geração real do dump de schema falhou porque Docker não está disponível.
`pg_dump` também não está instalado e nenhum binário equivalente existe nas dependências.

**Nenhum ponto de restauração disponível para esta execução**.

Um arquivo vazio gerado pela tentativa permaneceu somente no diretório temporário do sistema e
não é um backup. O dump de dados não foi repetido pela mesma rota tecnicamente indisponível.

Prosseguir sem ponto de restauração é a exceção formal aprovada para esta execução e não reduz
nenhuma outra barreira.

## Estado de migrations

- migrations remotas antes da baseline: nenhuma;
- migrations locais antes da P004: somente `.gitkeep`;
- migration P004 criada:
  `20260729163000_create_ltcm_relational_core.sql`;
- histórico externo desconhecido: não encontrado;
- `db pull`, `db reset`, `migration repair` e `migration down`: não executados.

## Locks e atividade

- consultas com duração superior a cinco minutos: zero;
- locks exclusivos retornados pela inspeção: um lock concedido, sem relação associada e com idade
  `00:00:00`;
- interpretação: lock transitório da própria inspeção, sem relação de usuário bloqueada;
- as verificações serão repetidas imediatamente antes do push.

## Inventário sanitizado

O inventário completo está em
[`inventory-pre.json`](inventory-pre.json). Ele contém somente nomes técnicos, propriedades de
catálogo e hashes de definições. Não contém linhas de domínio, e-mails, nomes de pessoas, tokens,
senhas ou connection strings.

Coleta inicial:

| Métrica                        | Resultado |
| ------------------------------ | --------: |
| Registros de metadados         |     1.018 |
| Objetos em `ltc_m`             |         0 |
| Schemas externos inventariados |         9 |
| Tabelas                        |        42 |
| Tabela particionada            |         1 |
| Views                          |         3 |
| Sequences                      |         3 |
| Configurações de sequence      |         3 |
| Funções                        |        99 |
| Constraints                    |       131 |
| Índices                        |       130 |
| Colunas                        |       529 |
| Triggers de usuário            |         6 |
| Policies                       |         1 |
| Tipos                          |        61 |

Schemas encontrados: `auth`, `extensions`, `graphql`, `graphql_public`, `pgbouncer`, `public`,
`realtime`, `storage` e `vault`.

Fingerprint SHA-256 dos metadados fora de `ltc_m` e `supabase_migrations`:

```text
7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95
```

## Barreiras locais

- migration atômica e exclusivamente aditiva;
- 13 tabelas, 10 tipos, 16 índices explícitos e duas sequences identity em `ltc_m`;
- nenhum DML, seed, role, grant, RLS, extensão, função, trigger ou view;
- nenhuma referência a schema externo;
- nenhum tipo monetário de ponto flutuante;
- scanner aprovado;
- sete testes iniciais do scanner aprovados;
- nenhuma dependência instalada.

Não há Docker, Podman ou PostgreSQL local. Portanto o dry-run remoto não substitui uma validação
sintática em banco descartável. Essa limitação será destacada antes da decisão de push.

## Decisão prévia

O push somente pode ocorrer depois de:

1. validação local completa;
2. novo `migration list`;
3. novo inventário e confirmação de `ltc_m` ausente;
4. nova inspeção de locks e consultas longas;
5. dry-run contendo somente a migration P004;
6. resumo final do alvo e impacto.
