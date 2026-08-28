import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const P022_LAYOUT_CONTRACT = 'ltcm.p022.layout-design-system.v1';

const REQUIRED_FILES = [
  'apps/web/src/components/design-system.tsx',
  'apps/web/src/components/design-system.test.tsx',
  'apps/web/src/layouts/AppShell.tsx',
  'apps/web/src/app/routes.tsx',
  'apps/web/src/styles/global.css',
  'docs/frontend/p022-layout-design-system.md',
];

function read(rootDirectory, relativePath) {
  const filename = path.join(rootDirectory, relativePath);
  return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
}

export function checkP022Layout(rootDirectory = process.cwd()) {
  const issues = [];
  for (const relativePath of REQUIRED_FILES) {
    if (read(rootDirectory, relativePath) === null)
      issues.push(`P022_REQUIRED_FILE_MISSING:${relativePath}`);
  }

  const component = read(rootDirectory, 'apps/web/src/components/design-system.tsx') ?? '';
  const shell = read(rootDirectory, 'apps/web/src/layouts/AppShell.tsx') ?? '';
  const routes = read(rootDirectory, 'apps/web/src/app/routes.tsx') ?? '';
  const styles = read(rootDirectory, 'apps/web/src/styles/global.css') ?? '';
  const docs = read(rootDirectory, 'docs/frontend/p022-layout-design-system.md') ?? '';
  const source = `${component}\n${shell}\n${routes}\n${styles}`;

  for (const marker of [
    P022_LAYOUT_CONTRACT,
    'function Button',
    'function Label',
    'function Field',
    'function Input',
    'function Select',
    'function Textarea',
    'function FieldHelp',
    'function FieldError',
    'function Breadcrumbs',
    'function PageHeader',
    'function EmptyState',
    'aria-describedby',
    'aria-invalid',
  ]) {
    if (!source.includes(marker)) issues.push(`P022_CONTRACT_MARKER_MISSING:${marker}`);
  }

  for (const marker of [
    'aria-expanded',
    'aria-controls',
    'Escape',
    'mobile-primary-navigation',
    'APP_NAVIGATION',
    'aria-label="Navegação principal"',
    'aria-label="Navegação móvel"',
  ]) {
    if (!shell.includes(marker) && !routes.includes(marker))
      issues.push(`P022_NAVIGATION_MARKER_MISSING:${marker}`);
  }

  for (const marker of [
    '--color-surface:',
    '--color-text:',
    '--color-border:',
    '--color-action:',
    '--color-focus:',
    '--space-4:',
    '--font-size-md:',
    '--radius-sm:',
    '--content-max-width:',
    '--navigation-width:',
    '--motion-fast:',
    '@media (max-width: 760px)',
    '@media (max-width: 620px)',
    'prefers-reduced-motion',
    ':focus-visible',
  ]) {
    if (!styles.includes(marker)) issues.push(`P022_STYLE_MARKER_MISSING:${marker}`);
  }

  for (const forbidden of [
    'react-router',
    'react-router-dom',
    'tailwind',
    'bootstrap',
    'styled-components',
    'dangerouslySetInnerHTML',
    'localStorage',
    'VITE_AUTH0_CLIENT_SECRET',
  ]) {
    if (source.includes(forbidden)) issues.push(`P022_FORBIDDEN_MARKER_FOUND:${forbidden}`);
  }

  if (!docs.includes(P022_LAYOUT_CONTRACT)) issues.push('P022_DOCUMENTATION_CONTRACT_MISSING');
  if (!docs.includes('Dark mode') || !docs.includes('não foi encontrado')) {
    issues.push('P022_DOCUMENTATION_BOUNDARY_MISSING');
  }

  return [...new Set(issues)].sort();
}

function main() {
  const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
  const issues = checkP022Layout(rootDirectory);
  if (issues.length > 0) {
    console.error(`P022 layout inválido:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`P022 layout válido: ${P022_LAYOUT_CONTRACT}, sem novas dependências`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
