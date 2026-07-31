# Ambientes Supabase do LTC-M

## Estado da preparação

Diagnóstico remoto revalidado em 2026-07-29:

| Ambiente        | Projeto/decisão | Região exigida | Estado remoto                                     |
| --------------- | --------------- | -------------- | ------------------------------------------------- |
| Desenvolvimento | `Funcionarios`  | `us-east-1`    | vinculado e validado; exceção temporária aprovada |
| Homologação     | projeto isolado | `us-east-1`    | formalmente adiado por limite atual da conta      |
| Produção futura | projeto isolado | `us-east-1`    | não criado, consultado ou vinculado nesta tarefa  |

A Supabase CLI local 2.110.0 está instalada e a sessão autenticada listou quatro projetos
acessíveis, exatamente um deles chamado `Funcionarios` em `us-east-1`, região correspondente a
East US (North Virginia). O repositório foi vinculado localmente somente a esse projeto; o project
ref permanece no estado ignorado `supabase/.temp/` e não foi copiado para documentação,
configuração ou logs.

As verificações remotas não destrutivas concluíram com sucesso:

- `supabase migration list --linked`: nenhum registro de migration remota;
- `supabase db push --linked --dry-run`: nenhuma migration local pendente;
- `supabase/migrations`: somente `.gitkeep`.

Não foram executados `db pull`, `migration repair`, `db reset`, `db push` real, SQL manual,
criação de schema, tabela ou qualquer outra alteração remota. Nenhum project ref, URL, senha,
token ou connection string foi adicionado ao repositório.

Docker e Podman não estão disponíveis, portanto o fluxo local com containers ainda não pôde ser
executado.

`supabase/config.toml` permanece inalterado porque o vínculo remoto não requer project refs nesse
arquivo e a configuração local não pode ser validada sem containers. Os serviços locais presentes
no arquivo padrão não autorizam seu uso pela aplicação: a arquitetura continua limitada ao
PostgreSQL. A versão PostgreSQL configurada localmente deverá ser comparada com os projetos
remotos quando houver containers e uma tarefa autorizar essa validação.

O resultado da tarefa 1.02 é **Concluída provisoriamente com exceção de ambiente**. A parte remota
possível foi validada, mas a ausência de um projeto separado de homologação continua sendo uma
pendência formal e impede considerar pronta a promoção entre ambientes.

Em 2026-07-29, a P004 aplicou a baseline `20260729163000_create_ltcm_relational_core.sql` no
desenvolvimento compartilhado. O schema `ltc_m` foi criado com o núcleo relacional vazio, e o
fingerprint dos metadados preexistentes permaneceu idêntico. O relatório completo está em
[`database/post-application-report.md`](database/post-application-report.md).

Em 2026-07-30, a P005 aplicou duas vezes o seed transacional de `BRL` e `US`, comprovando
idempotência. `US = Unidade e Serviço`; nenhuma moeda ou unidade adicional foi criada, as tabelas
operacionais permaneceram vazias e o fingerprint externo continuou idêntico. O relatório está em
[`database/seed-post-application-report.md`](database/seed-post-application-report.md).

Também em 2026-07-30, a P006 adicionou quatro índices operacionais em `ltc_m`. Constraints e dados
permaneceram inalterados, os testes sintéticos executaram rollback integral e o fingerprint
externo continuou idêntico. O relatório está em
[`database/p006-post-application-report.md`](database/p006-post-application-report.md).

Ainda em 2026-07-30, a autorização D19 permitiu aplicar uma única vez as duas migrations P007 sem
backup recuperável. O histórico ficou alinhado e o fingerprint externo permaneceu idêntico, mas a
suíte PostgreSQL falhou em `PW902` ao aceitar uma transição direta
`draft -> pending_approval`. A transação abortada não deixou dados sintéticos. O workflow e sua
promoção permanecem bloqueados até correção incremental em tarefa separada; não houve `repair`,
rollback manual ou segundo push. O relatório está em
[`database/p007-post-application-report.md`](database/p007-post-application-report.md).

A autorização D20 aplicou depois uma única migration forward e corrigiu PW902 sem alterar o
fingerprint externo. A suíte avançou por todas as transições diretas e pela reabertura, mas falhou
em `42703` quando `enforce_admin_inactivation()` acessou `OLD.deleted_at` no trigger de
`app_users`. A transação também não deixou resíduos. O workflow continua sem promoção e nenhuma
segunda correção foi aplicada. Relatório:
[`database/p007-pw902-post-correction-report.md`](database/p007-pw902-post-correction-report.md).

