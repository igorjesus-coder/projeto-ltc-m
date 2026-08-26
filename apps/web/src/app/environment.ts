const APP_ENVIRONMENTS = ['local', 'development', 'staging', 'production', 'test'] as const;

export const ENVIRONMENT_CATEGORIES = Object.freeze({
  PUBLIC_CLIENT_SAFE: [
    'VITE_APP_ENV',
    'VITE_API_BASE_URL',
    'VITE_AUTH0_DOMAIN',
    'VITE_AUTH0_CLIENT_ID',
    'VITE_AUTH0_AUDIENCE',
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

export function loadPublicEnvironment(source: EnvironmentSource): PublicEnvironment {
  const unsafeName = Object.keys(source).find((name) => SENSITIVE_VITE_NAME.test(name));
  if (unsafeName) throw new Error('P018_SENSITIVE_BROWSER_ENV_REJECTED');

  const appEnvironment = readOptionalText(source, 'VITE_APP_ENV') ?? 'local';
  if (!isAppEnvironment(appEnvironment)) throw new Error('P018_APP_ENV_INVALID');

  const apiBaseUrl = parsePublicUrl(
    readOptionalText(source, 'VITE_API_BASE_URL') ?? 'http://localhost:3000',
  );

  return Object.freeze({ appEnvironment, apiBaseUrl });
}

export const publicEnvironment = loadPublicEnvironment(import.meta.env);
