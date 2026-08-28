export type NodeEnvironment = 'development' | 'production' | 'test';
export type DatabaseSslMode = 'disable' | 'verify-full';

export interface AuthConfig {
  readonly issuerBaseUrl: string;
  readonly jwksUri: string;
  readonly audience: string;
  readonly allowedAlgorithms: readonly ['RS256'];
}

export interface DatabaseConfig {
  readonly connectionString: string;
  readonly sslMode: DatabaseSslMode;
  readonly poolMax: 10;
  readonly connectionTimeoutMillis: 5_000;
  readonly idleTimeoutMillis: 10_000;
  readonly statementTimeoutMillis: 10_000;
}

export interface ApiConfig {
  readonly nodeEnvironment: NodeEnvironment;
  readonly port: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly database: DatabaseConfig;
  readonly auth: AuthConfig;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

function fail(code: string): never {
  throw new Error(code);
}

function required(source: EnvironmentSource, name: string): string {
  const value = source[name]?.trim();
  if (!value) fail(`P019_CONFIG_${name}_MISSING`);
  return value;
}

function requiredAuth(source: EnvironmentSource, name: string): string {
  const value = source[name]?.trim();
  if (!value) fail(`P020_CONFIG_${name}_MISSING`);
  return value;
}

function parseNodeEnvironment(value: string): NodeEnvironment {
  if (value === 'development' || value === 'production' || value === 'test') return value;
  return fail('P019_CONFIG_NODE_ENV_INVALID');
}

function parsePort(value: string): number {
  if (!/^\d+$/u.test(value)) return fail('P019_CONFIG_PORT_INVALID');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return fail('P019_CONFIG_PORT_INVALID');
  }
  return port;
}

function parseOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('P019_CONFIG_CORS_ALLOWED_ORIGINS_INVALID');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    return fail('P019_CONFIG_CORS_ALLOWED_ORIGINS_INVALID');
  }
  return url.origin;
}

function parseCorsOrigins(value: string): readonly string[] {
  const origins = value.split(',').map((origin) => parseOrigin(origin.trim()));
  if (origins.length === 0 || new Set(origins).size !== origins.length) {
    return fail('P019_CONFIG_CORS_ALLOWED_ORIGINS_INVALID');
  }
  return Object.freeze(origins);
}

function parseDatabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('P019_CONFIG_DATABASE_URL_INVALID');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.pathname.length < 2 ||
    url.hash ||
    [...url.searchParams.keys()].some((name) => name.toLowerCase().startsWith('ssl'))
  ) {
    return fail('P019_CONFIG_DATABASE_URL_INVALID');
  }
  return value;
}

function parseSslMode(value: string, nodeEnvironment: NodeEnvironment): DatabaseSslMode {
  if (value !== 'disable' && value !== 'verify-full') {
    return fail('P019_CONFIG_DATABASE_SSL_MODE_INVALID');
  }
  if (nodeEnvironment === 'production' && value !== 'verify-full') {
    return fail('P019_CONFIG_DATABASE_SSL_MODE_UNSAFE');
  }
  return value;
}

function parseAuthIssuer(value: string, nodeEnvironment: NodeEnvironment): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('P020_CONFIG_AUTH0_ISSUER_INVALID');
  }
  const localHttpAllowed =
    nodeEnvironment !== 'production' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !localHttpAllowed) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    return fail('P020_CONFIG_AUTH0_ISSUER_INVALID');
  }
  return url.toString();
}

function parseAuthAudience(value: string): string {
  if (!value || value.length > 2_048 || /\s/u.test(value)) {
    return fail('P020_CONFIG_AUTH0_AUDIENCE_INVALID');
  }
  return value;
}

export function loadApiConfig(source: EnvironmentSource): ApiConfig {
  const nodeEnvironment = parseNodeEnvironment(required(source, 'NODE_ENV'));
  const issuerBaseUrl = parseAuthIssuer(
    requiredAuth(source, 'AUTH0_ISSUER_BASE_URL'),
    nodeEnvironment,
  );
  const auth = Object.freeze({
    issuerBaseUrl,
    jwksUri: new URL('.well-known/jwks.json', issuerBaseUrl).toString(),
    audience: parseAuthAudience(requiredAuth(source, 'AUTH0_AUDIENCE')),
    allowedAlgorithms: ['RS256'] as const,
  });
  const database = Object.freeze({
    connectionString: parseDatabaseUrl(required(source, 'DATABASE_URL')),
    sslMode: parseSslMode(required(source, 'DATABASE_SSL_MODE'), nodeEnvironment),
    poolMax: 10 as const,
    connectionTimeoutMillis: 5_000 as const,
    idleTimeoutMillis: 10_000 as const,
    statementTimeoutMillis: 10_000 as const,
  });
  return Object.freeze({
    nodeEnvironment,
    port: parsePort(required(source, 'PORT')),
    corsAllowedOrigins: parseCorsOrigins(required(source, 'CORS_ALLOWED_ORIGINS')),
    database,
    auth,
  });
}
