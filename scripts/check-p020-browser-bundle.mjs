import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const directory = path.join(process.cwd(), 'apps', 'web', 'dist');
if (!fs.existsSync(directory)) throw new Error('P020_BROWSER_BUNDLE_MISSING');

function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

const bundle = files(directory)
  .filter((name) => /\.(?:js|css|html|map)$/u.test(name))
  .map((name) => fs.readFileSync(name, 'utf8'))
  .join('\n');

for (const marker of [
  'DATABASE_URL',
  'AUTH0_CLIENT_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  '@supabase/supabase-js',
]) {
  if (bundle.includes(marker)) throw new Error(`P020_BROWSER_BUNDLE_FORBIDDEN:${marker}`);
}

process.stdout.write('P020 browser bundle sem credenciais server-side ou Supabase Auth\n');
