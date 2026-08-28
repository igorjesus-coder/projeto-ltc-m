const APP_ENVIRONMENTS = ['local', 'development', 'staging', 'production', 'test'] as const;

export const ENVIRONMENT_CATEGORIES = Object.freeze({
  PUBLIC_CLIENT_SAFE: [
    'VITE_APP_ENV',
    'VITE_API_BASE_URL',
    'VITE_AUTH0_DOMAIN',
    'VITE_AUTH0_CLIENT_ID',
    'VITE_AUTH0_AUDIENCE',
    'VITE_AUTH0_REDIRECT_URI',
  ],
  SERVER_ONLY: [
    'backend runtime configuration',
    'database connection configuration',
    'authentication server configuration',
  ],
  NOT_ALLOWED_IN_BROWSER: [
    'database credentials',
    'service-role keys',
    'passwords',
    'private keys',
    'server secrets',
  ],
});

type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export interface PublicEnvironment {
  readonly appEnvironment: AppEnvironment;
  readonly apiBaseUrl: string;
  readonly auth0: Auth0PublicEnvironment | null;
}

export interface Auth0PublicEnvironment {
  readonly domain: string;
  readonly clientId: string;
  readonly audience: string;
  readonly redirectUri: string | undefined;
}

type EnvironmentSource = Readonly<Record<string, unknown>>;

const SENSITIVE_VITE_NAME = /^VITE_.*(DATABASE|PASSWORD|SECRET|TOKEN|SERVICE_ROLE|PRIVATE_KEY)/u;

function readOptionalText(source: EnvironmentSource, name: string) {
  const value = source[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isAppEnvironment(value: string): value is AppEnvironment {
  return APP_ENVIRONMENTS.some((candidate) => candidate === value);
}

function parsePublicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('P018_PUBLIC_API_URL_INVALID');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('P018_PUBLIC_API_URL_INVALID');
  }

  return url.toString().replace(/\/$/u, '');
}

function parseAuth0Domain(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?$/iu.test(value)) {
    throw new Error('P020_AUTH0_DOMAIN_INVALID');
  }
  return value;
}

function parseAuth0Text(value: string, code: string): string {
  if (value.length > 2_048 || /\s/u.test(value)) throw new Error(code);
  return value;
}

function readAuth0Environment(source: EnvironmentSource): Auth0PublicEnvironment | null {
  const domain = readOptionalText(source, 'VITE_AUTH0_DOMAIN');
  const clientId = readOptionalText(source, 'VITE_AUTH0_CLIENT_ID');
  const audience = readOptionalText(source, 'VITE_AUTH0_AUDIENCE');
  const redirectUri = readOptionalText(source, 'VITE_AUTH0_REDIRECT_URI');
  const configured = [domain, clientId, audience, redirectUri].some((value) => value !== undefined);

  if (!configured) return null;
  if (!domain || !clientId || !audience) throw new Error('P020_AUTH0_CONFIG_INCOMPLETE');

  return Object.freeze({
    domain: parseAuth0Domain(domain),
    clientId: parseAuth0Text(clientId, 'P020_AUTH0_CLIENT_ID_INVALID'),
    audience: parseAuth0Text(audience, 'P020_AUTH0_AUDIENCE_INVALID'),
    redirectUri: redirectUri ? parsePublicUrl(redirectUri) : undefined,
  });
}

export function requireAuth0Environment(
  environment: PublicEnvironment,
  browserOrigin: string,
): Auth0PublicEnvironment & { readonly redirectUri: string } {
  if (!environment.auth0) throw new Error('P020_AUTH0_CONFIG_MISSING');
  return Object.freeze({
    ...environment.auth0,
    redirectUri: environment.auth0.redirectUri ?? browserOrigin,
  });
}

export function loadPublicEnvironment(source: EnvironmentSource): PublicEnvironment {
  const unsafeName = Object.keys(source).find((name) => SENSITIVE_VITE_NAME.test(name));
  if (unsafeName) throw new Error('P018_SENSITIVE_BROWSER_ENV_REJECTED');

  const appEnvironment = readOptionalText(source, 'VITE_APP_ENV') ?? 'local';
  if (!isAppEnvironment(appEnvironment)) throw new Error('P018_APP_ENV_INVALID');

  const apiBaseUrl = parsePublicUrl(
    readOptionalText(source, 'VITE_API_BASE_URL') ?? 'http://localhost:3000',
  );

  return Object.freeze({ appEnvironment, apiBaseUrl, auth0: readAuth0Environment(source) });
}

export const publicEnvironment = loadPublicEnvironment(import.meta.env);
