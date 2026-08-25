import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadP014CertifiedRealizedSource } from '@ltcm/extractor/p014';

import { prettyCanonicalJson } from './canonical-json.js';
import { createP014RealizedImportDryRun } from './p014-realized-import.js';

export function parseP014RealizedArguments(argv: readonly string[]): string | 'help' {
  if (argv.length === 1 && argv[0] === '--help') return 'help';
  let input: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument.startsWith('--input=')) {
      if (input !== null || argument.slice('--input='.length).trim() === '') {
        throw new Error('P014_CLI_INVALID_INPUT');
      }
      input = argument.slice('--input='.length);
      continue;
    }
    if (argument === '--input') {
      const value = argv[index + 1];
      if (input !== null || value === undefined || value.startsWith('--')) {
        throw new Error('P014_CLI_INVALID_INPUT');
      }
      input = value;
      index += 1;
      continue;
    }
    throw new Error('P014_CLI_UNKNOWN_ARGUMENT');
  }
  if (input === null) throw new Error('P014_CLI_INPUT_REQUIRED');
  return path.resolve(input);
}

async function main(): Promise<void> {
  try {
    const parsed = parseP014RealizedArguments(process.argv.slice(2));
    if (parsed === 'help') {
      process.stdout.write('Uso: ltcm:analyze-realized -- --input=<arquivo.xlsx>\n');
      return;
    }
    const source = await loadP014CertifiedRealizedSource(parsed);
    process.stdout.write(prettyCanonicalJson(createP014RealizedImportDryRun(source)));
  } catch (error) {
    const code =
      error instanceof Error && /^P014_[A-Z0-9_:.-]+$/u.test(error.message)
        ? error.message
        : 'P014_ANALYSIS_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
