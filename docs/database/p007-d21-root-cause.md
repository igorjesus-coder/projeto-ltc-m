# Causa raiz e correção forward D21 — P007 / 1.07

## Estado e decisão

A execução posterior à correção PW902 falhou com PostgreSQL `42703` ao atualizar
`ltc_m.app_users.active`. A autorização formal D21 permite exatamente uma segunda migration
forward corretiva no projeto `Funcionarios`, região `us-east-1`, exclusivamente em `ltc_m`, mesmo
sem backup recuperável.

As cinco migrations já aplicadas permanecem imutáveis. A correção não cria colunas, tabelas,
triggers, enums, RLS, policies, roles, grants, revokes ou extensões.

## Causa raiz confirmada

`enforce_admin_inactivation()` foi criada como trigger genérico para quatro tabelas heterogêneas.
Ela começa corretamente com `to_jsonb(OLD)` e `to_jsonb(NEW)` para detectar a presença de
`deleted_at` e `active`, mas depois acessa diretamente:

```sql
old.deleted_at
new.deleted_at
```

O registro `OLD` de `app_users` possui `active`, mas não possui `deleted_at`. PL/pgSQL resolve o
campo contra o tipo real do registro do trigger e produz `42703`, mesmo que a expressão esteja em
um ramo precedido por uma verificação JSONB.

Não existe coluna `is_active` em nenhuma tabela `ltc_m`. Substituir `deleted_at` cegamente por
`is_active` seria incorreto.

## Matriz de tabelas, triggers e colunas

| Tabela          | Trigger e evento                                     | Função                         | Colunas reais de ciclo de vida                            | Condição anterior                                                                         | Risco                                                             | Regra aprovada                                                                                                    | Correção e teste                                                                                                                                              |
| --------------- | ---------------------------------------------------- | ------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_users`     | `trg_05_app_users_inactivation`, `BEFORE UPDATE`     | `enforce_admin_inactivation()` | `active`; `role` é campo administrativo; sem `deleted_at` | mudança de `active` detectada por JSONB; normalização posterior acessava `OLD.deleted_at` | `42703`; mudança de `role` por não admin não era rejeitada        | ciclo de vida exige admin ativo e justificativa; administração de papel exige admin ativo; DELETE físico proibido | JSONB de ponta a ponta, ramo de `role` limitado por `TG_TABLE_NAME`; testes de update comum, papéis, inativação, reativação, ator ausente, auditoria e DELETE |
| `clients`       | `trg_05_clients_inactivation`, `BEFORE UPDATE`       | mesma                          | `active`, `deleted_at`                                    | qualquer mudança era protegida; `deleted_at` era acessada diretamente                     | acoplamento da função genérica a um campo não comum               | mudança lógica exige admin ativo e justificativa                                                                  | comparação e normalização JSONB; soft delete existente e restore D21                                                                                          |
| `projects`      | `trg_05_projects_inactivation`, `BEFORE UPDATE`      | mesma                          | `deleted_at`; também possui `status`                      | somente `deleted_at` era tratada como inativação                                          | acesso direto funciona nesta tabela, mas não no conjunto genérico | `deleted_at` exige admin ativo e justificativa; `status` não é reinterpretado                                     | soft delete e restore via JSONB                                                                                                                               |
| `project_items` | `trg_05_project_items_inactivation`, `BEFORE UPDATE` | mesma                          | `active`, `deleted_at`                                    | qualquer mudança dos dois campos era protegida                                            | acoplamento e dois mecanismos lógicos                             | qualquer mudança lógica exige admin ativo e justificativa                                                         | inativação e reativação via JSONB                                                                                                                             |

Os quatro triggers permanecem vinculados à mesma função e não precisam ser recriados.
`CREATE OR REPLACE FUNCTION` preserva OID, proprietário, ACL e dependências.

## Regra de `app_users`

A coluna real é `active`. A D21 preserva a regra existente para qualquer transição real do campo,
inclusive reativação: ator autenticado, existente, ativo e com papel `admin`, além de
justificativa. Update sem mudança de ciclo de vida não é tratado como inativação.

Mudança real de `role` também exige ator admin ativo por pertencer à administração de usuários. A
matriz aprovada não exige justificativa para administração de papel; por isso justificativa
continua obrigatória apenas quando há mudança de ciclo de vida. Toda mudança segue pelo trigger de
auditoria já existente.

Não há regra aprovada ou implementada para impedir a inativação do último admin ativo. A D21 não
inventa essa decisão. A suíte usa a regra já existente para chegar ao cenário de autoaprovação com
um único admin.

## Correção

A migration
[`20260730163419_fix_ltcm_admin_inactivation_columns.sql`](../../supabase/migrations/20260730163419_fix_ltcm_admin_inactivation_columns.sql)
substitui somente `ltc_m.enforce_admin_inactivation()`:

- converte `OLD` e `NEW` para JSONB;
- testa apenas chaves realmente presentes;
- detecta `deleted_at` e `active` sem referência direta a campos;
- detecta `role` somente em `app_users`;
- consulta o papel real do ator em `ltc_m.app_users`;
- exige justificativa apenas para ciclo de vida;
- normaliza `deleted_at` por `jsonb_build_object` e `jsonb_populate_record`;
- não altera triggers ou estruturas.

## Auditoria das demais funções genéricas

| Função                      | Tabelas vinculadas | Referências diretas               | Avaliação                                                                                   |
| --------------------------- | ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------- |
| `maintain_row_metadata()`   | nove               | `OLD/NEW.created_at`              | seguro: todas as nove tabelas possuem `created_at`; versão e autoria são tratadas por JSONB |
| `audit_row_change()`        | dez                | nenhuma coluna heterogênea direta | seguro: registros e campos opcionais são tratados por JSONB                                 |
| `prevent_physical_delete()` | doze               | nenhuma                           | seguro                                                                                      |
| `protect_plan_content()`    | scopes e lines     | `OLD/NEW.plan_version_id`         | seguro: a coluna existe nas duas tabelas                                                    |

`protect_plan_version()` usa campos diretos de workflow, mas está vinculada somente a
`plan_versions`. Nenhum outro defeito diretamente equivalente e dentro do escopo D21 foi
encontrado.

## Riscos remanescentes

- A proteção de papel e ciclo de vida é defesa transacional, mas grants e RLS continuam para P008.
- O proprietário das tabelas permanece uma identidade privilegiada fora da fronteira normal.
- A regra de último admin ativo permanece pendente de decisão de negócio.
- A execução remota D21 ocorre sem backup recuperável apenas pela exceção formal registrada.
- O projeto continua compartilhado e não representa homologação ou produção.

## Resultado

A migration D21 foi aplicada uma única vez. A definição remota passou a usar somente JSONB para
campos heterogêneos, os quatro triggers permaneceram vinculados e a suíte PostgreSQL integral
terminou sem `42703`, com `rollback_clean = true`. O fingerprint externo pré/pós permaneceu
idêntico. Evidências:
[`p007-d21-post-correction-report.md`](p007-d21-post-correction-report.md).
