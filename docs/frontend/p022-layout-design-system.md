# P022 — layout, navegação e design system básico

Contrato: `ltcm.p022.layout-design-system.v1`

## Arquitetura

P022 evolui o `AppShell` criado pelo P018. O frontend continua usando React 19, Vite 8,
TypeScript estrito, CSS próprio e navegação por links nativos. Não foi introduzida biblioteca de
router, framework visual, framework de formulário ou biblioteca de ícones.

O shell mantém o `Auth0Provider`, `AuthorizationProvider`, `ProtectedRoute`, `AuthorizationRoute`
e `PermissionGate` existentes. O frontend usa autorização somente para UX; o backend e o
PostgreSQL continuam sendo as barreiras definitivas.

## Tokens e identidade

Os tokens semânticos vivem em `apps/web/src/styles/global.css` e cobrem superfícies, texto,
bordas, ação, foco, estados, espaçamento, tipografia, raios, sombra, dimensões de navegação,
z-index e movimento. A identidade é funcional e neutra para LTC-M. Os valores não são cores
oficiais nem substituem um manual corporativo que ainda não foi encontrado.

Dark mode e theming configurável permanecem fora do escopo.

## Componentes

`apps/web/src/components/design-system.tsx` fornece:

- `Button`, com variantes `primary`, `secondary`, `danger` e `ghost`;
- `ActionLink`/`Link`;
- `Field`, `Label`, `Input`, `Select`, `Textarea`, `FieldHelp` e `FieldError`;
- `Breadcrumbs`, `PageHeader` e `EmptyState`.

Os controles preservam props HTML, associação por `id`/`htmlFor`, `name`, `required`, `disabled`,
`aria-describedby` e `aria-invalid`. Não há regras de negócio nem formulário financeiro.

## Navegação e responsividade

O resolvedor tipado preserva `/` e o fallback 404. A configuração `APP_NAVIGATION` contém somente
rotas reais existentes; P023+ não foi antecipado.

Em desktop, o shell exibe navegação lateral. Em viewports menores, exibe botão de menu com
`aria-expanded`, `aria-controls` e nome acessível. Escape fecha o menu e devolve foco ao acionador;
links nativos continuam funcionando sem focus trap. O layout usa CSS grid/flex, `clamp()`,
breakpoints em 760px e 620px e suporta largura mínima de 320px.

Breadcrumbs usam `nav` nomeado, lista semântica, `aria-current="page"`, separadores ignorados por
tecnologia assistiva e overflow horizontal controlado.

## Baseline de acessibilidade

O baseline verificável inclui skip link, landmarks, ordem de foco nativa, foco visível, nomes de
navegação, estado de rota atual, menu móvel operável por teclado, Escape, labels, ajuda/erro
associados, required, disabled, invalid, semântica de estado vazio e redução de movimento.

Este contrato não declara conformidade WCAG completa.

## Segurança e limites

P022 não altera Auth0, tokens, API, banco, migrations, RLS, roles, capabilities, tipos gerados ou
fingerprints P017. Não usa `localStorage` para tokens, segredo, CDN, fonte remota, HTML inseguro,
Supabase Auth ou acesso browser → banco.

## Validação

```bash
npm run p022:acceptance
npm run env:check
npm run migrations:check
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

P022 não exige Playwright/Cypress: o contrato de componentes é coberto por renderização estática,
assertions de CSS/estrutura e os comportamentos interativos permanecem implementados com APIs
nativas do navegador.