A autorização D21 foi concedida exclusivamente para uma segunda e única migration forward do
erro `42703`, novamente no projeto `Funcionarios`, região `us-east-1` e schema `ltc_m`, mesmo sem
backup recuperável. Ela não autoriza segundo push, objetos externos, seed, privilégios, RLS,
policies, `repair`, reset, pull, rollback automático, SQL manual ou início da P008. O fingerprint
externo deve permanecer idêntico.

A D21 foi aplicada em um único push, a suíte P007 integral retornou `rollback_clean = true` e o
fingerprint externo permaneceu idêntico. Não houve dados residuais nem alteração fora de `ltc_m`
e do histórico de migrations. O P007 foi concluído; o projeto continua sendo apenas
desenvolvimento remoto temporário e compartilhado.

Em 31/07/2026, a D25 autorizou especificamente a futura aplicação remota do P008 sem backup
recuperável, sob os gates do
[`ADR-0003`](adr/0003-seguranca-postgresql-e-aplicacao-p008.md): preflight, dry-run, somente
migrations P008, um único `supabase db push --linked`, mudanças em `ltc_m`, grants apenas nesse
schema e criação de `ltc_m_runtime` como único delta global. `repair`, reset, pull, migration
down, SQL Editor, DDL manual e segundo push após falha permanecem proibidos. A tarefa P008-PRE
somente registra a decisão; não implementa nem aplica o P008.

## 1. Responsabilidades dos ambientes

### Desenvolvimento remoto

- desenvolvimento e testes técnicos;
- dados exclusivamente sintéticos;
- uso temporário do projeto compartilhado `Funcionarios`, em `us-east-1`;
- o projeto contém objetos e dados de outro sistema e não é um ambiente exclusivo do LTC-M;
- objetos futuros do LTC-M ficam obrigatoriamente isolados no schema `ltc_m`;
- operações destrutivas são proibidas nesse projeto compartilhado;
- acesso restrito à equipe técnica;
- mudanças de schema somente por migrations versionadas.

### Homologação

- testes integrados e aceite dos usuários;
- dados sintéticos ou sanitizados;
- projeto separado na região `us-east-1`;
- credenciais e limites isolados do desenvolvimento;
- exatamente as mesmas migrations aprovadas no repositório.
- ambiente ainda indisponível e formalmente adiado pelo limite atual da conta.

### Produção futura

- não criar nem vincular durante a tarefa 1.02;
- receber somente migrations validadas em desenvolvimento e homologação;
- exigir gates, backup e aprovação antes de qualquer promoção.

O projeto `Funcionarios` nunca pode ser tratado como homologação ou produção. A exceção não altera
a arquitetura-alvo de ambientes isolados e deve ser encerrada assim que a conta permitir um
projeto dedicado.

## 2. Variáveis e arquivos locais

O frontend mantém apenas:

- `VITE_APP_ENV`;
- `VITE_API_BASE_URL`;
- `VITE_AUTH0_DOMAIN`;
- `VITE_AUTH0_CLIENT_ID`;
- `VITE_AUTH0_AUDIENCE`.

O futuro backend mantém exclusivamente em contexto server-side:

- `NODE_ENV`;
- `PORT`;
- `DATABASE_URL`;
- `AUTH0_DOMAIN`;
- `AUTH0_AUDIENCE`;
- `CORS_ALLOWED_ORIGINS`.

Convenção de arquivos locais, todos não versionados:

```text
apps/web/.env.development.local
apps/web/.env.staging.local
apps/api/.env.development.local   # somente quando apps/api existir
apps/api/.env.staging.local       # somente quando apps/api existir
```

O `.gitignore` raiz ignora `.env`, `.env.*` e estado local em `.supabase/` e `supabase/.temp/`. O
`supabase/.gitignore` reforça a exclusão de `.env.local`, `.env.*.local`, `.branches` e `.temp`.
Somente `.env.example`, sem valores reais, é versionado.

Nunca colocar em arquivo de frontend:

- `DATABASE_URL` ou senha PostgreSQL;
- chaves secretas ou `service_role`;
- access token da Supabase CLI;
- Auth0 client secret.

## 3. Validação do contrato de ambiente

O validador usa somente módulos nativos do Node.js e não conecta ao banco:

```bash
# Valida a presença dos nomes no contrato versionado; valores secretos podem ficar vazios.
npm run env:check

# Valida valores obrigatórios do frontend de desenvolvimento.
npm run env:check -- --scope frontend --file apps/web/.env.development.local

# Valida valores obrigatórios do frontend de homologação.
npm run env:check -- --scope frontend --file apps/web/.env.staging.local

# Usar após a criação do backend.
npm run env:check -- --scope backend --file apps/api/.env.development.local
npm run env:check -- --scope backend --file apps/api/.env.staging.local
```

