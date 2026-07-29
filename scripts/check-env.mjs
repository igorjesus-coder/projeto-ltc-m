import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REQUIRED_VARIABLES = {
  frontend: [
    'VITE_APP_ENV',
    'VITE_API_BASE_URL',
    'VITE_AUTH0_DOMAIN',
    'VITE_AUTH0_CLIENT_ID',
    'VITE_AUTH0_AUDIENCE',
  ],
  backend: [
    'NODE_ENV',
    'PORT',
    'DATABASE_URL',
    'AUTH0_DOMAIN',
    'AUTH0_AUDIENCE',
    'CORS_ALLOWED_ORIGINS',
  ],
};

const BACKEND_ONLY_VARIABLES = new Set(REQUIRED_VARIABLES.backend);
const APP_ENVIRONMENTS = new Set(['local', 'development', 'staging', 'production', 'test']);
const NODE_ENVIRONMENTS = new Set(['development', 'production', 'test']);
const FORBIDDEN_VITE_VARIABLES = new Set([
  'VITE_NODE_ENV',
  'VITE_PORT',
  'VITE_DATABASE_URL',
  'VITE_CORS_ALLOWED_ORIGINS',
]);
const SENSITIVE_VITE_NAME = /^VITE_.*(DATABASE|PASSWORD|SECRET|TOKEN|SERVICE_ROLE|PRIVATE_KEY)/;

function stripMatchingQuotes(value) {
  if (value.length < 2) return value;

  const first = value.at(0);
  const last = value.at(-1);
  return first === last && (first === '"' || first === "'") ? value.slice(1, -1) : value;
}

export function parseEnvText(text) {
  const entries = new Map();
  const duplicates = new Set();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const separator = normalized.indexOf('=');
    if (separator < 1) continue;

    const name = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;

    if (entries.has(name)) duplicates.add(name);
    entries.set(name, stripMatchingQuotes(normalized.slice(separator + 1).trim()));
  }

  return { entries, duplicates };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function requiredForScope(scope) {
  if (scope === 'frontend') return REQUIRED_VARIABLES.frontend;
  if (scope === 'backend') return REQUIRED_VARIABLES.backend;
  return [...REQUIRED_VARIABLES.frontend, ...REQUIRED_VARIABLES.backend];
}

export function validateEntries(
  entries,
  { scope = 'all', allowEmpty = false, duplicates = new Set() } = {},
) {
  const issues = [];

  for (const name of requiredForScope(scope)) {
    if (!entries.has(name) || (!allowEmpty && entries.get(name) === '')) {
      issues.push({ name, message: 'variável obrigatória ausente ou vazia' });
    }
  }

  for (const name of duplicates) {
    issues.push({ name, message: 'variável declarada mais de uma vez' });
  }

  for (const name of entries.keys()) {
    if (FORBIDDEN_VITE_VARIABLES.has(name) || SENSITIVE_VITE_NAME.test(name)) {
      issues.push({
        name,
        message: 'variável server-side ou sensível não pode usar o prefixo VITE_',
      });
    }

    if (scope === 'frontend' && BACKEND_ONLY_VARIABLES.has(name)) {
      issues.push({ name, message: 'variável exclusivamente server-side no ambiente do frontend' });
    }
  }

  const apiUrl = entries.get('VITE_API_BASE_URL');
  if (apiUrl && !isHttpUrl(apiUrl)) {
    issues.push({ name: 'VITE_API_BASE_URL', message: 'URL pública da API inválida' });
  }

  const appEnvironment = entries.get('VITE_APP_ENV');
  if (appEnvironment && !APP_ENVIRONMENTS.has(appEnvironment)) {
    issues.push({ name: 'VITE_APP_ENV', message: 'ambiente desconhecido' });
  }

  const nodeEnvironment = entries.get('NODE_ENV');
  if (nodeEnvironment && !NODE_ENVIRONMENTS.has(nodeEnvironment)) {
    issues.push({ name: 'NODE_ENV', message: 'ambiente desconhecido' });
  }

  const port = entries.get('PORT');
  if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    issues.push({ name: 'PORT', message: 'porta inválida' });
  }

  const corsOrigins = entries.get('CORS_ALLOWED_ORIGINS');
  if (
    corsOrigins &&
    corsOrigins
      .split(',')
      .map((origin) => origin.trim())
      .some((origin) => !origin || !isHttpUrl(origin))
  ) {
    issues.push({ name: 'CORS_ALLOWED_ORIGINS', message: 'lista de origens contém URL inválida' });
  }

  return issues;
}

export function formatIssues(issues) {
  return issues.map(({ name, message }) => `- ${name}: ${message}`).join('\n');
}

function parseArguments(argv) {
  const options = {
    file: '.env.example',
    scope: 'all',
    allowEmpty: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--file') {
      options.file = argv.at(index + 1);
      options.allowEmpty = options.file === '.env.example';
      index += 1;
    } else if (argument === '--scope') {
      options.scope = argv.at(index + 1);
      index += 1;
    } else if (argument === '--template') {
      options.allowEmpty = true;
    } else if (argument === '--strict') {
      options.allowEmpty = false;
    } else {
      throw new Error(`argumento desconhecido: ${argument}`);
    }
  }

  if (!options.file) throw new Error('o argumento --file exige um caminho');
  if (!['all', 'frontend', 'backend'].includes(options.scope)) {
    throw new Error('o argumento --scope aceita apenas all, frontend ou backend');
  }

  return options;
}

function main() {
  let options;

  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Falha de uso: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const envPath = path.resolve(process.cwd(), options.file);
  let text;

  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    console.error(`Falha de ambiente: arquivo não encontrado (${options.file})`);
    process.exitCode = 1;
    return;
  }

  const { entries, duplicates } = parseEnvText(text);
  const issues = validateEntries(entries, { ...options, duplicates });

  if (issues.length > 0) {
    console.error(`Validação de ambiente falhou:\n${formatIssues(issues)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Contrato de ambiente válido: ${options.scope} (${options.file})`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
