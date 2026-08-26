# P018 — scaffold da aplicação CRUD

Contrato: `ltcm.p018.crud-scaffold.v1`

## Stack congelada

| Responsabilidade   | Implementação                                                            |
| ------------------ | ------------------------------------------------------------------------ |
| Runtime e UI       | React 19                                                                 |
| Bundler e ambiente | Vite 8                                                                   |
| Linguagem          | TypeScript 6 em modo estrito                                             |
| Pacotes            | npm 11 com workspaces                                                    |
| Testes             | Vitest 4 e renderização estática React                                   |
| Lint               | ESLint 10, typescript-eslint e regras React Hooks                        |
| Formatação         | Prettier 3 na raiz                                                       |
| Estilos            | CSS global próprio, sem framework concorrente                            |
| Roteamento         | resolvedor mínimo `/`/not-found, sem biblioteca ainda não aprovada       |
| Acessibilidade     | landmarks semânticos, skip link, foco visível e assertions automatizadas |

O discovery encontrou React/Vite/TypeScript funcionais, porém com estrutura monolítica e sem
contratos nominais de roteamento, ambiente, error boundary ou acessibilidade. O scaffold resultante
é `STACK_COMPLETE` para a fundação P018, sem escolher ferramentas das próximas tarefas.

## Estrutura

```text
apps/web/src/
|-- app/                 # composição, metadados, ambiente, rotas e error boundary
|-- layouts/             # shell e landmarks compartilhados
|-- routes/              # conteúdo associado a rotas, sem CRUD de domínio
|-- styles/              # reset e estilos globais responsivos
`-- main.tsx             # único ponto de montagem no DOM
```

Pastas de `features`, hooks ou bibliotecas compartilhadas serão criadas apenas quando uma feature
real tiver ownership concreto. P018 não mantém diretórios vazios como arquitetura aparente.

## Roteamento e shell

O entrypoint passa o `pathname` atual a um resolvedor determinístico. `/` renderiza a fundação e
qualquer outro caminho renderiza uma página 404 com retorno ao início. Isso garante root e fallback
sem antecipar a escolha de uma biblioteca de router. O shell contém skip link, `header`, navegação
nomeada, `main` focalizável e `footer`. Um error boundary fornece fallback estável sem detalhes
internos; logging aguarda o contrato futuro de observabilidade.

## Ambiente e segurança

As variáveis são classificadas assim:

- `PUBLIC_CLIENT_SAFE`: somente nomes `VITE_` deliberadamente públicos. P018 lê
  `VITE_APP_ENV` e `VITE_API_BASE_URL`; os nomes Auth0 do template ficam reservados e não ativam
  fluxo de autenticação.
- `SERVER_ONLY`: `NODE_ENV`, `PORT`, CORS, Auth0 server-side e `DATABASE_URL`; nunca são lidos pelo
  browser.
- `NOT_ALLOWED_IN_BROWSER`: credenciais de banco, service-role keys, senhas, chaves privadas e
  segredos server-side.

Ausência de arquivo local usa defaults seguros (`local` e loopback) para permitir build limpo.
Valores fornecidos são validados e nomes `VITE_` sensíveis falham antes da montagem. O
`.env.example` contém somente placeholders. O build não acessa rede, Docker, PostgreSQL ou XLSX.

## Qualidade e acessibilidade

TypeScript preserva `strict`/`noEmit` e habilita `noUncheckedIndexedAccess` e
`exactOptionalPropertyTypes` no workspace web. Os testes provam renderização básica, landmarks,
navegação nomeada, heading principal, skip link, rota desconhecida, error fallback e ambiente
fail-closed. Isso é uma baseline verificável, não uma declaração de conformidade WCAG completa.

```bash
npm run p018:check
npm run test:p018:static
npm run p018:acceptance
npm run dev
```

`p018:acceptance` compõe contrato estático, testes do gate, lint, typecheck, testes web e build. O
workflow existente também executa esse comando antes do gate consolidado e preserva toda a
validação PostgreSQL.

## Limites

P018 não implementa CRUD, estado de domínio, formulários, Auth0, Supabase, acesso à API, backend,
deploy ou dados falsos. Em particular, a integração cliente/tipos prevista para P019 não foi
antecipada. O schema permanece com 13 migrations e os contratos P008–P017 não são alterados.