O script rejeita:

- variável obrigatória ausente ou vazia em arquivos locais;
- nome sensível com prefixo `VITE_`;
- variável server-side no arquivo de frontend;
- `VITE_API_BASE_URL` inválida;
- ambiente desconhecido;
- porta ou lista de origens CORS inválida.

Mensagens exibem apenas o nome da variável e o tipo de erro, nunca seu valor.

## 4. Autenticação da Supabase CLI

Antes de acessar projetos remotos:

1. autenticar interativamente com `supabase login`; o token fica no estado local da CLI, fora do
   Git;
2. alternativamente, disponibilizar `SUPABASE_ACCESS_TOKEN` somente na sessão do terminal ou no
   cofre do CI, nunca em `.env` versionado;
3. executar `supabase projects list --output-format json` localmente;
4. confirmar visualmente o nome lógico e `us-east-1`, sem copiar project refs para documentação,
   issues ou logs públicos;
5. interromper se o ambiente ou a região não coincidirem.

Os identificadores necessários para operações futuras são:

- project ref do desenvolvimento temporário, mantido somente no estado local ignorado da CLI;
- futuramente, project ref de homologação;
- senha PostgreSQL de cada ambiente, fornecida de modo interativo ou por cofre;
- permissão da conta para listar e vincular o projeto pretendido.

## 5. Vinculação e alternância seguras

A CLI mantém um vínculo por diretório de trabalho. O estado específico da máquina fica em
`supabase/.temp/`, que é ignorado pelo Git. Validar um ambiente por vez.

### Desenvolvimento temporário

```bash
supabase unlink
supabase projects list
supabase link --project-ref <REF_DE_FUNCIONARIOS>
supabase migration list --linked
supabase db push --linked --dry-run
```

O vínculo atual foi mantido localmente para o trabalho de desenvolvimento solicitado. Antes de
qualquer comando posterior, confirmar novamente que o alvo é `Funcionarios` em `us-east-1`.

### Homologação futura (quando disponível)

Os comandos abaixo só podem ser executados quando existir um projeto realmente separado. Até lá,
o ambiente está adiado; não usar prefixo de tabela, segundo conjunto de tabelas, outro schema ou
branch dentro de `Funcionarios` para simulá-lo.

```bash
supabase unlink
supabase projects list
supabase link --project-ref <STAGING_PROJECT_REF>
supabase migration list --linked
supabase db push --linked --dry-run
supabase unlink
```

Regras operacionais:

- confirmar o nome e a região do alvo antes de `link`;
- informar senha de modo interativo; evitar `--password` no histórico do shell;
- `migration list --linked` e `db push --linked --dry-run` são as verificações não destrutivas;
- não executar `db reset`, `db push` real, SQL manual ou criação de dados nesta tarefa;
- nunca vincular produção durante a tarefa 1.02;
- fora do vínculo de desenvolvimento solicitado, executar `unlink` ao terminar para reduzir o
  risco de usar o alvo errado.

## 6. Política de migrations e promoção

1. `supabase/migrations` é a única fonte de verdade do schema.
2. Toda mudança nasce em uma migration versionada.
3. A migration é aplicada primeiro em desenvolvimento.
4. Após testes e revisão, o mesmo arquivo segue para homologação.
5. Produção receberá os mesmos arquivos aprovados.
6. Homologação e produção não recebem alterações manuais de schema.
7. Não existe migration diferente por ambiente.
8. Migration já aplicada não é sobrescrita ou reescrita.
9. Correções usam uma nova migration.
10. Operações destrutivas exigem backup, plano de reversão e aprovação.
11. `db pull` é diagnóstico; sua saída deve ser revisada e nunca substitui silenciosamente a
    fonte versionada.
12. Nenhuma migration de domínio pertence à tarefa 1.02.
13. A primeira migration de domínio criou o schema `ltc_m` de modo explícito e aprovado na P004.
14. Tabelas, views, materialized views, funções/RPC, sequências, tipos e demais objetos exclusivos
    do LTC-M pertencem a `ltc_m` quando tecnicamente apropriado; triggers e policies pertencem
    somente a tabelas nesse schema.
15. Nenhum novo objeto de domínio do LTC-M pode ser criado em `public`.
16. Migrations e consultas da aplicação qualificam objetos com `ltc_m.` e não dependem de um
    `search_path` implícito.
17. Nenhuma migration do LTC-M pode alterar, mover, renomear ou excluir objetos do outro sistema.
18. Backup recuperável permanece obrigatório antes de migrations remotas. A P004 prosseguiu sem
    ele somente pela exceção formal aprovada e registrada nos relatórios da tarefa.
