# P020 — autenticação e sessão Auth0

Contrato: `ltcm.p020.auth0-authentication-session.v1`

## Ownership e fluxo

Auth0 é o owner de autenticação e sessão. O frontend React usa o SDK oficial
`@auth0/auth0-react`, Universal Login e Authorization Code + PKCE. O backend NestJS/Express
recebe somente bearer access tokens e valida sua assinatura antes de liberar uma rota protegida.
Supabase continua sendo apenas o PostgreSQL; Supabase Auth, Data API, Edge Functions e
`supabase-js` não fazem parte deste contrato.

```text
Browser React
  -> Auth0 Universal Login (Authorization Code + PKCE)
  -> access token curto em cache gerenciado pelo SDK
  -> API NestJS/Express: Authorization: Bearer <access-token>
  -> PostgreSQL Supabase somente pelo backend
```

## Contrato do token

- issuer: `AUTH0_ISSUER_BASE_URL`, com a barra final preservada;
- audience: `AUTH0_AUDIENCE` e `VITE_AUTH0_AUDIENCE`, iguais ao identificador da API;
- algoritmo permitido: `RS256`;
- chaves: JWKS remoto em `/.well-known/jwks.json`, resolvido e cacheado em memória por `jose`;
- claims mínimas: `sub`, `iss`, `aud`, `exp`;
- assinatura, issuer, audience, algoritmo e expiração são obrigatórios;
- `alg=none`, tokens ausentes, malformados, expirados ou não verificáveis resultam em `401`;
- claims são usadas somente depois da verificação criptográfica.

## Responsabilidades

O frontend:

- valida a configuração pública `domain`, `clientId`, `audience` e redirect URI;
- não inicia o provider quando a configuração está ausente ou incompleta;
- usa cache `memory` e não persiste manualmente tokens em `localStorage`;
- expõe loading e erro sem renderizar conteúdo protegido antes da conclusão;
- preserva o destino interno usando `appState`, rejeitando destinos externos;
- realiza login, logout, restauração pelo SDK e tratamento controlado de `401`;
- envia `Authorization: Bearer <token>` por uma camada de API reutilizável.

O backend:

- exige `AUTH0_ISSUER_BASE_URL` e `AUTH0_AUDIENCE` no startup;
- aceita issuer HTTPS; HTTP só é permitido para testes locais em loopback;
- valida o bearer token com `jose` e JWKS remoto;
- aplica o `AuthGuard` nas rotas protegidas;
- expõe `GET /auth/me` como endpoint mínimo de prova, retornando somente `sub`;
- responde `401` para falha de autenticação e não converte token inválido em `500`;
- não registra o header `Authorization`, token ou segredo.

## Sessão, logout e redirecionamento

O SDK controla o estado inicial, o callback e a renovação compatível com sua configuração. O
P020 usa cache em memória e não cria refresh token ou armazenamento próprio. Logout delega ao
SDK e retorna à origem configurada. Destinos são limitados à mesma origem e a caminhos internos.
Sessão inválida ou expirada produz estado explícito de reautenticação sem loop automático.

## Ambiente e segurança

Frontend:

- `VITE_AUTH0_DOMAIN`;
- `VITE_AUTH0_CLIENT_ID`;
- `VITE_AUTH0_AUDIENCE`;
- `VITE_AUTH0_REDIRECT_URI` opcional, com a origem atual como fallback.

Backend:

- `AUTH0_ISSUER_BASE_URL`;
- `AUTH0_AUDIENCE`;
- `CORS_ALLOWED_ORIGINS`.

Nenhum client secret, `DATABASE_URL`, service role, senha, chave privada ou token pode aparecer
em variáveis `VITE_*`, bundle, source map ou logs. O backend continua sendo a única fronteira
para PostgreSQL. RLS/FORCE RLS, `pg`, tipos server-only e o runtime sem superuser/BYPASSRLS são
preservados.

## Fora do escopo

- autorização de negócio e matriz `viewer`/`editor`/`admin` da P021;
- CRUD, DTOs de domínio e acesso ao PostgreSQL pelo endpoint de prova;
- Supabase Auth, Data API, Edge Functions e `supabase-js`;
- migrations, schema, RLS, grants, seeds ou alteração de dados;
- tenant Auth0 real, Render, produção, credenciais e usuários reais.

## Gates e testes

O gate `npm run p020:acceptance` valida configuração, provider, rota protegida, cliente API,
bearer token, `401`, JWT/JWKS, issuer, audience, expiração, algoritmo, ausência de secrets,
ausência de Supabase Auth e ausência de browser → banco. Testes usam mocks do SDK e JWKS local;
CI não depende de Auth0 real nem de internet.
