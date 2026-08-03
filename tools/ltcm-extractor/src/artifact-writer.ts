import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson, prettyCanonicalJson } from './canonical-json.js';
import type { ExtractionResult } from './types.js';

const MARKER_FILE = '.ltcm-p010-artifacts';
const MARKER_CONTENT = 'ltcm-p010-artifacts-v1\n';

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function assertManagedDirectory(target: string): Promise<void> {
  if (!(await exists(target))) return;
  const targetStat = await stat(target);
  if (!targetStat.isDirectory())
    throw new Error('O diretório de saída existe e não é um diretório.');
  let marker: string;
  try {
    marker = await readFile(path.join(target, MARKER_FILE), 'utf8');
  } catch {
    throw new Error('O diretório de saída existente não é gerenciado pelo extrator P010.');
  }
  if (marker !== MARKER_CONTENT) {
    throw new Error('O marcador do diretório de saída P010 é inválido.');
  }
}

export async function writeArtifacts(outputDir: string, result: ExtractionResult): Promise<void> {
  const absoluteOutput = path.resolve(outputDir);
  const parent = path.dirname(absoluteOutput);
  const name = path.basename(absoluteOutput);
  if (absoluteOutput === path.parse(absoluteOutput).root || name.length === 0) {
    throw new Error('O diretório raiz não pode ser usado como saída.');
  }
  await assertManagedDirectory(absoluteOutput);
  await mkdir(parent, { recursive: true });

  const nonce = `${process.pid}-${Date.now()}`;
  const temporary = path.join(parent, `.${name}.p010-tmp-${nonce}`);
  const backup = path.join(parent, `.${name}.p010-backup-${nonce}`);
  await mkdir(path.join(temporary, 'sheets'), { recursive: true });
  let movedExisting = false;
  try {
    await writeFile(path.join(temporary, MARKER_FILE), MARKER_CONTENT, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await writeFile(
      path.join(temporary, 'manifest.json'),
      prettyCanonicalJson(result.manifest),
      'utf8',
    );
    await writeFile(
      path.join(temporary, 'validation-report.json'),
      prettyCanonicalJson(result.validationReport),
      'utf8',
    );
    await writeFile(
      path.join(temporary, 'profile-report.json'),
      prettyCanonicalJson(result.profileReport),
      'utf8',
    );
    await writeFile(
      path.join(temporary, 'errors.json'),
      prettyCanonicalJson(result.validationReport.entries),
      'utf8',
    );
    for (const [sheetKey, rows] of result.rowsBySheet) {
      const jsonLines = rows.map((row) => canonicalJson(row)).join('\n');
      await writeFile(
        path.join(temporary, 'sheets', `${sheetKey}.jsonl`),
        `${jsonLines}${jsonLines === '' ? '' : '\n'}`,
        'utf8',
      );
    }

    if (await exists(absoluteOutput)) {
      await rename(absoluteOutput, backup);
      movedExisting = true;
    }
    await rename(temporary, absoluteOutput);
    if (movedExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (!(await exists(absoluteOutput)) && movedExisting && (await exists(backup))) {
      await rename(backup, absoluteOutput);
    }
    throw error;
  } finally {
    if (await exists(temporary)) await rm(temporary, { recursive: true, force: true });
    if (await exists(backup)) await rm(backup, { recursive: true, force: true });
  }
}