19. Extensões compartilhadas só podem ser criadas, atualizadas, movidas ou removidas depois de
    análise e aprovação explícitas.
20. Migrations devem validar o schema-alvo e falhar com segurança antes de atingir objetos fora de
    `ltc_m`.

O histórico de migrations da Supabase é compartilhado por banco, não por schema. O histórico
remoto contém somente a baseline P004 `20260729163000`, alinhada ao arquivo local. Se aparecer
qualquer versão desconhecida, interromper a execução, identificar o repositório proprietário e
aprovar uma estratégia de reconciliação. Não usar `migration repair`, arquivos vazios ou
`db pull` para forçar alinhamento.

Para toda migration posterior, a validação no desenvolvimento temporário será:

1. vincular desenvolvimento;
2. revisar `migration list --linked`;
3. executar `db push --linked --dry-run`;
4. aplicar as migrations aprovadas em desenvolvimento;
5. executar testes e reconciliação;
6. confirmar que nenhum objeto fora de `ltc_m` foi criado ou alterado.

Depois que houver homologação isolada:

1. desvincular desenvolvimento;
2. vincular homologação;
3. repetir lista e dry-run;
4. aplicar exatamente os mesmos arquivos;
5. homologar antes de qualquer promoção futura para produção.

Hoje `supabase/migrations` contém a baseline P004, já aplicada no desenvolvimento remoto. A
promoção continua bloqueada até existir homologação isolada.

## 7. Conexão PostgreSQL

- `DATABASE_URL` existe somente no backend ou nas variáveis server-side do Render.
- A conexão exige SSL conforme os requisitos do provedor.
- Nenhuma connection string ou credencial PostgreSQL entra no frontend.
- Pooler versus conexão direta será decidido conforme o workload do backend e os limites
  contratados.
- A API futura usará papel próprio e de menor privilégio; não usará credencial administrativa em
  operação normal.
- Tableau terá credencial própria, rotacionável e somente leitura, limitada a views analíticas.
- Usuário Tableau e papel da aplicação não são criados na tarefa 1.02.

## 8. Backups

- rotina mensal de backup aprovada;
- teste periódico de restauração obrigatório;
- a primeira migration foi aplicada sem backup somente pela exceção formal da P004;
- backup recuperável volta a ser obrigatório antes de qualquer migration remota posterior;
- responsáveis e procedimento detalhado ainda pendentes;
- RPO, RTO, PITR e retenção permanecem decisões futuras;
- nenhum backup real é configurado nesta tarefa.

## 9. Ações manuais necessárias

1. definir responsável, retenção e procedimento de backup de `Funcionarios`;
2. disponibilizar e testar um ponto de restauração antes da próxima migration remota;
3. validar a baseline em PostgreSQL descartável quando Docker ou Podman estiver disponível;
4. repetir `migration list --linked` e `db push --linked --dry-run` imediatamente antes de aplicar
   qualquer migration;
5. interromper se surgir histórico remoto desconhecido ou alteração fora de `ltc_m`;
6. criar ou disponibilizar homologação isolada em `us-east-1` quando a conta permitir;
7. conceder à equipe técnica acesso restrito ao futuro ambiente de homologação;
8. validar vínculo, histórico e dry-run nesse projeto antes da primeira promoção;
9. repetir a validação local completa quando Docker ou Podman estiver disponível.

Produção não integra essas ações.

## 10. Riscos e próximos passos

| Risco                                    | Tratamento                                                   |
| ---------------------------------------- | ------------------------------------------------------------ |
| impacto no outro sistema                 | isolamento em `ltc_m`, scanner, fingerprint e backup futuro  |
| conflito de nomes ou `search_path`       | nomes qualificados; nenhum objeto LTC-M em `public`          |
| histórico de migration passar a divergir | parar e aprovar baseline; nunca executar `repair` automático |
| vínculo apontar para ambiente errado     | confirmar nome e região antes de cada operação               |
| project ref ou token ser versionado      | manter estado local ignorado e usar cofre/sessão             |
| homologação ser simulada no banco dev    | manter adiamento formal até existir projeto isolado          |
| promoção divergente                      | usar os mesmos arquivos em desenvolvimento e homologação     |
| segredo aparecer em log                  | validadores e procedimentos nunca imprimem valores           |
| ausência de containers                   | validar localmente quando Docker/Podman estiver disponível   |
| migration destrutiva                     | backup, rollback e aprovação obrigatórios                    |

Antes da próxima migration, disponibilizar backup recuperável e validação em PostgreSQL
descartável. A promoção continuará bloqueada até existir homologação isolada.
